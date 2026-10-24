import { useMemo, useState } from "react";
import { FileText, Plus } from "lucide-react";
import type { Entry } from "../lib/api";
import { noteName } from "../lib/api";
import { Modal } from "./Modal";

/** Subsequence match ("gtst" finds "Getting started"); lower score is better. */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 0;
  const direct = t.indexOf(q);
  if (direct >= 0) return direct;
  let ti = 0;
  let gaps = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found < 0) return null;
    gaps += found - ti;
    ti = found + 1;
  }
  return 100 + gaps;
}

export function QuickSwitcher(props: { entries: Entry[]; onOpen(path: string): void; onCreate(name: string): void; onClose(): void }) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const results = useMemo(() => {
    return props.entries
      .filter((e) => e.kind === "file")
      .map((e) => ({ e, score: fuzzyScore(query, e.path.replace(/\.md$/i, "")) }))
      .filter((r) => r.score !== null)
      .sort((a, b) => a.score! - b.score! || b.e.mtime - a.e.mtime)
      .slice(0, 50)
      .map((r) => r.e);
  }, [props.entries, query]);
  const canCreate = query.trim() !== "" && !results.some((r) => noteName(r.path).toLowerCase() === query.trim().toLowerCase());
  const total = results.length + (canCreate ? 1 : 0);

  const choose = (i: number) => {
    if (i < results.length) props.onOpen(results[i].path);
    else if (canCreate) props.onCreate(query.trim());
  };

  return (
    <Modal onClose={props.onClose}>
      <input
        className="palette-input"
        autoFocus
        placeholder="Jump to a note, or type a new name…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setIndex(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setIndex((i) => Math.min(i + 1, total - 1));
          else if (e.key === "ArrowUp") setIndex((i) => Math.max(i - 1, 0));
          else if (e.key === "Enter") choose(index);
          else return;
          e.preventDefault();
        }}
      />
      <div className="palette-list">
        {results.map((r, i) => (
          <button key={r.path} className={i === index ? "selected" : ""} onMouseEnter={() => setIndex(i)} onClick={() => choose(i)}>
            <FileText size={15} />
            <span>{noteName(r.path)}</span>
            <span className="muted path-hint">{r.path.includes("/") ? r.path.split("/").slice(0, -1).join("/") : ""}</span>
          </button>
        ))}
        {canCreate && (
          <button className={index === results.length ? "selected" : ""} onMouseEnter={() => setIndex(results.length)} onClick={() => choose(results.length)}>
            <Plus size={15} />
            <span>Create “{query.trim()}”</span>
          </button>
        )}
      </div>
    </Modal>
  );
}
