import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Backlink, Entry } from "./lib/api";
import { api, isDesktop, isMobile, parentDir } from "./lib/api";
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
import { GraphView } from "./components/GraphView";
import { useUpdates } from "./lib/updates";
import { setMediaResolver } from "./lib/media";
import { useLocalApi } from "./lib/localApi";
import { useCloudSync, type CloudSync, type CloudVault } from "./lib/sync";
import { folderName, forgetVault, readHistory, rememberVault } from "./lib/vaults";
import { SignInScreen } from "./components/SignIn";
import { Cloud, Menu, PanelLeftClose, PanelLeftOpen } from "lucide-react";

const RECENT_KEY = "noodle.lastVault";
/** The note that was open last in each vault, so reopening lands on it again. */
const lastNoteKey = (root: string) => `noodle.lastNote:${root}`;
const SAVE_DELAY_MS = 300;
const SIDEBAR_HIDDEN_KEY = "noodle.sidebarHidden";
const SIDEBAR_WIDTH_KEY = "noodle.sidebarWidth";
const DEFAULT_SIDEBAR = 268;
const clampSidebar = (w: number) => Math.round(Math.min(480, Math.max(200, w)));

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
  const [history, setHistory] = useState(readHistory);
  // Shown over the vault list when someone who skipped signing in asks for it.
  const [signingIn, setSigningIn] = useState(false);
  // On narrow screens (phones) the sidebar slides in as a drawer.
  const [drawer, setDrawer] = useState(false);
  // On wider screens it can be tucked away (Ctrl \) and dragged wider or narrower.
  const [sidebarHidden, setSidebarHidden] = useState(() => readStored(SIDEBAR_HIDDEN_KEY) === "1");
  const [sidebarWidth, setSidebarWidth] = useState(() => clampSidebar(Number(readStored(SIDEBAR_WIDTH_KEY)) || DEFAULT_SIDEBAR));
  const [entries, setEntries] = useState<Entry[]>([]);
  const [note, setNote] = useState<OpenNote | null>(null);
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showGraph, setShowGraph] = useState(false);
  const [graphVersion, setGraphVersion] = useState(0);
  const updates = useUpdates();
  const localApi = useLocalApi();
  const notePaths = useMemo(() => entries.filter((e) => e.kind === "file").map((e) => e.path), [entries]);

  // The last text written to disk, so our own saves are not mistaken for
  // outside edits when the folder watcher fires.
  const lastSaved = useRef<string>("");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noteRef = useRef<OpenNote | null>(null);
  noteRef.current = note;
  const editorFlush = useRef<(() => void) | null>(null);
  // Set once cloud sync is ready; saving a note asks it to sync soon.
  const cloudSyncRef = useRef<(() => void) | null>(null);
  const cloudRef = useRef<CloudSync | null>(null);

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
      cloudSyncRef.current?.();
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
      setShowGraph(false);
      setDrawer(false);
      if (noteRef.current?.path === path) return setOverlay(null);
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
        setHistory(rememberVault(info.root));
        const last = readStored(lastNoteKey(info.root));
        const first = info.entries.find((e) => e.kind === "file" && e.path === last) ?? info.entries.find((e) => e.kind === "file" && /^(welcome|readme|home|index)\.md$/i.test(e.path)) ?? info.entries.find((e) => e.kind === "file");
        setNote(null);
        noteRef.current = null;
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
        const path = await api.createVault(name, parent);
        // Signed in: new vaults go to the cloud straight away.
        if (cloudRef.current?.session) await cloudRef.current.keepInCloud(path, folderName(path)).catch((e) => setError(String(e)));
        openVault(path);
      } catch (e) {
        setError(String(e));
      }
    },
    [openVault],
  );

  /** A cloud vault that isn't on this device yet: make a folder for it, link it, and let sync fill it. */
  const openCloudVault = useCallback(
    async (vault: CloudVault) => {
      try {
        const path = await api.createVault(vault.name);
        cloudRef.current?.linkFolder(path, vault);
        openVault(path);
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

  const openFromGraph = useCallback(
    (id: string, exists: boolean) => {
      setShowGraph(false);
      if (exists) openPath(id);
      else openLink(id);
    },
    [openLink, openPath],
  );

  useEffect(() => {
    if (!showGraph) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !overlay && setShowGraph(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showGraph, overlay]);

  // Show changes that came from elsewhere: another app, a sync tool, or the cloud.
  const applyOutsideChanges = useCallback(
    async (paths: string[]) => {
      refreshEntries();
      setGraphVersion((v) => v + 1);
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
    },
    [refreshEntries, refreshBacklinks],
  );
  const cloud = useCloudSync(root, applyOutsideChanges);
  cloudSyncRef.current = () => cloud.requestSync();
  cloudRef.current = cloud;

  // Pick up edits made outside Noodle (another editor, Syncthing, git pull…).
  useEffect(() => {
    if (!root) return;
    let unlisten: (() => void) | undefined;
    api
      .onVaultChanged((paths) => {
        applyOutsideChanges(paths);
        cloud.requestSync();
      })
      .then((u) => (unlisten = u));
    return () => unlisten?.();
  }, [root, applyOutsideChanges, cloud.requestSync]);

  const toggleSidebar = useCallback(() => {
    if (window.matchMedia("(max-width: 760px)").matches) return setDrawer((d) => !d);
    setSidebarHidden((h) => {
      store(SIDEBAR_HIDDEN_KEY, h ? "0" : "1");
      return !h;
    });
  }, []);

  /** Drag the sidebar's edge to resize it; double-click puts it back. */
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth;
    let latest = startW;
    document.body.classList.add("resizing");
    const move = (ev: PointerEvent) => {
      latest = clampSidebar(startW + ev.clientX - startX);
      setSidebarWidth(latest);
    };
    const up = () => {
      document.body.classList.remove("resizing");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      store(SIDEBAR_WIDTH_KEY, String(latest));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

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
      else if (k === "g") setShowGraph((g) => !g);
      else if (k === "\\") toggleSidebar();
      else if (k === "s") flushSave();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [root, note, createNote, flushSave, toggleSidebar]);

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

  const promptRenameVault = () =>
    setOverlay({
      kind: "prompt",
      title: "Rename this vault (its folder on your computer)",
      initial: root?.split(/[\\/]/).filter(Boolean).pop() ?? "",
      confirm: "Rename",
      onSubmit: async (name) => {
        const old = rootRef.current;
        await flushSave();
        try {
          const info = await api.renameVault(name);
          rootRef.current = info.root;
          setMediaResolver((p) => api.fileUrl(info.root, p));
          setRoot(info.root);
          setEntries(info.entries);
          store(RECENT_KEY, info.root);
          if (old) {
            setHistory(forgetVault(old));
            const link = cloud.links[old];
            if (link) {
              cloud.linkFolder(old, null);
              cloud.linkFolder(info.root, link);
              // The cloud copy takes the new name too, so other devices see it.
              cloud.renameCloudVault(link.id, folderName(info.root)).catch((e) => setError(String(e)));
            }
          }
          setHistory(rememberVault(info.root));
          const last = old && readStored(lastNoteKey(old));
          if (last) store(lastNoteKey(info.root), last);
        } catch (e) {
          setError(String(e));
        }
      },
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

  // Signing in comes first (on the app; the web demo has no accounts).
  if (isDesktop && (!cloud.ready || (!cloud.session && (!cloud.skipped || signingIn)))) {
    if (!cloud.ready) return <div className="welcome" />;
    return <SignInScreen client={cloud.client} onSkip={() => (cloud.setSkipped(true), setSigningIn(false))} />;
  }

  if (!root) {
    if (starting) return <div className="welcome" />;
    return (
      <Welcome
        history={history}
        cloudVaults={cloud.vaults}
        links={cloud.links}
        email={cloud.session?.user.email ?? null}
        error={error}
        onPick={pickVault}
        onOpen={openVault}
        onOpenCloud={openCloudVault}
        onForget={(path) => setHistory(forgetVault(path))}
        onUnlink={(path) => cloud.linkFolder(path, null)}
        onRenameCloud={(id, name) => cloud.renameCloudVault(id, name).catch((e) => setError(String(e)))}
        onDeleteCloud={(id) => cloud.deleteCloudVault(id).catch((e) => setError(String(e)))}
        onSignIn={() => setSigningIn(true)}
        onCreate={createVault}
      />
    );
  }

  return (
    <div className={`app ${drawer ? "drawer-open" : ""} ${sidebarHidden ? "sidebar-hidden" : ""}`} style={{ "--sidebar-w": `${sidebarWidth}px` } as React.CSSProperties}>
      {drawer && <div className="drawer-shade" onClick={() => setDrawer(false)} />}
      <Sidebar
        vaultName={root.split(/[\\/]/).filter(Boolean).pop() ?? root}
        entries={entries}
        activePath={note?.path ?? null}
        onOpen={openPath}
        onNewNote={promptNewNote}
        onNewFolder={promptNewFolder}
        onRenameTo={(path, name) => rename(path, name)}
        onRenameVault={promptRenameVault}
        onMove={moveInto}
        onTrash={trash}
        onSearch={() => setOverlay({ kind: "search" })}
        onGraph={() => setShowGraph((g) => !g)}
        graphOpen={showGraph}
        onSettings={() => setOverlay({ kind: "settings" })}
        onSwitchVault={async () => {
          // Back to the welcome screen, to open or start another vault.
          await flushSave();
          setNote(null);
          setRoot(null);
          cloud.refreshVaults();
        }}
        updateVersion={updates.state.kind === "available" ? updates.state.info.latest : null}
        onUpdate={async () => {
          await flushSave();
          if (updates.state.kind === "available") updates.install(updates.state.info);
          setOverlay({ kind: "settings" });
        }}
      />
      <div
        className="sidebar-resizer"
        title="Drag to resize, double-click to reset"
        onPointerDown={startResize}
        onDoubleClick={() => (setSidebarWidth(DEFAULT_SIDEBAR), store(SIDEBAR_WIDTH_KEY, String(DEFAULT_SIDEBAR)))}
      />
      <main className="main">
        <header className="topbar">
          <button className="drawer-button" title="Notes" onClick={() => setDrawer(true)}>
            <Menu size={18} />
          </button>
          <button className="sidebar-toggle" title={sidebarHidden ? "Show sidebar (Ctrl \\)" : "Hide sidebar (Ctrl \\)"} onClick={toggleSidebar}>
            {sidebarHidden ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          </button>
          <span className="breadcrumb">{note ? note.path.replace(/\.md$/i, "").split("/").join("  /  ") : ""}</span>
          {!cloud.linked && (
            <button className="cloud-pill off" title="Sign in to sync with your other devices" onClick={() => setOverlay({ kind: "settings" })}>
              <Cloud size={14} /> {cloud.session ? "Turn on sync" : "Sign in"}
            </button>
          )}
          {cloud.linked && (
            <button className={`cloud-pill ${cloud.status.kind}`} title={cloud.status.kind === "error" ? cloud.status.message : "Cloud sync (click to sync now)"} onClick={() => cloud.syncNow()}>
              <Cloud size={14} /> {cloud.status.kind === "syncing" ? "Syncing" : cloud.status.kind === "error" ? "Sync problem" : "Synced"}
            </button>
          )}
          <span className={`save-state ${saving ? "busy" : ""}`}>{note ? (saving ? "Saving…" : "Saved") : ""}</span>
        </header>
        {cloud.session && !cloud.linked && !cloud.declined && (
          <div className="cloud-offer">
            <Cloud size={18} />
            <span>
              Keep <b>{folderName(root)}</b> in Noodle Cloud, so it's on your phone and other computers too?
            </span>
            <button className="ghost small-btn" onClick={() => cloud.decline(root)}>
              Not now
            </button>
            {/* A renamed or moved folder can pick up its old cloud vault instead of making a new one. */}
            {(cloud.vaults ?? [])
              .filter((v) => !Object.values(cloud.links).some((l) => l.id === v.id) || Object.entries(cloud.links).some(([f, l]) => l.id === v.id && !history.some((h) => h.path === f)))
              .slice(0, 3)
              .map((v) => (
                <button key={v.id} className="ghost small-btn" title="Sync this folder with that cloud vault" onClick={() => cloud.linkFolder(root, v)}>
                  Use “{v.name}”
                </button>
              ))}
            <button className="primary small-btn" onClick={() => cloud.keepInCloud(root, folderName(root)).catch((e) => setError(String(e)))}>
              Sync as new
            </button>
          </div>
        )}
        {error && (
          <div className="error-bar" onClick={() => setError(null)}>
            {error} <span className="muted">(click to dismiss)</span>
          </div>
        )}
        {showGraph ? (
          <GraphView activePath={note?.path ?? null} onOpen={openFromGraph} onClose={() => setShowGraph(false)} version={graphVersion} />
        ) : note ? (
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
            {isMobile ? (
              <p>
                Tap <Menu size={15} /> at the top to pick a note.
              </p>
            ) : (
              <p>
                Pick a note on the left, or press <kbd>Ctrl O</kbd> to jump to one.
              </p>
            )}
            <button className="primary" onClick={() => promptNewNote("")}>
              New note
            </button>
          </div>
        )}
      </main>
      {overlay?.kind === "switcher" && <QuickSwitcher entries={entries} onOpen={openPath} onCreate={createNote} onClose={() => setOverlay(null)} />}
      {overlay?.kind === "search" && <SearchPanel onOpen={openPath} onClose={() => setOverlay(null)} />}
      {overlay?.kind === "settings" && <SettingsPanel theme={theme} updates={updates} localApi={localApi} cloud={cloud} root={root} onChange={setTheme} onClose={() => setOverlay(null)} />}
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
