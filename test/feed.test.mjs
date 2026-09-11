import assert from "node:assert/strict";
import test from "node:test";
import { renderFeed, validateManifest } from "../src/feed.mjs";

const release = {
  version: "42",
  shortVersion: "1.2.3",
  publishedAt: "2026-01-02T03:04:05Z",
  minimumSystemVersion: "14.0",
  description: "Safe ]]> notes",
  url: "https://example.com/Acme.dmg",
  length: 1234,
  mimeType: "application/octet-stream",
  edSignature: "signed",
};

test("renders a signed Sparkle feed and safely splits CDATA", () => {
  const xml = renderFeed({ title: "Acme & Co", releases: [release] });
  assert.match(xml, /<title>Acme &amp; Co<\/title>/);
  assert.match(xml, /Fri, 02 Jan 2026 03:04:05 \+0000/);
  assert.match(xml, /Safe \]\]\]\]><!\[CDATA\[> notes/);
  assert.match(xml, /sparkle:edSignature="signed"/);
});

test("rejects unsigned and insecure releases", () => {
  assert.throws(() => validateManifest({ title: "Acme", releases: [{ ...release, edSignature: undefined }] }), /signature/);
  assert.throws(() => validateManifest({ title: "Acme", releases: [{ ...release, url: "http://example.com/a.dmg" }] }), /HTTPS/);
});

test("renders an informational update as a manual download", () => {
  const manualRelease = {
    version: "43",
    shortVersion: "2.0.0",
    publishedAt: "2026-02-03T04:05:06Z",
    description: "The signing key changed. Download this version manually.",
    downloadPageUrl: "https://example.com/downloads/2.0.0",
  };
  const xml = renderFeed({ title: "Acme", releases: [manualRelease] });

  assert.match(xml, /<link>https:\/\/example\.com\/downloads\/2\.0\.0<\/link>/);
  assert.doesNotMatch(xml, /<enclosure/);
});

test("rejects ambiguous or insecure manual updates", () => {
  const manualRelease = {
    version: "43",
    shortVersion: "2.0.0",
    publishedAt: "2026-02-03T04:05:06Z",
    downloadPageUrl: "https://example.com/downloads/2.0.0",
  };

  assert.throws(
    () => validateManifest({ title: "Acme", releases: [{ ...manualRelease, url: release.url }] }),
    /cannot mix/,
  );
  assert.throws(
    () => validateManifest({ title: "Acme", releases: [{ ...manualRelease, downloadPageUrl: "http://example.com" }] }),
    /HTTPS/,
  );
});
