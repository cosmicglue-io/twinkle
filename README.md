# Twinkle

Twinkle generates static [Sparkle](https://sparkle-project.org/) appcasts and summarizes CDN access logs locally. It has no hosted service, account, database, or telemetry of its own.

```sh
node src/cli.mjs render appcast.json appcast.xml
node src/cli.mjs report appcast.json access-log.tsv --html report.html
```

Installable releases require HTTPS enclosure URLs, positive content lengths, valid timestamps, and at least one EdDSA or DSA signature. A release can instead set `downloadPageUrl` to publish an informational update that opens a manual-download page without an enclosure. This is useful when moving users across a lost signing key; keep legacy and current signing-key feeds separate so future automatic updates remain valid.

The generator orders releases by publication time and safely encodes XML and inline release notes.

The reporter reads CloudFront standard-log files, deduplicates rows by edge request ID, and returns JSON with update checks, versions, operating systems, and estimated current-version adoption. Its optional HTML output is static. These measurements are update checks—not installations or completed downloads.

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
