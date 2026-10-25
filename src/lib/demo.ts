import type { Api, Entry } from "./api";

const files = new Map<string, string>([
  [
    "Welcome.md",
    `---
icon: 🍜
---
Noodle keeps your notes as **plain Markdown files** in a folder, and makes them look good.

- Link notes by typing [[Getting started]] or [[Ideas/Project ideas]]
- Press **Ctrl+O** to jump to any note, **Ctrl+Shift+F** to search
- Every page shows which notes link back to it

> [!tip] This is a demo vault
> Open a real folder from the sidebar to use your own notes.
`,
  ],
  ["Getting started.md", "Back to [[Welcome]].\n\n## Checklist\n\n- [x] Open a folder\n- [ ] Write a note\n- [ ] Link it with [[Ideas/Project ideas]]\n"],
  ["Ideas/Project ideas.md", "Things to build, see [[Welcome]].\n\n1. Graph view\n2. Databases\n3. [[Sync]]\n"],
]);

const folders = new Set(["Ideas"]);
const linkRe = /!?\[\[([^\]|#^\n]+)[^\]]*\]\]/g;

function resolve(target: string): string | null {
  const t = target.trim().toLowerCase();
  let best: string | null = null;
  for (const p of files.keys()) {
    const lower = p.toLowerCase().replace(/\.md$/, "");
    if (lower === t) return p;
    if (lower.split("/").pop() === t && (!best || p.length < best.length)) best = p;
  }
  return best;
}

function entries(): Entry[] {
  return [
    ...[...folders].map((path) => ({ path, kind: "folder" as const, mtime: 0 })),
    ...[...files.keys()].map((path) => ({ path, kind: "file" as const, mtime: 0 })),
  ].sort((a, b) => a.path.toLowerCase().localeCompare(b.path.toLowerCase()));
}

export const demoApi: Api = {
  pickFolder: async () => "Demo vault",
  openVault: async () => ({ root: "Demo vault", entries: entries() }),
  createVault: async () => "Demo vault",
  defaultVault: async () => "Demo vault",
  renameVault: async (name) => ({ root: name, entries: entries() }),
  pickImage: async () => null,
  importImage: async (source) => source,
  saveAttachment: async (name) => name,
  fileUrl: (_root, path) => path,
  async syncSnapshot() {
    const hex = async (text: string) =>
      [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const notes = await Promise.all([...files.entries()].map(async ([path, text]) => ({ path, kind: "note" as const, hash: await hex(text) })));
    return [...notes, ...[...folders].map((path) => ({ path, kind: "folder" as const, hash: "" }))];
  },
  readBytes: async () => new Uint8Array(),
  writeBytes: async () => {},
  listEntries: async () => entries(),
  readNote: async (p) => files.get(p) ?? "",
  writeNote: async (p, c) => void files.set(p, c),
  async createNote(p) {
    const base = p.replace(/\.md$/, "");
    let candidate = `${base}.md`;
    for (let n = 1; files.has(candidate); n++) candidate = `${base} ${n}.md`;
    files.set(candidate, "");
    return candidate;
  },
  createFolder: async (p) => void folders.add(p),
  async renameEntry(from, to) {
    for (const [p, c] of [...files]) {
      if (p === from || p.startsWith(from + "/")) {
        files.delete(p);
        files.set(to + p.slice(from.length), c);
      }
    }
    if (folders.delete(from)) folders.add(to);
  },
  async trashEntry(path) {
    for (const p of [...files.keys()]) if (p === path || p.startsWith(path + "/")) files.delete(p);
    folders.delete(path);
  },
  resolveLink: async (t) => resolve(t),
  async backlinks(path) {
    const out: { source: string; line: number; context: string }[] = [];
    for (const [source, content] of files) {
      if (source === path) continue;
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        for (const m of lines[i].matchAll(linkRe)) {
          if (resolve(m[1]) === path) out.push({ source, line: i + 1, context: lines[i].trim() });
        }
      }
    }
    return out;
  },
  async search(query) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const hits: { path: string; line: number; snippet: string }[] = [];
    for (const [path, content] of files) {
      content.split("\n").forEach((line, i) => {
        if (line.toLowerCase().includes(q)) hits.push({ path, line: i + 1, snippet: line.trim() });
      });
    }
    return hits;
  },
  async graph() {
    const edges: [string, string][] = [];
    for (const [source, content] of files) {
      for (const m of content.matchAll(linkRe)) edges.push([source, resolve(m[1]) ?? m[1]]);
    }
    return { nodes: [...files.keys()].map((id) => ({ id, exists: true })), edges };
  },
  onVaultChanged: async () => () => {},
  configureApi: async (enabled, port) => (enabled ? port : null),
  localIp: async () => "192.168.1.20",
  appVersion: async () => "0.1.0",
  checkUpdate: async () => ({ current: "0.1.0", latest: "0.1.0", available: false, notes: "", pageUrl: "", installerUrl: null, installerSize: 0 }),
  installUpdate: async () => {},
};
