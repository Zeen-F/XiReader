# Desktop dependency security verification

The compatible dependency refresh keeps Electron on major 44 and preserves the existing APIs, library formats, package identity and browser fetch implementation.

## Updated dependency graph

| Dependency | Previous | Updated | Role |
| --- | --- | --- | --- |
| body-parser | 2.3.0 | 2.4.0 | Express JSON parsing, shipped |
| Electron | 44.6.0 | 44.9.3 | Desktop binary |
| undici | 7.30.0 | 7.30.1 | Explicit application runtime fetch; also Electron download tooling |
| undici under node-gyp | 6.29.0 | 6.29.1 | Build tooling only |
| zod | 4.6.5 | 4.6.7 | MCP validation, shipped |
| multer | 2.4.0 | 2.5.0 | PDF upload parsing, shipped |
| fast-uri | 3.1.8 | 3.1.9 | MCP SDK/Ajv dependency, shipped |
| ip-address | 10.7.3 | 10.7.5 | MCP SDK HTTP dependencies, shipped; application uses stdio |
| Vite | 8.3.2 | 8.3.5 | Development/build only |

The lockfile also updates dependencies required by these compatible versions, including Rolldown, PostCSS and qs. No package major version changes are needed.

## Embedded runtime limitation and application containment

Electron 44.9.3 reports Node 24.22.0 and embedded undici 7.29.1. A malformed upstream response with excessive content encodings followed by an early close still terminates an isolated process using that embedded `globalThis.fetch`. Updating an npm lockfile does not repair Electron's embedded copy.

`server/fetch.mjs` therefore exports the explicit patched undici dependency. The translation adapter, MCP HTTP bridge, plugin runtime probe and desktop runtime/main requests import it. There is no global monkey patch, custom TLS bypass, expanded network access or change to browser fetch. Existing redirect rejection, abort signals, origin/library validation and credential handling remain in place.

This contains the identified issue at the application's current Node fetch call sites. It does **not** mean the embedded runtime is repaired or that future code/third-party Node fetch consumers are automatically protected. Any new Node request site should use the same module. Recheck the embedded version and failure case when a compatible upstream Electron release becomes available; do not infer safety from npm audit alone. The stdio MCP transport does not activate SDK HTTP/OAuth clients, and this application does not use Node EventSource or fetch integrity options.

Relevant primary sources:

- [body-parser compressed request crash](https://github.com/advisories/GHSA-27r3-jxmh-p828)
- [Electron certificate distrust fix](https://github.com/advisories/GHSA-jr5w-w6x2-84p9)
- [undici malformed response crash](https://github.com/advisories/GHSA-xjj6-f33q-929c)
- [undici early-close regression fix](https://github.com/nodejs/undici/commit/1325a87)
- [Zod oversized collection validation](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)
- [Electron 44.9.3 runtime versions](https://releases.electronjs.org/release/v44.9.3)

## Verification

`npm run test:api` includes compressed JSON tail/charset regressions and Zod early size rejection. The fetch fixture tests the actual translation endpoint with a synthetic upstream: malformed response returns 502 without leaking credentials or automatically retrying; document reads still work; explicit retry succeeds. Crash regressions use bounded child processes and synthetic loopback services, not production data.

To repeat the fetch fixture against a built package, run its executable in Electron's Node mode with `tests/fixtures/fetch-security.mjs` and the packaged `Contents/Resources/app` path as its argument. Use a project-local temporary directory and clear inherited PAPERDESK storage variables through the test harness. This verifies the shipped dependency rather than the developer checkout. Separately record the embedded runtime versions and negative probe; a passing application fixture is not evidence that embedded global fetch is fixed.

Before distribution, also run full API/build/browser checks and the packaged desktop, reading-workspace, reliability and synthetic Obsidian acceptance scripts. Dependency audit, runtime failure tests and functional acceptance provide different evidence; none substitutes for the others.
