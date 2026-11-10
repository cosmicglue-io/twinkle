import { readFile } from "node:fs/promises";
import { gunzip } from "node:zlib";
import { promisify } from "node:util";
import { architecture, modelFamily, modelYearBucket } from "./macs.mjs";

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

function chronologicalObject(map) {
  return Object.fromEntries([...map].sort((a, b) => a[0].localeCompare(b[0])));
}

function decodeField(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

// Sparkle's User-Agent is "<App>/<shortVersion> Sparkle/<version>".
function parseSparkleUserAgent(userAgent) {
  const match = /^(.+?)\/(\S+)\s+Sparkle\//.exec(userAgent);
  return match ? { app: match[1], version: match[2] } : { app: null, version: null };
}

function macOSMajor(osVersion) {
  if (!osVersion) return null;
  const [major, minor] = osVersion.split(".");
  return major === "10" && minor ? `10.${minor}` : major;
}

function language(locale) {
  return locale?.split(/[-_]/)[0] || null;
}

function memoryGB(ramMB) {
  const megabytes = Number(ramMB);
  return Number.isFinite(megabytes) && megabytes > 0 ? String(Math.round(megabytes / 1024)) : null;
}

// Sparkle sends a system profile at most once a week per install, so repeated
// identical profiles within a report window describe the same Mac.
function profileFingerprint(query) {
  return ["model", "osVersion", "lang", "ramMB", "ncpu", "cputype", "appVersion"].map((key) => query.get(key) ?? "").join("|");
}

function normalizeOptions(options) {
  return typeof options === "string" ? { latestVersion: options } : (options ?? {});
}

export async function summarizeLogs(paths, options) {
  const { latestVersion = null, since = null, until = null, app = null } = normalizeOptions(options);
  const appName = app?.toLowerCase() ?? null;
  const otherCheckers = new Map();
  const seen = new Set();
  const profiles = new Map();
  const versions = new Map();
  const operatingSystems = new Map();
  const days = new Map();
  const feeds = new Map();
  const appVersions = new Map();
  let checks = 0;
  let ignoredRequests = 0;
  let currentVersionChecks = 0;
  let profiledChecks = 0;
  let firstDate = null;
  let lastDate = null;

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

      const date = row.date;
      if ((since && date < since) || (until && date > until)) continue;

      // 304 responses are Sparkle checks that found an unchanged feed.
      const status = row["sc-status"];
      const isFeed = (status === "200" || status === "304") && row["cs-uri-stem"]?.endsWith(".xml");
      const userAgent = fields.includes("cs(User-Agent)") ? decodeField(row["cs(User-Agent)"]) : null;
      if (!isFeed || (userAgent !== null && !userAgent.includes("Sparkle/"))) {
        ignoredRequests += 1;
        continue;
      }
      const agent = userAgent === null ? null : parseSparkleUserAgent(userAgent);
      // Other Sparkle apps (update checkers such as Latest) read the feed on behalf of their users.
      if (appName && agent?.app && agent.app.toLowerCase() !== appName) {
        increment(otherCheckers, agent.app);
        continue;
      }

      checks += 1;
      increment(days, date);
      increment(feeds, row["cs-uri-stem"]);
      if (agent) increment(appVersions, agent.version);
      if (date && date !== "-") {
        if (!firstDate || date < firstDate) firstDate = date;
        if (!lastDate || date > lastDate) lastDate = date;
      }

      const query = new URLSearchParams(row["cs-uri-query"] === "-" ? "" : row["cs-uri-query"]);
      const version = query.get("appVersion") ?? "unknown";
      increment(versions, version);
      increment(operatingSystems, query.get("osVersion"));
      if (version === latestVersion) currentVersionChecks += 1;
      if (query.has("osVersion") || query.has("model")) {
        profiledChecks += 1;
        profiles.set(profileFingerprint(query), query);
      }
    }
  }

  const breakdown = (key) => {
    const counts = new Map();
    for (const query of profiles.values()) increment(counts, key(query));
    return sortedObject(counts);
  };

  const versionedChecks = checks - (versions.get("unknown") ?? 0);
  return {
    generatedAt: new Date().toISOString(),
    window: { from: since ?? firstDate, to: until ?? lastDate, days: days.size },
    checks,
    ignoredRequests,
    latestVersion,
    currentVersionChecks,
    versionedChecks,
    adoptionBasisPoints: versionedChecks === 0 ? null : Math.round((currentVersionChecks * 10_000) / versionedChecks),
    byDay: chronologicalObject(days),
    byFeed: sortedObject(feeds),
    byAppVersion: sortedObject(appVersions),
    byVersion: sortedObject(versions),
    byOperatingSystem: sortedObject(operatingSystems),
    byOtherChecker: sortedObject(otherCheckers),
    profiles: {
      checks: profiledChecks,
      distinct: profiles.size,
      byBuild: breakdown((query) => query.get("appVersion")),
      byMacOS: breakdown((query) => macOSMajor(query.get("osVersion"))),
      byArchitecture: breakdown((query) => architecture(query.get("cputype"))),
      byModelYear: breakdown((query) => modelYearBucket(query.get("model"))),
      byModelFamily: breakdown((query) => modelFamily(query.get("model"))),
      byModel: breakdown((query) => query.get("model")),
      byMemoryGB: breakdown((query) => memoryGB(query.get("ramMB"))),
      byCores: breakdown((query) => query.get("ncpu")),
      byLanguage: breakdown((query) => language(query.get("lang"))),
      byLocale: breakdown((query) => query.get("lang")),
    },
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
<h1>Sparkle update checks</h1><p>${report.checks} feed checks · ${report.profiles.distinct} distinct system profiles · estimated current-version adoption ${adoption}</p>
<small>Generated ${escapeHtml(report.generatedAt)}. Checks are not installs or completed downloads.</small>
<h2>App versions</h2><table><thead><tr><th>Version</th><th>Checks</th></tr></thead><tbody>${rows(report.byAppVersion)}</tbody></table>
<h2>Feeds</h2><table><thead><tr><th>Feed</th><th>Checks</th></tr></thead><tbody>${rows(report.byFeed)}</tbody></table>
<h2>macOS (profiles)</h2><table><thead><tr><th>macOS</th><th>Profiles</th></tr></thead><tbody>${rows(report.profiles.byMacOS)}</tbody></table>
<h2>Languages (profiles)</h2><table><thead><tr><th>Language</th><th>Profiles</th></tr></thead><tbody>${rows(report.profiles.byLanguage)}</tbody></table>
<h2>Mac age (profiles)</h2><table><thead><tr><th>Model year</th><th>Profiles</th></tr></thead><tbody>${rows(report.profiles.byModelYear)}</tbody></table>
<h2>Daily checks</h2><table><thead><tr><th>Date</th><th>Checks</th></tr></thead><tbody>${rows(report.byDay)}</tbody></table></html>\n`;
}

function share(count, total) {
  return total === 0 ? 0 : (count * 100) / total;
}

function signed(value, digits = 0) {
  const rounded = Number(value.toFixed(digits));
  if (rounded === 0) return "±0";
  return `${rounded > 0 ? "+" : "−"}${Math.abs(rounded).toFixed(digits)}`;
}

function total(values) {
  return Object.values(values ?? {}).reduce((sum, count) => sum + count, 0);
}

function shareTable(title, values, previous, limit = 10) {
  const sum = total(values);
  if (sum === 0) return "";
  const previousSum = total(previous);
  // JSON objects list integer-like keys first, so restore count order here.
  const entries = Object.entries(values).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], undefined, { numeric: true }));
  const lines = [`### ${title}`, "", previous ? "| | Share | Change |" : "| | Share |", previous ? "|---|---:|---:|" : "|---|---:|"];
  for (const [key, count] of entries.slice(0, limit)) {
    const percent = share(count, sum);
    const cell = `${percent.toFixed(1)}%`;
    if (!previous) {
      lines.push(`| ${key} | ${cell} |`);
      continue;
    }
    const before = previousSum === 0 ? 0 : share(previous[key] ?? 0, previousSum);
    lines.push(`| ${key} | ${cell} | ${signed(percent - before, 1)} pt |`);
  }
  if (entries.length > limit) {
    const rest = entries.slice(limit).reduce((sum_, [, count]) => sum_ + count, 0);
    const label = entries.length - limit === 1 ? "1 other" : `${entries.length - limit} others`;
    lines.push(`| ${label} | ${share(rest, sum).toFixed(1)}% |${previous ? " |" : ""}`);
  }
  return `${lines.join("\n")}\n`;
}

