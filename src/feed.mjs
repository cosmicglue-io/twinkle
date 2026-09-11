import { readFile } from "node:fs/promises";

const SPARKLE_NS = "http://www.andymatuschak.org/xml-namespaces/sparkle";

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function cdata(value) {
  return String(value).replaceAll("]]>", "]]]]><![CDATA[>");
}

function requiredString(value, field) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
}

export function validateManifest(manifest) {
  if (!manifest || typeof manifest !== "object") throw new Error("manifest must be an object");
  requiredString(manifest.title, "title");
  if (!Array.isArray(manifest.releases) || manifest.releases.length === 0) {
    throw new Error("releases must contain at least one release");
  }

  const versions = new Set();
  for (const [index, release] of manifest.releases.entries()) {
    const prefix = `releases[${index}]`;
    for (const field of ["version", "shortVersion", "publishedAt", "url", "mimeType"]) {
      requiredString(release[field], `${prefix}.${field}`);
    }
    if (!Number.isSafeInteger(release.length) || release.length <= 0) {
      throw new Error(`${prefix}.length must be a positive integer`);
    }
    if (!release.edSignature && !release.dsaSignature) {
      throw new Error(`${prefix} needs an EdDSA or DSA signature`);
    }
    if (Number.isNaN(Date.parse(release.publishedAt))) {
      throw new Error(`${prefix}.publishedAt must be an ISO-8601 timestamp`);
    }
    const url = new URL(release.url);
    if (url.protocol !== "https:") throw new Error(`${prefix}.url must use HTTPS`);
    if (versions.has(release.version)) throw new Error(`duplicate version ${release.version}`);
    versions.add(release.version);
  }
  return manifest;
}

export function renderFeed(input) {
  const manifest = validateManifest(structuredClone(input));
  manifest.releases.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  const lines = [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<rss xmlns:sparkle="${SPARKLE_NS}" version="2.0">`,
    "  <channel>",
    `    <title>${escapeXml(manifest.title)}</title>`,
  ];

  for (const release of manifest.releases) {
    lines.push("    <item>");
    lines.push(`      <title>${escapeXml(release.shortVersion)}</title>`);
    lines.push(`      <pubDate>${new Date(release.publishedAt).toUTCString().replace("GMT", "+0000")}</pubDate>`);
    lines.push(`      <sparkle:version>${escapeXml(release.version)}</sparkle:version>`);
    lines.push(`      <sparkle:shortVersionString>${escapeXml(release.shortVersion)}</sparkle:shortVersionString>`);
    if (release.minimumSystemVersion) {
      lines.push(`      <sparkle:minimumSystemVersion>${escapeXml(release.minimumSystemVersion)}</sparkle:minimumSystemVersion>`);
    }
    if (release.description) lines.push(`      <description><![CDATA[${cdata(release.description)}]]></description>`);
    if (release.releaseNotesUrl) {
      lines.push(`      <sparkle:releaseNotesLink>${escapeXml(release.releaseNotesUrl)}</sparkle:releaseNotesLink>`);
    }
    let enclosure = `      <enclosure url="${escapeXml(release.url)}" length="${release.length}" type="${escapeXml(release.mimeType)}"`;
    if (release.edSignature) enclosure += ` sparkle:edSignature="${escapeXml(release.edSignature)}"`;
    if (release.dsaSignature) enclosure += ` sparkle:dsaSignature="${escapeXml(release.dsaSignature)}"`;
    lines.push(`${enclosure}/>`);
    lines.push("    </item>");
  }
  lines.push("  </channel>", "</rss>", "");
  return lines.join("\n");
}

export async function loadManifest(path) {
  return validateManifest(JSON.parse(await readFile(path, "utf8")));
}
