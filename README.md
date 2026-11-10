# Twinkle

Twinkle generates static [Sparkle](https://sparkle-project.org/) appcasts and summarizes CDN access logs locally. It has no hosted service, account, database, or telemetry of its own.

```sh
node src/cli.mjs render appcast.json appcast.xml
node src/cli.mjs report appcast.json access-log.tsv --html report.html
```

Installable releases require HTTPS enclosure URLs, positive content lengths, valid timestamps, and at least one EdDSA or DSA signature. A release can instead set `downloadPageUrl` to publish an informational update that opens a manual-download page without an enclosure. This is useful when moving users across a lost signing key; keep legacy and current signing-key feeds separate so future automatic updates remain valid.

The generator orders releases by publication time and safely encodes XML and inline release notes.

The reporter reads CloudFront standard-log files (plain or gzip), deduplicates rows by edge request ID, and returns JSON with update checks per day, feed and app version, plus breakdowns of Sparkle's opt-in system profiles: macOS version, chip, approximate Mac model year, Mac family, memory, cores, language, locale, and build. A check is any `200` or `304` feed response to a Sparkle client. Requests from other Sparkle apps that read the feed on a user's behalf (update checkers such as Latest) are counted separately under `byOtherChecker`, and non-Sparkle requests are ignored. Sparkle sends a system profile at most weekly per install, so `profiles.distinct` over a seven-day window approximates the number of opted-in installs. These measurements are update checks—not installations or completed downloads.

```sh
# Weekly report with changes against the previous week's JSON
node src/cli.mjs report appcast.json logs/*.gz \
  --since 2026-11-02 --until 2026-11-08 \
  --previous last-week.json --markdown report.md > this-week.json
```

`--since` and `--until` are inclusive UTC dates. `--markdown` writes tables suitable for an issue comment or email; `--html` writes a static page.

## Static hosting

Upload the generated XML to any HTTPS static host. For AWS, use a private versioned S3 bucket behind CloudFront. Configure CloudFront standard logging v2 to a private S3 prefix with:

```text
date time cs-uri-stem sc-status cs(User-Agent) cs-uri-query x-edge-request-id
```

Apply lifecycle retention to raw logs. Twinkle does not read client IP fields. CloudFront logs can arrive late or more than once, so reports should be regenerated for overlapping time windows.

## Development

```sh
npm test
```

Twinkle is available under the Apache-2.0 license.
