#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { loadManifest, renderFeed } from "./feed.mjs";
import { renderReportHtml, summarizeLogs } from "./report.mjs";

const [command, manifestPath, ...args] = process.argv.slice(2);

async function main() {
  if (command === "render" && manifestPath) {
    const output = renderFeed(await loadManifest(manifestPath));
    if (args[0]) await writeFile(args[0], output);
    else process.stdout.write(output);
    return;
  }
  if (command === "report" && manifestPath && args.length > 0) {
    const manifest = await loadManifest(manifestPath);
    const htmlIndex = args.indexOf("--html");
    const htmlPath = htmlIndex === -1 ? null : args[htmlIndex + 1];
    const logPaths = htmlIndex === -1 ? args : args.filter((_, index) => index !== htmlIndex && index !== htmlIndex + 1);
    if (logPaths.length === 0 || (htmlIndex !== -1 && !htmlPath)) throw new Error("report requires log files and an optional --html path");
    const latestVersion = [...manifest.releases].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))[0].version;
    const report = await summarizeLogs(logPaths, latestVersion);
    if (htmlPath) await writeFile(htmlPath, renderReportHtml(report));
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  throw new Error("usage: twinkle render MANIFEST [OUTPUT] | report MANIFEST LOG... [--html OUTPUT]");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
