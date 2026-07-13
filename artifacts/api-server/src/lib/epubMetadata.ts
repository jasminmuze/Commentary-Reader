import { unzipSync, strFromU8 } from "fflate";
import { XMLParser } from "fast-xml-parser";

export interface EpubMetadata {
  title?: string;
  author?: string;
  isbn?: string;
}

export interface EpubCover {
  data: Uint8Array;
  mimeType: string;
}

// fast-xml-parser produces strings, numbers, nested objects ({ "#text": ... }),
// or arrays depending on the document. These helpers coerce defensively.
function textOf(node: unknown): string | undefined {
  if (node == null) return undefined;
  if (typeof node === "string") return node.trim() || undefined;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) {
    for (const n of node) {
      const t = textOf(n);
      if (t) return t;
    }
    return undefined;
  }
  if (typeof node === "object") {
    const t = (node as Record<string, unknown>)["#text"];
    if (typeof t === "string") return t.trim() || undefined;
    if (t != null) return String(t);
  }
  return undefined;
}

function collectStrings(node: unknown): string[] {
  if (node == null) return [];
  const arr = Array.isArray(node) ? node : [node];
  const out: string[] = [];
  for (const n of arr) {
    const t = textOf(n);
    if (t) out.push(t);
  }
  return out;
}

function extractIsbn(identifiers: string[]): string | undefined {
  for (const raw of identifiers) {
    const v = raw.trim().replace(/^urn:isbn:/i, "").replace(/^isbn:/i, "");
    const digits = v.replace(/[-\s]/g, "");
    // ISBN-13 (978/979 + 10 digits) or ISBN-10 (9 digits + check digit/X).
    if (/^(97[89])?\d{9}[\dxX]$/.test(digits)) return digits;
  }
  return undefined;
}

function asArray<T>(node: T | T[] | undefined | null): T[] {
  if (node == null) return [];
  return Array.isArray(node) ? node : [node];
}

// Raster formats only — SVG is deliberately excluded because covers are
// served publicly and RN <Image> can't render it anyway.
const ALLOWED_COVER_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
};

/**
 * Extract the cover image from an EPUB buffer. Supports both conventions:
 * - EPUB3: manifest item with properties containing "cover-image"
 * - EPUB2: <meta name="cover" content="<manifest item id>"> in metadata
 * Returns null when no cover is found or the input is malformed (never throws).
 */
export function extractEpubCover(buf: Uint8Array): EpubCover | null {
  try {
    const files = unzipSync(buf);
    const containerKey = Object.keys(files).find(
      (k) => k.toLowerCase() === "meta-inf/container.xml",
    );
    if (!containerKey) return null;

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      removeNSPrefix: true,
    });

    const container = parser.parse(strFromU8(files[containerKey]!));
    let rootfile = container?.container?.rootfiles?.rootfile;
    if (Array.isArray(rootfile)) rootfile = rootfile[0];
    const opfPath = rootfile?.["@_full-path"];
    if (!opfPath || typeof opfPath !== "string") return null;

    const opfKey =
      Object.keys(files).find((k) => k === opfPath) ??
      Object.keys(files).find(
        (k) => k.toLowerCase() === opfPath.toLowerCase(),
      );
    if (!opfKey) return null;

    const opf = parser.parse(strFromU8(files[opfKey]!));
    const pkg = opf?.package;
    if (!pkg) return null;

    const items = asArray<Record<string, unknown>>(pkg.manifest?.item);

    // EPUB3: properties="cover-image" (may hold multiple space-separated values).
    let coverItem = items.find((it) => {
      const props = it["@_properties"];
      return (
        typeof props === "string" &&
        props.split(/\s+/).includes("cover-image")
      );
    });

    // EPUB2: <meta name="cover" content="item-id">.
    if (!coverItem) {
      const metas = asArray<Record<string, unknown>>(pkg.metadata?.meta);
      const coverMeta = metas.find(
        (m) => String(m["@_name"] ?? "").toLowerCase() === "cover",
      );
      const coverId = coverMeta?.["@_content"];
      if (coverId != null) {
        coverItem = items.find(
          (it) => String(it["@_id"]) === String(coverId),
        );
      }
    }

    if (!coverItem) return null;
    const href = coverItem["@_href"];
    if (!href || typeof href !== "string") return null;

    // Resolve href relative to the OPF's directory, normalizing ../ segments.
    const opfDir = opfKey.includes("/")
      ? opfKey.slice(0, opfKey.lastIndexOf("/") + 1)
      : "";
    const decodedHref = decodeURIComponent(href);
    const segments: string[] = [];
    for (const seg of `${opfDir}${decodedHref}`.split("/")) {
      if (seg === "" || seg === ".") continue;
      if (seg === "..") segments.pop();
      else segments.push(seg);
    }
    const resolved = segments.join("/");

    const imageKey =
      Object.keys(files).find((k) => k === resolved) ??
      Object.keys(files).find(
        (k) => k.toLowerCase() === resolved.toLowerCase(),
      );
    if (!imageKey) return null;

    const data = files[imageKey]!;
    if (data.length === 0) return null;

    const declaredType = coverItem["@_media-type"];
    const ext = imageKey.split(".").pop()?.toLowerCase() ?? "";
    const mimeType =
      typeof declaredType === "string" && ALLOWED_COVER_MIMES.has(declaredType)
        ? declaredType
        : IMAGE_MIME_BY_EXT[ext];
    if (!mimeType || !ALLOWED_COVER_MIMES.has(mimeType)) return null;

    return { data, mimeType };
  } catch {
    return null;
  }
}

/**
 * Extract title/author/isbn from an EPUB buffer:
 * META-INF/container.xml -> OPF rootfile -> dc:title / dc:creator / dc:identifier.
 * Returns {} on any malformed input (never throws).
 */
export function extractEpubMetadata(buf: Uint8Array): EpubMetadata {
  try {
    const files = unzipSync(buf);
    const containerKey = Object.keys(files).find(
      (k) => k.toLowerCase() === "meta-inf/container.xml",
    );
    if (!containerKey) return {};

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      removeNSPrefix: true,
    });

    const container = parser.parse(strFromU8(files[containerKey]!));
    let rootfile = container?.container?.rootfiles?.rootfile;
    if (Array.isArray(rootfile)) rootfile = rootfile[0];
    const opfPath = rootfile?.["@_full-path"];
    if (!opfPath || typeof opfPath !== "string") return {};

    const opfKey =
      Object.keys(files).find((k) => k === opfPath) ??
      Object.keys(files).find(
        (k) => k.toLowerCase() === opfPath.toLowerCase(),
      );
    if (!opfKey) return {};

    const opf = parser.parse(strFromU8(files[opfKey]!));
    const metadata = opf?.package?.metadata;
    if (!metadata) return {};

    const title = textOf(metadata.title);
    const author = textOf(metadata.creator);
    const isbn = extractIsbn(collectStrings(metadata.identifier));

    return {
      ...(title ? { title } : {}),
      ...(author ? { author } : {}),
      ...(isbn ? { isbn } : {}),
    };
  } catch {
    return {};
  }
}
