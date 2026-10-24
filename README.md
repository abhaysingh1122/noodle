<p align="center"><img src="docs/logo.svg" width="104" alt="Noodle logo"></p>

<h1 align="center">Noodle</h1>

<p align="center"><b>Every note is a strand. Noodle ties them together.</b><br>
A local-first notes app: your notes are plain Markdown files in a folder you own, connected to each other, and pleasant to look at.</p>

<p align="center"><img src="docs/screenshots/page.png" alt="A note in Noodle" width="820"></p>

## Why Noodle

- **Your files, your computer.** A vault is just a folder of `.md` files. No account, no cloud, works offline, and any Markdown editor can still open your notes.
- **Connected notes.** Type `[[` to tie one note to another. Every page shows the strands that lead to it, and the graph shows the whole bowl at once.
- **Soft, round and calm.** Rounded floating panels, emoji badges, pastel banners, bubbly callouts and checklists.
- **Make it yours.** Pastel green and yellow by default, with more palettes, your own accent colour, and light/dark mode.

<p align="center">
  <img src="docs/screenshots/banner.png" alt="A note with a banner and emoji" width="410">
  <img src="docs/screenshots/dark.png" alt="Noodle in dark mode" width="410">
</p>

## Features

| | |
|---|---|
| Vault | Start a new vault in one click or open any folder; Noodle reopens your last vault and note. Folders and subfolders, drag notes and folders into each other, rename, trash (to `.trash/`, nothing is deleted outright) |
| Editing | Rich editor that reads and writes plain Markdown: headings, lists, checklists, quotes, code, links, images. Type Markdown or paste it and it turns into formatting |
| Blocks | `/` menu to add any block, a grip to drag blocks around, `+` to add one below |
| Formatting | Select text for a toolbar: turn into heading/list/quote, bold, italic, underline, strike, code, links, text colours, highlights and fonts |
| Images | Paste a picture or pick one from your computer; it's saved in the vault's `attachments/` folder |
| Strands | Type `[[` to pick a note; `[[Note]]`, `[[Note#Heading]]`, `[[Note\|alias]]`, `![[Embed]]`; clicking a strand to a note that doesn't exist yet creates it |
| Backlinks | "Strands lead here" under every page |
| Callouts | `> [!tip] Title` blocks shown as round coloured bubbles |
| Page style | Emoji badge (or your own picture) and a pastel or uploaded banner, stored in the note's frontmatter (`icon: 🍜`, `cover: garden`) |
| Graph | <kbd>Ctrl G</kbd> shows every note and strand; drag, zoom, click to open |
| Find | Quick switcher (<kbd>Ctrl O</kbd>), full-text search (<kbd>Ctrl Shift F</kbd>) |
| Live | Edits made in other apps (or by sync tools, git…) show up instantly |
| Theme | 4 palettes, custom accent colour, light/dark/system (<kbd>Ctrl ,</kbd>) |
| Updates | One-click updates from GitHub releases |
| Motion | Banners unroll like a flag and knock the emoji badge askew (it stays straight until then) |

## Local API

Switch on **Settings → Connections → Local API** to let scripts and other apps on your computer read and write notes over HTTP. It listens on `127.0.0.1` only (port 27183 by default) and every call needs the key shown in Settings.

```sh
# list notes
curl.exe http://127.0.0.1:27183/v1/notes -H "Authorization: Bearer <key>"
# read one (".md" is optional)
curl.exe http://127.0.0.1:27183/v1/notes/Ideas/Big%20plan -H "Authorization: Bearer <key>"
# create or replace
curl.exe -X PUT http://127.0.0.1:27183/v1/notes/Inbox --data-binary "# Inbox" -H "Authorization: Bearer <key>"
# add a line to the end
curl.exe -X POST http://127.0.0.1:27183/v1/notes/Inbox/append --data-binary "- new idea" -H "Authorization: Bearer <key>"
```

| Method | Path | Does |
|---|---|---|
| GET | `/v1/health` | Is Noodle running? (no key needed) |
| GET | `/v1/notes` | Every note and folder |
| GET | `/v1/notes/<path>` | A note's Markdown |
| PUT | `/v1/notes/<path>` | Create or replace a note with the request body |
| POST | `/v1/notes/<path>/append` | Add the request body to the end of a note |
| DELETE | `/v1/notes/<path>` | Move a note to `.trash/` |
| GET | `/v1/search?q=<words>` | Search names and text |
| GET | `/v1/backlinks/<path>` | Strands that lead to a note |
| GET | `/v1/graph` | All notes and strands |

Changes made through the API show up in the open window right away. On Windows use `curl.exe` (in PowerShell plain `curl` is a different command).

## Roadmap

1. ~~Vault, editor, strands, backlinks, search, Windows installer~~
2. ~~Block editing: `/` menu, drag handles, text colours~~; next: toggles, columns, tables
3. ~~Graph view~~; next: canvas
4. Databases: table, board and calendar views over note properties
5. Page lock, hide and encrypt; AI assistant (bring your own API key or a local model)
6. ~~Local REST API~~; next: MCP server, webhooks, reaching it from other devices
7. Phone ⇄ PC sync, with no server required

## Install

Download `Noodle_<version>_x64-setup.exe` from the [latest release](../../releases/latest) and run it. Windows may say "Windows protected your PC" because the app isn't code-signed yet: click **More info → Run anyway**.

After that you never need to download it again: Noodle checks for a new version when it starts, and an **Update** button appears in the sidebar (also in Settings). One click downloads the new version, installs it and reopens Noodle.

## Build from source

Requirements: [Node.js 20+](https://nodejs.org), [pnpm](https://pnpm.io), [Rust](https://rustup.rs) and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS (on Windows: Microsoft C++ Build Tools and WebView2, which Windows 11 already has).

```sh
pnpm install
pnpm tauri dev      # run the app with hot reload
pnpm tauri build    # make an installer in src-tauri/target/release/bundle/
```

`pnpm dev` alone runs the UI in a browser against a built-in demo vault, handy for working on the design.

Tests:

```sh
pnpm test                                         # editor and Markdown round-trip tests
cargo test --manifest-path src-tauri/Cargo.toml   # vault, strands, search
```

## How it's built

- **Desktop shell:** [Tauri 2](https://tauri.app) (Rust). Small installers, native file access.
- **UI:** React + TypeScript + Vite, with the Nunito typeface.
- **Editor:** [TipTap](https://tiptap.dev) (ProseMirror) with [tiptap-markdown](https://github.com/aguingand/tiptap-markdown), plus Noodle's own strand and callout nodes that round-trip to exactly the same Markdown.
- **Vault engine** (`src-tauri/src/vault.rs`): file tree, link index, link resolution (exact path first, then the shortest matching file name), backlinks, search and a folder watcher.

## License

[MIT](LICENSE)
