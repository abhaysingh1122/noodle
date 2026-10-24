import { useMemo, useRef, useState } from "react";
import { ChevronRight, FilePlus, FolderPlus, Search, Settings, Trash2, Pencil, FileText, Folder, Sparkles } from "lucide-react";
import type { Entry } from "../lib/api";
import { noteName } from "../lib/api";
import { Logo } from "./Logo";

interface TreeNode {
  entry: Entry;
  children: TreeNode[];
}

function buildTree(entries: Entry[]): TreeNode[] {
  const byPath = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];
  for (const entry of entries) byPath.set(entry.path, { entry, children: [] });
  for (const node of byPath.values()) {
    const parent = node.entry.path.split("/").slice(0, -1).join("/");
    (parent ? byPath.get(parent)?.children ?? roots : roots).push(node);
  }
  const sort = (nodes: TreeNode[]) => {
    nodes.sort((a, b) =>
      a.entry.kind !== b.entry.kind
        ? a.entry.kind === "folder" ? -1 : 1
        : a.entry.path.toLowerCase().localeCompare(b.entry.path.toLowerCase()),
    );
    nodes.forEach((n) => sort(n.children));
  };
  sort(roots);
  return roots;
}

interface Props {
  vaultName: string;
  entries: Entry[];
  activePath: string | null;
  onOpen(path: string): void;
  onNewNote(folder: string): void;
  onNewFolder(folder: string): void;
  onRename(path: string): void;
  /** Moves a note or folder into a folder ("" = the top level). */
  onMove(path: string, folder: string): void;
  onTrash(path: string): void;
  onSearch(): void;
  onSettings(): void;
  onSwitchVault(): void;
  /** Set when a newer version is ready to install. */
  updateVersion: string | null;
  onUpdate(): void;
}

const DRAG_TYPE = "application/x-noodle-path";
const parentOf = (path: string) => path.split("/").slice(0, -1).join("/");

export function Sidebar(props: Props) {
  const tree = useMemo(() => buildTree(props.entries), [props.entries]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // Drag and drop: what is being dragged, and which folder ("" = top) it would land in.
  const dragging = useRef<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const canDrop = (folder: string) => {
    const from = dragging.current;
    return !!from && from !== folder && !folder.startsWith(from + "/") && parentOf(from) !== folder;
  };
  const dragOver = (e: React.DragEvent, folder: string) => {
    if (!canDrop(folder)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    if (dropTarget !== folder) {
      setDropTarget(folder);
      // Hovering a closed folder for a moment opens it, so you can go deeper.
      clearTimeout(openTimer.current);
      if (folder && collapsed.has(folder)) openTimer.current = setTimeout(() => toggle(folder), 650);
    }
  };
  const drop = (e: React.DragEvent, folder: string) => {
    e.preventDefault();
    e.stopPropagation();
    const from = dragging.current;
    endDrag();
    if (from && canDropFrom(from, folder)) props.onMove(from, folder);
  };
  const canDropFrom = (from: string, folder: string) => from !== folder && !folder.startsWith(from + "/") && parentOf(from) !== folder;
  const endDrag = () => {
    dragging.current = null;
    clearTimeout(openTimer.current);
    setDropTarget(null);
  };

  const toggle = (path: string) =>
    setCollapsed((s) => {
      const next = new Set(s);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });

  const renderNode = (node: TreeNode, depth: number) => {
    const { entry } = node;
    const isFolder = entry.kind === "folder";
    const open = !collapsed.has(entry.path);
    return (
      <div key={entry.path}>
        <div
          className={`tree-row ${props.activePath === entry.path ? "active" : ""} ${isFolder && dropTarget === entry.path ? "drop-here" : ""}`}
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => (isFolder ? toggle(entry.path) : props.onOpen(entry.path))}
          title={entry.path}
          draggable
          onDragStart={(e) => {
            dragging.current = entry.path;
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData(DRAG_TYPE, entry.path);
          }}
          onDragEnd={endDrag}
          onDragOver={(e) => dragOver(e, isFolder ? entry.path : parentOf(entry.path))}
          onDrop={(e) => drop(e, isFolder ? entry.path : parentOf(entry.path))}
        >
          {isFolder ? (
            <ChevronRight size={14} className={`chevron ${open ? "open" : ""}`} />
          ) : (
            <span className="chevron-spacer" />
          )}
          {isFolder ? <Folder size={15} className="row-icon" /> : <FileText size={15} className="row-icon" />}
          <span className="tree-label">{isFolder ? entry.path.split("/").pop() : noteName(entry.path)}</span>
          <span className="row-actions" onClick={(e) => e.stopPropagation()}>
            {isFolder && (
              <button title="New note here" onClick={() => props.onNewNote(entry.path)}>
                <FilePlus size={13} />
              </button>
            )}
            {isFolder && (
              <button title="New folder inside" onClick={() => props.onNewFolder(entry.path)}>
                <FolderPlus size={13} />
              </button>
            )}
            <button title="Rename" onClick={() => props.onRename(entry.path)}>
              <Pencil size={13} />
            </button>
            <button title="Move to trash" onClick={() => props.onTrash(entry.path)}>
              <Trash2 size={13} />
            </button>
          </span>
        </div>
        {isFolder && open && node.children.map((c) => renderNode(c, depth + 1))}
      </div>
    );
  };

  return (
    <aside className="sidebar">
      <button className="vault-switcher" onClick={props.onSwitchVault} title="Open or start another vault">
        <Logo size={26} />
        <span className="vault-name">{props.vaultName}</span>
      </button>
      <nav className="sidebar-actions">
        <button onClick={props.onSearch}>
          <Search size={15} /> Search <kbd>Ctrl Shift F</kbd>
        </button>
        <button onClick={() => props.onNewNote("")}>
          <FilePlus size={15} /> New note <kbd>Ctrl N</kbd>
        </button>
        <button onClick={() => props.onNewFolder("")}>
          <FolderPlus size={15} /> New folder
        </button>
      </nav>
      <div
        className={`tree-heading ${dropTarget === "" ? "drop-here" : ""}`}
        onDragOver={(e) => dragOver(e, "")}
        onDrop={(e) => drop(e, "")}
      >
        Notes
      </div>
      <div
        className={`tree ${dropTarget === "" ? "drop-root" : ""}`}
        onDragOver={(e) => dragOver(e, "")}
        onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDropTarget(null)}
        onDrop={(e) => drop(e, "")}
      >
        {tree.map((n) => renderNode(n, 0))}
      </div>
      {props.updateVersion && (
        <button className="update-pill" onClick={props.onUpdate} title="Install the new version">
          <Sparkles size={15} /> Update to v{props.updateVersion}
        </button>
      )}
      <button className="sidebar-footer" onClick={props.onSettings}>
        <Settings size={15} /> Settings
      </button>
    </aside>
  );
}
