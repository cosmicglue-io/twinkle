import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { summarizeLogs } from "../src/report.mjs";

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

test("reports an actionable error for invalid gzip input", async () => {
  const directory = await mkdtemp(join(tmpdir(), "twinkle-"));
  const path = join(directory, "invalid.tsv.gz");
  await writeFile(path, "not gzip");

  await assert.rejects(summarizeLogs([path], "42"), /could not decompress .*invalid\.tsv\.gz:/);
});
