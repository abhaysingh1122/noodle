import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { demoApi } from "./demo";

export type EntryKind = "file" | "folder";
export interface Entry {
  path: string;
  kind: EntryKind;
  mtime: number;
}
export interface VaultInfo {
  root: string;
  entries: Entry[];
}
export interface Backlink {
  source: string;
  line: number;
  context: string;
}
export interface SearchHit {
  path: string;
  line: number;
  snippet: string;
}
export interface Graph {
  nodes: { id: string; exists: boolean }[];
  edges: [string, string][];
}

export interface UpdateInfo {
  current: string;
  latest: string;
  available: boolean;
  notes: string;
  pageUrl: string;
  installerUrl: string | null;
  installerSize: number;
}

export interface Api {
  pickFolder(): Promise<string | null>;
  openVault(path: string): Promise<VaultInfo>;
  /** Creates an empty vault folder (in Documents unless a parent is given) and returns its path. */
  createVault(name: string, parent?: string): Promise<string>;
  listEntries(): Promise<Entry[]>;
  readNote(path: string): Promise<string>;
  writeNote(path: string, content: string): Promise<void>;
  createNote(path: string): Promise<string>;
  createFolder(path: string): Promise<void>;
  renameEntry(from: string, to: string): Promise<void>;
  trashEntry(path: string): Promise<void>;
  resolveLink(target: string): Promise<string | null>;
  backlinks(path: string): Promise<Backlink[]>;
  search(query: string): Promise<SearchHit[]>;
  graph(): Promise<Graph>;
  onVaultChanged(cb: (paths: string[]) => void): Promise<() => void>;
  appVersion(): Promise<string>;
  checkUpdate(): Promise<UpdateInfo>;
  /** Downloads and runs the installer; the app quits and reopens itself. */
  installUpdate(url: string, size: number): Promise<void>;
}

const tauriApi: Api = {
  async pickFolder() {
    const picked = await open({ directory: true, multiple: false, title: "Open a folder of notes" });
    return typeof picked === "string" ? picked : null;
  },
  openVault: (path) => invoke("open_vault", { path }),
  createVault: (name, parent) => invoke("create_vault", { name, parent: parent ?? null }),
  listEntries: () => invoke("list_entries"),
  readNote: (path) => invoke("read_note", { path }),
  writeNote: (path, content) => invoke("write_note", { path, content }),
  createNote: (path) => invoke("create_note", { path }),
  createFolder: (path) => invoke("create_folder", { path }),
  renameEntry: (from, to) => invoke("rename_entry", { from, to }),
  trashEntry: (path) => invoke("trash_entry", { path }),
  resolveLink: (target) => invoke("resolve_link", { target }),
  backlinks: (path) => invoke("backlinks", { path }),
  search: (query) => invoke("search", { query }),
  graph: () => invoke("graph"),
  async onVaultChanged(cb) {
    return listen<{ paths: string[] }>("vault-changed", (e) => cb(e.payload.paths));
  },
  appVersion: () => invoke("app_version"),
  checkUpdate: () => invoke("check_update"),
  installUpdate: (url, size) => invoke("install_update", { url, size }),
};

/** True inside the desktop app; false when the UI runs in a plain browser. */
export const isDesktop = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// In a plain browser (`pnpm dev`) there is no file system, so the UI runs
// against an in-memory demo vault instead.
export const api: Api = isDesktop ? tauriApi : demoApi;

export const noteName = (path: string) => (path.split("/").pop() ?? path).replace(/\.md$/i, "");
export const parentDir = (path: string) => path.split("/").slice(0, -1).join("/");
