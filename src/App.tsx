import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Backlink, Entry } from "./lib/api";
import { api, isDesktop, noteName, parentDir } from "./lib/api";
import { joinFrontmatter, setField, splitFrontmatter } from "./lib/frontmatter";
import { applyTheme, loadTheme, saveTheme, type ThemeSettings } from "./lib/theme";
import { Sidebar } from "./components/Sidebar";
import { NotePage } from "./components/NotePage";
import { QuickSwitcher } from "./components/QuickSwitcher";
import { SearchPanel } from "./components/SearchPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { PromptModal } from "./components/Modal";
import { Welcome } from "./components/Welcome";
import { Logo } from "./components/Logo";
import { useUpdates } from "./lib/updates";
import { setMediaResolver } from "./lib/media";

const RECENT_KEY = "noodle.lastVault";
/** The note that was open last in each vault, so reopening lands on it again. */
const lastNoteKey = (root: string) => `noodle.lastNote:${root}`;
const SAVE_DELAY_MS = 300;

interface OpenNote {
  path: string;
  frontmatter: string;
  body: string;
  /** Bumped whenever the editor must reload its content. */
  version: number;
}

type Overlay =
  | { kind: "switcher" }
  | { kind: "search" }
  | { kind: "settings" }
  | { kind: "prompt"; title: string; initial?: string; confirm: string; onSubmit(v: string): void };

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not remembering it is fine.
  }
}

const readRecent = () => readStored(RECENT_KEY);

