import { useEffect, useState } from "react";
import type { SearchHit } from "../lib/api";
import { api, noteName } from "../lib/api";
import { Modal } from "./Modal";

export function SearchPanel(props: { onOpen(path: string): void; onClose(): void }) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  useEffect(() => {
    const t = setTimeout(() => api.search(query).then(setHits).catch(() => setHits([])), 150);
    return () => clearTimeout(t);
  }, [query]);
  return (
    <Modal onClose={props.onClose} wide>
      <input className="palette-input" autoFocus placeholder="Search all notes…" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="palette-list">
        {query && hits.length === 0 && <p className="muted empty">Nothing found for “{query}”.</p>}
        {hits.map((h) => (
          <button key={`${h.path}:${h.line}`} onClick={() => props.onOpen(h.path)} className="search-hit">
            <span className="search-note">{noteName(h.path)}</span>
            <span className="muted">{h.line > 0 ? highlight(h.snippet, query) : "matches the note name"}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}

function highlight(text: string, q: string) {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}
