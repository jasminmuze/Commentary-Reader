/**
 * Standalone production server for Expo static builds.
 *
 * Serves the output of build.js (static-build/) with two special routes:
 * - GET / or /manifest with expo-platform header → platform manifest JSON
 * - GET / without expo-platform → landing page HTML
 * Everything else falls through to static file serving from ./static-build/.
 *
 * Zero external dependencies — uses only Node.js built-ins (http, fs, path).
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const STATIC_ROOT = path.resolve(__dirname, "..", "static-build");
const TEMPLATE_PATH = path.resolve(__dirname, "templates", "landing-page.html");
const ACCOUNT_DELETION_TEMPLATE_PATH = path.resolve(
  __dirname,
  "templates",
  "account-deletion.html",
);
const ROOM_INVITE_TEMPLATE_PATH = path.resolve(
  __dirname,
  "templates",
  "room-invite.html",
);
const PRIVACY_POLICY_TEMPLATE_PATH = path.resolve(
  __dirname,
  "templates",
  "privacy-policy.html",
);
const SUPPORT_TEMPLATE_PATH = path.resolve(
  __dirname,
  "templates",
  "support.html",
);
const TERMS_OF_USE_TEMPLATE_PATH = path.resolve(
  __dirname,
  "templates",
  "terms-of-use.html",
);
const basePath = (process.env.BASE_PATH || "/").replace(/\/+$/, "");
const CURRENT_EAS_ANDROID_SIGNING_SHA256 =
  "5E:29:DB:42:43:B6:7B:F7:49:47:BE:3B:24:1B:80:76:8B:A4:15:8A:68:FA:2F:4B:5C:BA:C1:AE:51:B9:7D:AF";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".map": "application/json",
};

function getAppName() {
  try {
    const appJsonPath = path.resolve(__dirname, "..", "app.json");
    const appJson = JSON.parse(fs.readFileSync(appJsonPath, "utf-8"));
    return appJson.expo?.name || "App Landing Page";
  } catch {
    return "App Landing Page";
  }
}

function serveManifest(platform, res) {
  const manifestPath = path.join(STATIC_ROOT, platform, "manifest.json");

  if (!fs.existsSync(manifestPath)) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(
      JSON.stringify({ error: `Manifest not found for platform: ${platform}` }),
    );
    return;
  }

  const manifest = fs.readFileSync(manifestPath, "utf-8");
  res.writeHead(200, {
    "content-type": "application/json",
    "expo-protocol-version": "1",
    "expo-sfv-version": "0",
  });
  res.end(manifest);
}

function serveLandingPage(req, res, landingPageTemplate, appName) {
  const forwardedProto = req.headers["x-forwarded-proto"];
  const protocol = forwardedProto || "https";
  const host = req.headers["x-forwarded-host"] || req.headers["host"];
  const baseUrl = `${protocol}://${host}`;
  const expsUrl = `${host}`;

  const html = landingPageTemplate
    .replace(/BASE_URL_PLACEHOLDER/g, baseUrl)
    .replace(/EXPS_URL_PLACEHOLDER/g, expsUrl)
    .replace(/APP_NAME_PLACEHOLDER/g, appName);

  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
}

function serveAccountDeletionPage(req, res, accountDeletionTemplate) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, {
      "content-type": "text/plain; charset=utf-8",
      allow: "GET, HEAD",
      "cache-control": "no-store",
    });
    res.end("Method Not Allowed");
    return;
  }

  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  res.end(req.method === "HEAD" ? undefined : accountDeletionTemplate);
}

function serveRoomInvitePage(req, res, template, url, roomId) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, {
      "content-type": "text/plain; charset=utf-8",
      allow: "GET, HEAD",
      "cache-control": "no-store",
    });
    res.end("Method Not Allowed");
    return;
  }

  const appUrl = `shelfmates:///room/${roomId}${url.search}`;
  const htmlData = JSON.stringify({
    appUrl,
    iosInstallUrl: getVerifiedHttpsUrl(process.env.SHELF_MATES_IOS_INSTALL_URL),
    androidInstallUrl: getVerifiedHttpsUrl(
      process.env.SHELF_MATES_ANDROID_INSTALL_URL,
    ),
  }).replace(/</g, "\\u003c");
  const html = template.replace("ROOM_INVITE_DATA", htmlData);
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "content-security-policy":
      "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  });
  res.end(req.method === "HEAD" ? undefined : html);
}

function getVerifiedHttpsUrl(value) {
  try {
    const parsed = new URL(value || "");
    return parsed.protocol === "https:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function serveAppleAppSiteAssociation(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, {
      "content-type": "text/plain; charset=utf-8",
      allow: "GET, HEAD",
      "cache-control": "no-store",
    });
    res.end("Method Not Allowed");
    return;
  }

  const teamId = process.env.IOS_APPLE_TEAM_ID?.trim().toUpperCase() || "";
  if (!/^[A-Z0-9]{10}$/.test(teamId)) {
    res.writeHead(503, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(
      req.method === "HEAD"
        ? undefined
        : JSON.stringify({ error: "Universal Links are not configured" }),
    );
    return;
  }

  const body = JSON.stringify({
    applinks: {
      apps: [],
      details: [{ appID: `${teamId}.app.shelfmates`, paths: ["/room/*"] }],
    },
  });
  res.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "public, max-age=300",
    "x-content-type-options": "nosniff",
  });
  res.end(req.method === "HEAD" ? undefined : body);
}

function serveAndroidAssetLinks(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, {
      "content-type": "text/plain; charset=utf-8",
      allow: "GET, HEAD",
      "cache-control": "no-store",
    });
    res.end("Method Not Allowed");
    return;
  }

  const rawFingerprints =
    process.env.ANDROID_APP_LINK_SHA256_FINGERPRINTS ??
    process.env.ANDROID_APP_LINK_SHA256_FINGERPRINT ??
    CURRENT_EAS_ANDROID_SIGNING_SHA256;
  const fingerprints = rawFingerprints
    .split(/[\s,;]+/)
    .filter(Boolean)
    .map((fingerprint) => fingerprint.toUpperCase().replace(/:/g, ""));
  if (
    fingerprints.length === 0 ||
    fingerprints.some((fingerprint) => !/^[A-F0-9]{64}$/.test(fingerprint))
  ) {
    res.writeHead(503, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(
      req.method === "HEAD"
        ? undefined
        : JSON.stringify({ error: "Android App Links are not configured" }),
    );
    return;
  }

  const formattedFingerprints = [
    ...new Set(
      fingerprints.map((fingerprint) => fingerprint.match(/.{2}/g).join(":")),
    ),
  ];
  const body = JSON.stringify([
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: "app.shelfmates",
        sha256_cert_fingerprints: formattedFingerprints,
      },
    },
  ]);
  res.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "public, max-age=300",
    "x-content-type-options": "nosniff",
  });
  res.end(req.method === "HEAD" ? undefined : body);
}

function serveStaticFile(urlPath, res) {
  const safePath = path.normalize(urlPath).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = path.join(STATIC_ROOT, safePath);

  if (!filePath.startsWith(STATIC_ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    res.end("Not Found");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  const content = fs.readFileSync(filePath);
  res.writeHead(200, { "content-type": contentType });
  res.end(content);
}

const landingPageTemplate = fs.readFileSync(TEMPLATE_PATH, "utf-8");
const accountDeletionTemplate = fs.readFileSync(
  ACCOUNT_DELETION_TEMPLATE_PATH,
  "utf-8",
);
const roomInviteTemplate = fs.readFileSync(ROOM_INVITE_TEMPLATE_PATH, "utf-8");
const privacyPolicyTemplate = fs.readFileSync(
  PRIVACY_POLICY_TEMPLATE_PATH,
  "utf-8",
);
const supportTemplate = fs.readFileSync(SUPPORT_TEMPLATE_PATH, "utf-8");
const termsOfUseTemplate = fs.readFileSync(
  TERMS_OF_USE_TEMPLATE_PATH,
  "utf-8",
);
const appName = getAppName();

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  let pathname = url.pathname;

  if (basePath && pathname.startsWith(basePath)) {
    pathname = pathname.slice(basePath.length) || "/";
  }

  if (pathname.replace(/\/+$/, "") === "/account-deletion") {
    return serveAccountDeletionPage(req, res, accountDeletionTemplate);
  }
  if (pathname.replace(/\/+$/, "") === "/privacy-policy") {
    return serveAccountDeletionPage(req, res, privacyPolicyTemplate);
  }
  if (pathname.replace(/\/+$/, "") === "/support") {
    return serveAccountDeletionPage(req, res, supportTemplate);
  }
  if (pathname.replace(/\/+$/, "") === "/terms-of-use") {
    return serveAccountDeletionPage(req, res, termsOfUseTemplate);
  }
  if (pathname === "/.well-known/apple-app-site-association") {
    return serveAppleAppSiteAssociation(req, res);
  }
  if (pathname === "/.well-known/assetlinks.json") {
    return serveAndroidAssetLinks(req, res);
  }
  const roomInviteMatch = /^\/room\/([1-9]\d*)\/?$/.exec(pathname);
  if (roomInviteMatch) {
    return serveRoomInvitePage(
      req,
      res,
      roomInviteTemplate,
      url,
      Number(roomInviteMatch[1]),
    );
  }

  if (pathname === "/" || pathname === "/manifest") {
    const platform = req.headers["expo-platform"];
    if (platform === "ios" || platform === "android") {
      return serveManifest(platform, res);
    }

    if (pathname === "/") {
      return serveLandingPage(req, res, landingPageTemplate, appName);
    }
  }

  serveStaticFile(pathname, res);
});

const port = parseInt(process.env.PORT || "3000", 10);
server.listen(port, "0.0.0.0", () => {
  console.log(`Serving static Expo build on port ${port}`);
});
