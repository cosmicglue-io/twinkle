import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { renderReportMarkdown, summarizeLogs } from "../src/report.mjs";

test("summarizes appcast checks and deduplicates delivered log rows", async () => {
  const directory = await mkdtemp(join(tmpdir(), "twinkle-"));
  const log = join(directory, "access.tsv");
  const header = "#Fields: date time cs-uri-stem sc-status cs-uri-query x-edge-request-id\n";
  const current = "2026-01-01\t00:00:00\t/appcast/acme.xml\t200\tappVersion=42&osVersion=15.0\trequest-a\n";
  const old = "2026-01-01\t00:01:00\t/appcast/acme.xml\t200\tappVersion=41&osVersion=14.0\trequest-b\n";
  await writeFile(log, header + current + current + old + "2026-01-01\t00:02:00\t/appcast/missing.xml\t404\t-\trequest-c\n");
  const report = await summarizeLogs([log], "42");
  assert.equal(report.checks, 2);
  assert.equal(report.adoptionBasisPoints, 5000);
  assert.deepEqual(report.byVersion, { "41": 1, "42": 1 });
});

test("reads gzip logs and deduplicates requests across files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "twinkle-"));
  const plainPath = join(directory, "access.tsv");
  const gzipPath = join(directory, "access.tsv.gz");
  const header = "#Fields: date time cs-uri-stem sc-status cs-uri-query x-edge-request-id\n";
  const current = "2026-01-01\t00:00:00\t/appcast/acme.xml\t200\tappVersion=42&osVersion=15.0\trequest-a\n";
  const old = "2026-01-01\t00:01:00\t/appcast/acme.xml\t200\tappVersion=41&osVersion=14.0\trequest-b\n";
  await writeFile(plainPath, header + current);
  await writeFile(gzipPath, gzipSync(header + current + old));

  const report = await summarizeLogs([plainPath, gzipPath], "42");
  assert.equal(report.checks, 2);
  assert.equal(report.adoptionBasisPoints, 5000);
  assert.deepEqual(report.byVersion, { "41": 1, "42": 1 });
});

const cloudfrontHeader = "#Fields: date\ttime\tcs-uri-stem\tsc-status\tcs(User-Agent)\tcs-uri-query\tx-edge-request-id\n";
const profile = "osVersion=26.5.0&cputype=16777228&model=Mac14,13&ncpu=12&lang=de-DE&appVersion=42&ramMB=32768";
const intelProfile = "osVersion=15.7.1&cputype=7&model=MacBookPro16,1&ncpu=8&lang=en-US&appVersion=41&ramMB=16384";

async function writeCloudFrontLog(rows) {
  const directory = await mkdtemp(join(tmpdir(), "twinkle-"));
  const path = join(directory, "access.tsv");
  await writeFile(path, cloudfrontHeader + rows.map((row) => `${row.join("\t")}\n`).join(""));
  return path;
}

