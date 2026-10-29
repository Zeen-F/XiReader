# Paperdesk · 纸间

[中文](README.md) · [Download previews](https://github.com/Zeen-F/XiReader/releases) · [Contribute](CONTRIBUTING.md)

**Read papers locally. Keep the evidence. Bring selected context to Obsidian and Codex.**

Paperdesk is an MIT-licensed PDF reading, annotation and research-notes workspace. This repository is named **XiReader**; the current public desktop packages are named **Paperdesk**. Windows, Apple Silicon macOS and a local browser interface are available as previews.

The project grew out of the maintainer's own research-reading needs and is developed with AI assistance, hands-on use and iterative fixes. It remains early-stage software.

## From a paper to a checked note

1. Open a PDF in a standalone local library or in an existing Obsidian vault.
2. Select text or mark a figure region, verify the quotation and actual PDF page, and add a comment.
3. Keep the annotation locally, explicitly share selected context with Codex, or send it to [Knowledge Workbench](https://github.com/Zeen-F/knowledge-workbench).
4. Review generated text against its source before choosing to record it. A model answer is not automatically a verified note.

This workflow is useful when a research note needs the original equation, diagram or experimental condition, not just an isolated summary. Knowledge Workbench is a separate companion project; its repository and licensing status should be checked independently.

## What is available

| Area | Current behavior |
| --- | --- |
| PDF reading | Page or continuous layouts, zoom, outlines, personal bookmarks and reading-position recovery. |
| Evidence capture | Text highlights, region annotations for figures or scanned content, comments and actual PDF page references. Region capture does not perform OCR. |
| Local notes | Markdown editing and export, save queues, revision checks and conflict recovery. |
| Obsidian integration | Existing PDFs are read in place. Managed Markdown stores notes and annotation state; source PDFs are not rewritten. |
| Codex integration | A local MCP bridge shares selected context and supports explicit note appends. Content search requires scoped, expiring local authorization. |
| Optional translation | Preview a manually selected passage and confirm before sending it to a configured provider. Reading alone does not send passages. |

Detailed instructions: [reader display](docs/reader-display.md), [Obsidian storage](docs/obsidian-vault.md), [Codex plugin](docs/codex-plugin.md), [translation](docs/translation.md), and [Knowledge Workbench exchange](docs/knowledge-workbench.md). Most detailed documentation is currently in Chinese.

## Install a preview

The current public preview is [1.2.0-beta.6](https://github.com/Zeen-F/XiReader/releases/tag/v1.2.0-beta.6). Download files and checksums from the release page.

- **Windows x64:** extract the complete ZIP to an application folder and run `Paperdesk.exe`. Keep the whole folder together; Node.js is bundled.
- **Apple Silicon macOS:** use the DMG and drag Paperdesk into Applications. The preview is not Apple-signed or notarized.
- **Local browser:** use the browser ZIP with Node.js 24+, run `npm ci --omit=dev` and `npm start`, then open `http://127.0.0.1:4317`.

Save and close the old application and back up the complete library before upgrading. Application files and research data belong in separate locations. There is no automatic updater. See [desktop installation and recovery](docs/desktop-release.md) and the [Windows guide](docs/windows.md).

## Develop and check

Requires Node.js 24+. For a fresh checkout:

```sh
git clone https://github.com/Zeen-F/XiReader.git
cd XiReader
npm ci
npm run dev
```

The development entry point uses an isolated development library. For a production build in the local browser, run `npm run build` then `npm start`. To launch the desktop application from source, run `npm run desktop`. In Windows PowerShell, use `npm.cmd` and `npx.cmd`.

```sh
npx playwright install chromium
npm run check
```

`check` runs API tests, the production build and browser checks. The [CI workflow](.github/workflows/ci.yml) covers Linux, Windows and macOS, with desktop reliability checks on Windows and macOS. Tests use synthetic materials. CI results do not establish compatibility with every PDF, model provider or Codex host.

## Data and integration boundaries

- Normal reading, search, annotations and notes run locally. The service listens on loopback.
- Material explicitly shared with Codex or a translation provider may enter that provider's requests and conversation history.
- MCP search defaults to title metadata. Searching text, notes or annotations requires explicit document/source scope, an expiry and a response budget. Existing page-reading and note-reading tools retain their separately documented scope.
- Shared context does not authorize overwriting notes. Unresolved drafts and revision conflicts block an append or save until the user resolves them.
- Keep private papers, credentials, databases and personal notes out of issues, test fixtures and Git. See the [data and recovery instructions](README.md#数据保存与恢复).

## Maintenance and contribution

[Zeen-F](https://github.com/Zeen-F) maintains the project. Public [pull requests](https://github.com/Zeen-F/XiReader/pulls), [release history](https://github.com/Zeen-F/XiReader/releases), [check results](https://github.com/Zeen-F/XiReader/actions/workflows/ci.yml) and [change records](docs/history) provide the maintenance trail.

Useful contributions include reproducible PDF selection bugs, note-save and recovery regressions, Obsidian interoperability, MCP permission boundaries, accessibility and documentation. Start with a small issue or pull request and follow [CONTRIBUTING.md](CONTRIBUTING.md). Use synthetic or shareable examples rather than a personal library.

## Current limits

No OCR, embedded PDF-annotation editing, built-in cloud synchronization or multi-user collaboration is provided. Encrypted or permission-restricted PDFs are unsupported. Complex text layers can affect reading order, so check quotations before sharing or saving them. Cross-device concurrent writes are not guaranteed safe.

The current README records successful real MCP communication with synthetic material, but the current host's embedded panel has not completed visual acceptance. Independent translation-provider accounts have not completed real-service acceptance in that validation round. These limitations remain separate from passing automated tests.

## License

[MIT](LICENSE). Third-party dependencies retain their own licenses.
