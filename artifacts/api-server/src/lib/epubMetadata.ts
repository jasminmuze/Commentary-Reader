import { unzipSync, strFromU8 } from "fflate";
import { XMLParser } from "fast-xml-parser";

export interface EpubMetadata {
  title?: string;
  author?: string;
  isbn?: string;
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