function headline(label, value, before, format = (number) => String(Math.round(number))) {
  if (before === undefined || before === null) return `| ${label} | ${format(value)} | |`;
  const change = before === 0 ? "" : ` (${signed(((value - before) * 100) / before)}%)`;
  return `| ${label} | ${format(value)} | ${signed(value - before)}${change} |`;
}

function dailyAverage(report) {
  return report.window.days ? report.checks / report.window.days : 0;
}

export function renderReportMarkdown(report, previous = null, title = "Sparkle update checks") {
  const p = report.profiles;
  const q = previous?.profiles;
  // Share of distinct profiles already on the newest build.
  const adoption = (r) => {
    if (!r?.profiles?.distinct || !r.latestVersion) return null;
    return ((r.profiles.byBuild[r.latestVersion] ?? 0) * 100) / r.profiles.distinct;
  };
  const current = adoption(report);
  const before = adoption(previous);
  const otherChecks = total(report.byOtherChecker);
  const summary = [
    previous ? "| | This period | Change |" : "| | This period | |",
    "|---|---:|---:|",
    headline("Profiled Macs (distinct)", p.distinct, q?.distinct),
    headline("Update checks per day", dailyAverage(report), previous ? dailyAverage(previous) : null),
    headline("Update checks", report.checks, previous?.checks),
    current === null
      ? `| Profiles on build ${report.latestVersion ?? "latest"} | unknown | |`
      : `| Profiles on build ${report.latestVersion} | ${current.toFixed(1)}% | ${before === null ? "" : `${signed(current - before, 1)} pt`} |`,
    otherChecks ? headline("Checks by other update apps", otherChecks, previous ? total(previous.byOtherChecker) : null) : "",
  ].filter(Boolean).join("\n");
  const daily = [
    "### Daily checks",
    "",
    "| Date | Checks |",
    "|---|---:|",
    ...Object.entries(report.byDay).map(([date, count]) => `| ${date} | ${count} |`),
  ].join("\n");
  const blocks = [
    `## ${title}: ${report.window.from} → ${report.window.to}`,
    summary,
    "Checks count every Sparkle request for a feed, including unchanged (304) responses. Profiled Macs are distinct opt-in system profiles; Sparkle sends one at most weekly per install.",
    shareTable("App version (all checks)", report.byAppVersion, previous?.byAppVersion),
    shareTable("Feed", report.byFeed, previous?.byFeed),
    shareTable("macOS", p.byMacOS, q?.byMacOS),
    shareTable("Chip", p.byArchitecture, q?.byArchitecture),
    shareTable("Mac age (approx. model year)", p.byModelYear, q?.byModelYear),
    shareTable("Mac family", p.byModelFamily, q?.byModelFamily),
    shareTable("Memory (GB)", p.byMemoryGB, q?.byMemoryGB),
    shareTable("CPU cores", p.byCores, q?.byCores),
    shareTable("Language", p.byLanguage, q?.byLanguage),
    shareTable("Locale", p.byLocale, q?.byLocale),
    shareTable("Build (profiles)", p.byBuild, q?.byBuild),
    shareTable("Other update apps reading the feed", report.byOtherChecker, previous?.byOtherChecker),
    daily,
  ];
  return `${blocks.filter(Boolean).map((block) => block.trimEnd()).join("\n\n")}\n`;
}
