import { readFile } from "node:fs/promises";
import { gunzip } from "node:zlib";
import { promisify } from "node:util";

const gunzipAsync = promisify(gunzip);

async function readLog(path) {
  const contents = await readFile(path);
  if (!path.endsWith(".gz")) return contents.toString("utf8");
  try {
    return (await gunzipAsync(contents)).toString("utf8");
  } catch (error) {
    throw new Error(`could not decompress ${path}: ${error.message}`, { cause: error });
  }
}

function increment(map, key) {
  const normalized = key || "unknown";
  map.set(normalized, (map.get(normalized) ?? 0) + 1);
}

function sortedObject(map) {
  return Object.fromEntries([...map].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

export async function summarizeLogs(paths, latestVersion) {
  const seen = new Set();
  const versions = new Map();
  const operatingSystems = new Map();
  let checks = 0;
  let currentVersionChecks = 0;

  for (const path of paths) {
    const text = await readLog(path);
    let fields = [];
    for (const line of text.split(/\r?\n/)) {
      if (line.startsWith("#Fields: ")) {
        fields = line.slice(9).trim().split(/\s+/);
        continue;
      }
      if (!line || line.startsWith("#") || fields.length === 0) continue;
      const values = line.split("\t");
      const row = Object.fromEntries(fields.map((field, index) => [field, values[index] ?? "-"]));
      const requestId = row["x-edge-request-id"];
      if (requestId !== "-" && seen.has(requestId)) continue;
      if (requestId !== "-") seen.add(requestId);
      if (row["sc-status"] !== "200" || !row["cs-uri-stem"]?.endsWith(".xml")) continue;

      const query = new URLSearchParams(row["cs-uri-query"] === "-" ? "" : row["cs-uri-query"]);
      const version = query.get("appVersion") ?? "unknown";
      increment(versions, version);
      increment(operatingSystems, query.get("osVersion"));
      checks += 1;
      if (version === latestVersion) currentVersionChecks += 1;
    }
  }

  const versionedChecks = checks - (versions.get("unknown") ?? 0);
  return {
    generatedAt: new Date().toISOString(),
    checks,
    latestVersion,
    currentVersionChecks,
    versionedChecks,
    adoptionBasisPoints: versionedChecks === 0 ? null : Math.round((currentVersionChecks * 10_000) / versionedChecks),
    byVersion: sortedObject(versions),
    byOperatingSystem: sortedObject(operatingSystems),
  };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

export function renderReportHtml(report) {
  const rows = (values) => Object.entries(values)
    .map(([key, count]) => `<tr><td>${escapeHtml(key)}</td><td>${count}</td></tr>`)
    .join("");
  const adoption = report.adoptionBasisPoints === null ? "unknown" : `${(report.adoptionBasisPoints / 100).toFixed(2)}%`;
  return `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Sparkle update checks</title>
<style>body{font:16px system-ui;max-width:52rem;margin:3rem auto;padding:0 1rem;color:#18181b}table{border-collapse:collapse;width:100%;margin-bottom:2rem}td,th{padding:.5rem;border-bottom:1px solid #ddd;text-align:left}small{color:#666}</style>
<h1>Sparkle update checks</h1><p>${report.checks} feed checks · estimated current-version adoption ${adoption}</p>
<small>Generated ${escapeHtml(report.generatedAt)}. Checks are not installs or completed downloads.</small>
<h2>Versions</h2><table><thead><tr><th>Version</th><th>Checks</th></tr></thead><tbody>${rows(report.byVersion)}</tbody></table>
<h2>Operating systems</h2><table><thead><tr><th>OS</th><th>Checks</th></tr></thead><tbody>${rows(report.byOperatingSystem)}</tbody></table></html>\n`;
}