test("counts unchanged responses, ignores non-Sparkle clients, and summarizes profiles", async () => {
  const path = await writeCloudFrontLog([
    ["2026-01-01", "00:00:00", "/acme.xml", "200", "Acme/1.2.3%20Sparkle/2.7.0", profile, "a"],
    ["2026-01-01", "01:00:00", "/acme.xml", "304", "Acme/1.2.3%20Sparkle/2.7.0", "-", "b"],
    ["2026-01-02", "00:00:00", "/acme.xml", "200", "Acme/1.2.3%20Sparkle/2.7.0", profile, "c"],
    ["2026-01-02", "00:00:00", "/acme-legacy.xml", "200", "Acme/1.1.0%20Sparkle/1.19.1", intelProfile, "d"],
    ["2026-01-02", "00:00:00", "/acme.xml", "200", "curl/8.0", "-", "e"],
    ["2026-01-02", "00:00:00", "/", "403", "scanner", "-", "f"],
    ["2026-01-02", "00:00:00", "/acme.xml", "304", "Latest/0.12%20Sparkle/2.5.1", "-", "g"],
  ]);
  const report = await summarizeLogs([path], { latestVersion: "42", app: "Acme" });

  assert.equal(report.checks, 4);
  assert.equal(report.ignoredRequests, 2);
  assert.deepEqual(report.byOtherChecker, { Latest: 1 });
  assert.deepEqual(report.window, { from: "2026-01-01", to: "2026-01-02", days: 2 });
  assert.deepEqual(report.byDay, { "2026-01-01": 2, "2026-01-02": 2 });
  assert.deepEqual(report.byFeed, { "/acme.xml": 3, "/acme-legacy.xml": 1 });
  assert.deepEqual(report.byAppVersion, { "1.2.3": 3, "1.1.0": 1 });
  assert.equal(report.adoptionBasisPoints, 6667);

  const profiles = report.profiles;
  assert.equal(profiles.checks, 3);
  assert.equal(profiles.distinct, 2);
  assert.deepEqual(profiles.byLanguage, { de: 1, en: 1 });
  assert.deepEqual(profiles.byMacOS, { "15": 1, "26": 1 });
  assert.deepEqual(profiles.byArchitecture, { "Apple Silicon": 1, Intel: 1 });
  assert.deepEqual(profiles.byModelYear, { "2019–20": 1, "2023–24": 1 });
  assert.deepEqual(profiles.byModelFamily, { Mac: 1, MacBookPro: 1 });
  assert.deepEqual(profiles.byMemoryGB, { "16": 1, "32": 1 });
});

test("limits a report to an inclusive date window", async () => {
  const path = await writeCloudFrontLog([
    ["2026-01-01", "00:00:00", "/acme.xml", "200", "Acme/1.2.3%20Sparkle/2.7.0", "-", "a"],
    ["2026-01-02", "00:00:00", "/acme.xml", "304", "Acme/1.2.3%20Sparkle/2.7.0", "-", "b"],
    ["2026-01-03", "00:00:00", "/acme.xml", "304", "Acme/1.2.3%20Sparkle/2.7.0", "-", "c"],
  ]);
  const report = await summarizeLogs([path], { latestVersion: "42", since: "2026-01-02", until: "2026-01-02" });
  assert.equal(report.checks, 1);
  assert.deepEqual(report.window, { from: "2026-01-02", to: "2026-01-02", days: 1 });
});

test("renders markdown with week-over-week changes", async () => {
  const path = await writeCloudFrontLog([
    ["2026-01-01", "00:00:00", "/acme.xml", "200", "Acme/1.2.3%20Sparkle/2.7.0", profile, "a"],
    ["2026-01-01", "00:00:00", "/acme.xml", "200", "Acme/1.1.0%20Sparkle/2.7.0", intelProfile, "b"],
  ]);
  const report = await summarizeLogs([path], "42");
  const previous = structuredClone(report);
  previous.profiles.distinct = 1;
  previous.profiles.byLanguage = { en: 1 };

  const markdown = renderReportMarkdown(report, previous, "Acme update checks");
  assert.match(markdown, /^## Acme update checks: 2026-01-01 → 2026-01-01\n/);
  assert.match(markdown, /\| Profiled Macs \(distinct\) \| 2 \| \+1 \(\+100%\) \|/);
  assert.match(markdown, /\| de \| 50\.0% \| \+50\.0 pt \|/);
  assert.match(markdown, /\| en \| 50\.0% \| −50\.0 pt \|/);
  assert.match(markdown, /\| 2026-01-01 \| 2 \|/);
  assert.doesNotMatch(markdown, /\n\n\n/);
});

test("reports an actionable error for invalid gzip input", async () => {
  const directory = await mkdtemp(join(tmpdir(), "twinkle-"));
  const path = join(directory, "invalid.tsv.gz");
  await writeFile(path, "not gzip");

  await assert.rejects(summarizeLogs([path], "42"), /could not decompress .*invalid\.tsv\.gz:/);
});
