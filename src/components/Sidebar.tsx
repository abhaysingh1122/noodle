import { useMemo, useState } from "react";
import { ChevronRight, FilePlus, FolderPlus, Search, Settings, Trash2, Pencil, FileText, Folder } from "lucide-react";
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
  onTrash(path: string): void;
  onSearch(): void;
  onSettings(): void;
  onSwitchVault(): void;
}

export function Sidebar(props: Props) {
  const tree = useMemo(() => buildTree(props.entries), [props.entries]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

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
          className={`tree-row ${props.activePath === entry.path ? "active" : ""}`}
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => (isFolder ? toggle(entry.path) : props.onOpen(entry.path))}
          title={entry.path}
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
      <button className="vault-switcher" onClick={props.onSwitchVault} title="Open another folder">
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
      <div className="tree-heading">Notes</div>
      <div className="tree">{tree.map((n) => renderNode(n, 0))}</div>
      <button className="sidebar-footer" onClick={props.onSettings}>
        <Settings size={15} /> Settings
      </button>
    </aside>
  );
}