export default function App() {
  const [theme, setTheme] = useState<ThemeSettings>(loadTheme);
  const [root, setRoot] = useState<string | null>(null);
  const rootRef = useRef<string | null>(null);
  rootRef.current = root;
  // On the desktop, the last vault reopens by itself; the welcome screen
  // only shows while that is happening or if it fails.
  const [starting, setStarting] = useState(() => isDesktop && !!readRecent());
  const [entries, setEntries] = useState<Entry[]>([]);
  const [note, setNote] = useState<OpenNote | null>(null);
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const updates = useUpdates();
  const notePaths = useMemo(() => entries.filter((e) => e.kind === "file").map((e) => e.path), [entries]);

  // The last text written to disk, so our own saves are not mistaken for
  // outside edits when the folder watcher fires.
  const lastSaved = useRef<string>("");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noteRef = useRef<OpenNote | null>(null);
  noteRef.current = note;
  const editorFlush = useRef<(() => void) | null>(null);

  useEffect(() => {
    applyTheme(theme);
    saveTheme(theme);
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme(theme);
    mq?.addEventListener("change", onChange);
    return () => mq?.removeEventListener("change", onChange);
  }, [theme]);

  const refreshEntries = useCallback(async () => setEntries(await api.listEntries()), []);
  const refreshBacklinks = useCallback(async (path: string) => setBacklinks(await api.backlinks(path)), []);

  const flushSave = useCallback(async () => {
    editorFlush.current?.();
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const n = noteRef.current;
    if (!n) return;
    const text = joinFrontmatter({ frontmatter: n.frontmatter, body: n.body });
    if (text === lastSaved.current) return;
    lastSaved.current = text;
    setSaving(true);
    try {
      await api.writeNote(n.path, text);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }, []);

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flushSave, SAVE_DELAY_MS);
  }, [flushSave]);

  const openPath = useCallback(
    async (path: string) => {
      await flushSave();
      try {
        const text = await api.readNote(path);
        lastSaved.current = text;
        const parts = splitFrontmatter(text);
        setNote((prev) => ({ path, ...parts, version: (prev?.version ?? 0) + 1 }));
        setOverlay(null);
        refreshBacklinks(path);
        if (rootRef.current) store(lastNoteKey(rootRef.current), path);
      } catch (e) {
        setError(String(e));
      }
    },
    [flushSave, refreshBacklinks],
  );

  const openVault = useCallback(
    async (path: string) => {
      try {
        const info = await api.openVault(path);
        setRoot(info.root);
        setEntries(info.entries);
        rootRef.current = info.root;
        setMediaResolver((p) => api.fileUrl(info.root, p));
        setError(null);
        store(RECENT_KEY, info.root);
        const last = readStored(lastNoteKey(info.root));
        const first = info.entries.find((e) => e.kind === "file" && e.path === last) ?? info.entries.find((e) => e.kind === "file" && /^(welcome|readme|home|index)\.md$/i.test(e.path)) ?? info.entries.find((e) => e.kind === "file");
        setNote(null);
        if (first) openPath(first.path);
      } catch (e) {
        setError(String(e));
      } finally {
        setStarting(false);
      }
    },
    [openPath],
  );

  useEffect(() => {
    const recent = readRecent();
    if (isDesktop && recent) openVault(recent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createVault = useCallback(
    async (name: string, chooseParent: boolean) => {
      try {
        let parent: string | undefined;
        if (chooseParent) {
          const picked = await api.pickFolder();
          if (!picked) return;
          parent = picked;
        }
        openVault(await api.createVault(name, parent));
      } catch (e) {
        setError(String(e));
      }
    },
    [openVault],
  );

  const pickVault = useCallback(async () => {
    const path = await api.pickFolder();
    if (path) openVault(path);
  }, [openVault]);

  const createNote = useCallback(
    async (nameOrPath: string) => {
      const created = await api.createNote(nameOrPath);
      await refreshEntries();
      await openPath(created);
    },
    [openPath, refreshEntries],
  );

  const openLink = useCallback(
    async (target: string) => {
      const file = target.split("#")[0].trim();
      if (!file) return; // same-page heading links: nothing to open yet
      await flushSave();
      const resolved = await api.resolveLink(file);
      if (resolved) openPath(resolved);
      else createNote(file); // clicking a link to a missing note creates it
    },
    [createNote, flushSave, openPath],
  );

  // Pick up edits made outside Noodle (another editor, Syncthing, git pull…).
  useEffect(() => {
    if (!root) return;
    let unlisten: (() => void) | undefined;
    api.onVaultChanged(async (paths) => {
      refreshEntries();
      const n = noteRef.current;
      if (!n) return;
      refreshBacklinks(n.path);
      if (!paths.includes(n.path) || saveTimer.current) return;
      try {
        const text = await api.readNote(n.path);
        if (text === lastSaved.current) return;
        lastSaved.current = text;
        setNote((prev) => (prev && prev.path === n.path ? { path: n.path, ...splitFrontmatter(text), version: prev.version + 1 } : prev));
      } catch {
        // The note was deleted or moved; the tree refresh shows that.
      }
    }).then((u) => (unlisten = u));
    return () => unlisten?.();
  }, [root, refreshEntries, refreshBacklinks]);

  // Keyboard shortcuts.
  useEffect(() => {
    if (!root) return;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if ((k === "o" || k === "p") && !e.shiftKey) setOverlay({ kind: "switcher" });
      else if (k === "f" && e.shiftKey) setOverlay({ kind: "search" });
      else if (k === "n") createNote(note ? `${parentDir(note.path) ? parentDir(note.path) + "/" : ""}Untitled` : "Untitled");
      else if (k === ",") setOverlay({ kind: "settings" });
      else if (k === "s") flushSave();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [root, note, createNote, flushSave]);

  const promptNewNote = (folder: string) =>
    setOverlay({
      kind: "prompt",
      title: folder ? `New note in ${folder}` : "New note",
      initial: "Untitled",
      confirm: "Create",
      onSubmit: (name) => createNote(folder ? `${folder}/${name}` : name),
    });

  const promptNewFolder = (folder: string) =>
    setOverlay({
      kind: "prompt",
      title: "New folder",
      initial: "New folder",
      confirm: "Create",
      onSubmit: async (name) => {
        await api.createFolder(folder ? `${folder}/${name}` : name);
        await refreshEntries();
        setOverlay(null);
      },
    });

  const moveEntry = async (from: string, to: string) => {
    if (to === from) return;
    await flushSave();
    try {
      await api.renameEntry(from, to);
      await refreshEntries();
      const n = noteRef.current;
      if (n && (n.path === from || n.path.startsWith(from + "/"))) {
        const moved = to + n.path.slice(from.length);
        setNote({ ...n, path: moved });
        refreshBacklinks(moved);
        if (rootRef.current) store(lastNoteKey(rootRef.current), moved);
      }
      setOverlay(null);
    } catch (e) {
      setError(String(e));
    }
  };

  const rename = (from: string, newName: string) => {
    const isFile = /\.md$/i.test(from);
    return moveEntry(from, `${parentDir(from) ? parentDir(from) + "/" : ""}${newName}${isFile ? ".md" : ""}`);
  };

  /** Drag and drop in the sidebar: puts a note or folder inside another folder ("" = top level). */
  const moveInto = (from: string, folder: string) => {
    const name = from.split("/").pop()!;
    if (folder === from || folder.startsWith(from + "/")) return; // a folder can't go inside itself
    return moveEntry(from, folder ? `${folder}/${name}` : name);
  };

  const promptRename = (path: string) =>
    setOverlay({
      kind: "prompt",
      title: "Rename",
      initial: noteName(path),
      confirm: "Rename",
      onSubmit: (name) => rename(path, name),
    });

  const trash = async (path: string) => {
    await api.trashEntry(path);
    await refreshEntries();
    if (note && (note.path === path || note.path.startsWith(path + "/"))) setNote(null);
  };

  const updateField = (key: string, value: string | null) => {
    setNote((n) => (n ? { ...n, frontmatter: setField(n.frontmatter, key, value) } : n));
    scheduleSave();
  };

  if (!root) {
    if (starting) return <div className="welcome" />;
    return <Welcome recent={readRecent()} error={error} onPick={pickVault} onOpenRecent={openVault} onCreate={createVault} />;
  }

  return (
    <div className="app">
      <Sidebar
        vaultName={root.split(/[\\/]/).filter(Boolean).pop() ?? root}
        entries={entries}
        activePath={note?.path ?? null}
        onOpen={openPath}
        onNewNote={promptNewNote}
        onNewFolder={promptNewFolder}
        onRename={promptRename}
        onMove={moveInto}
        onTrash={trash}
        onSearch={() => setOverlay({ kind: "search" })}
        onSettings={() => setOverlay({ kind: "settings" })}
        onSwitchVault={async () => {
          // Back to the welcome screen, to open or start another vault.
          await flushSave();
          setNote(null);
          setRoot(null);
        }}
        updateVersion={updates.state.kind === "available" ? updates.state.info.latest : null}
        onUpdate={async () => {
          await flushSave();
          if (updates.state.kind === "available") updates.install(updates.state.info);
          setOverlay({ kind: "settings" });
        }}
      />
      <main className="main">
        <header className="topbar">
          <span className="breadcrumb">{note ? note.path.replace(/\.md$/i, "").split("/").join("  /  ") : ""}</span>
          <span className={`save-state ${saving ? "busy" : ""}`}>{note ? (saving ? "Saving…" : "Saved") : ""}</span>
        </header>
        {error && (
          <div className="error-bar" onClick={() => setError(null)}>
            {error} <span className="muted">(click to dismiss)</span>
          </div>
        )}
        {note ? (
          <NotePage
            key={note.path}
            path={note.path}
            docKey={`${note.path}#${note.version}`}
            frontmatter={note.frontmatter}
            body={note.body}
            backlinks={backlinks}
            onBodyChange={(body) => {
              setNote((n) => (n ? { ...n, body } : n));
              noteRef.current = noteRef.current && { ...noteRef.current, body };
              scheduleSave();
            }}
            onFieldChange={updateField}
            onRename={(name) => rename(note.path, name)}
            onOpenLink={openLink}
            onOpenPath={openPath}
            flushRef={editorFlush}
            notes={notePaths}
          />
        ) : (
          <div className="empty-state">
            <Logo size={72} />
            <p>Pick a note on the left, or press <kbd>Ctrl O</kbd> to jump to one.</p>
            <button className="primary" onClick={() => promptNewNote("")}>
              New note
            </button>
          </div>
        )}
      </main>
      {overlay?.kind === "switcher" && <QuickSwitcher entries={entries} onOpen={openPath} onCreate={createNote} onClose={() => setOverlay(null)} />}
      {overlay?.kind === "search" && <SearchPanel onOpen={openPath} onClose={() => setOverlay(null)} />}
      {overlay?.kind === "settings" && <SettingsPanel theme={theme} updates={updates} onChange={setTheme} onClose={() => setOverlay(null)} />}
      {overlay?.kind === "prompt" && (
        <PromptModal
          title={overlay.title}
          initial={overlay.initial}
          confirm={overlay.confirm}
          onSubmit={(v) => {
            overlay.onSubmit(v);
            setOverlay(null);
          }}
          onClose={() => setOverlay(null)}
        />
      )}
    </div>
  );
}
