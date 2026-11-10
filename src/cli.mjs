#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { loadManifest, renderFeed } from "./feed.mjs";
import { renderReportHtml, renderReportMarkdown, summarizeLogs } from "./report.mjs";

const USAGE = "usage: twinkle render MANIFEST [OUTPUT] | report MANIFEST LOG... [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--previous REPORT.json] [--html OUTPUT] [--markdown OUTPUT]";
const REPORT_FLAGS = new Set(["--since", "--until", "--previous", "--html", "--markdown"]);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseReportArgs(args) {
  const flags = {};
  const logPaths = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      logPaths.push(arg);
      continue;
    }
    if (!REPORT_FLAGS.has(arg)) throw new Error(`unknown option ${arg}\n${USAGE}`);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
    flags[arg.slice(2)] = value;
    index += 1;
  }
  for (const key of ["since", "until"]) {
    if (flags[key] && !DATE.test(flags[key])) throw new Error(`--${key} must be YYYY-MM-DD`);
  }
  if (logPaths.length === 0) throw new Error(`report requires log files\n${USAGE}`);
  return { flags, logPaths };
}

async function main() {
  const [command, manifestPath, ...args] = process.argv.slice(2);
  if (command === "render" && manifestPath) {
    const output = renderFeed(await loadManifest(manifestPath));
    if (args[0]) await writeFile(args[0], output);
    else process.stdout.write(output);
    return;
  }
  if (command === "report" && manifestPath) {
    const { flags, logPaths } = parseReportArgs(args);
    const manifest = await loadManifest(manifestPath);
    const latestVersion = [...manifest.releases].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))[0].version;
    const report = await summarizeLogs(logPaths, { latestVersion, since: flags.since, until: flags.until, app: manifest.title });
    const previous = flags.previous ? JSON.parse(await readFile(flags.previous, "utf8")) : null;
    if (flags.html) await writeFile(flags.html, renderReportHtml(report));
    if (flags.markdown) await writeFile(flags.markdown, renderReportMarkdown(report, previous, `${manifest.title} update checks`));
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  throw new Error(USAGE);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
