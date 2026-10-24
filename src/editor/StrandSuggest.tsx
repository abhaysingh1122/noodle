import { Extension } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion from "@tiptap/suggestion";
import { FilePlus, FileText } from "lucide-react";
import type { SuggestItem } from "../components/SuggestMenu";
import { suggestPopup } from "./suggestPopup";

export interface StrandOptions {
  /** Note paths in the vault, read whenever the picker opens or filters. */
  getNotes(): string[];
}

const nameOf = (path: string) => (path.split("/").pop() ?? path).replace(/\.md$/i, "");

/** Typing "[[" offers the vault's notes; picking one inserts a strand to it. */
export const StrandSuggest = Extension.create<StrandOptions>({
  name: "strandSuggest",
  addOptions() {
    return { getNotes: () => [] };
  },
  addProseMirrorPlugins() {
    return [
      Suggestion<SuggestItem>({
        editor: this.editor,
        pluginKey: new PluginKey("strandSuggest"),
        char: "[[",
        allowSpaces: true,
        allowedPrefixes: null,
        items: ({ query }) => {
          const q = query.toLowerCase().trim();
          const notes = this.options.getNotes();
          const names = new Map<string, string>(); // name -> path; duplicate names keep the shortest path
          for (const p of notes) {
            const n = nameOf(p);
            if (!names.has(n) || p.length < names.get(n)!.length) names.set(n, p);
          }
          const hits = [...names.entries()]
            .filter(([n]) => !q || n.toLowerCase().includes(q))
            .sort(([a], [b]) => Number(!a.toLowerCase().startsWith(q)) - Number(!b.toLowerCase().startsWith(q)) || a.localeCompare(b))
            .slice(0, 8)
            .map(([n, p]): SuggestItem => ({ id: n, title: n, hint: p.includes("/") ? p.replace(/\.md$/i, "") : undefined, icon: <FileText size={15} /> }));
          if (q && !hits.some((h) => h.title.toLowerCase() === q)) {
            hits.push({ id: `new:${query.trim()}`, title: query.trim(), hint: "New note", icon: <FilePlus size={15} /> });
          }
          return hits;
        },
        command: ({ editor, range, props }) => {
          const target = props.id.startsWith("new:") ? props.id.slice(4) : props.id;
          // Swallow a "]]" the editor may have auto-closed after the caret.
          const after = editor.state.doc.textBetween(range.to, Math.min(range.to + 2, editor.state.doc.content.size), "", "");
          const to = after === "]]" ? range.to + 2 : range.to;
          editor
            .chain()
            .focus()
            .deleteRange({ from: range.from, to })
            .insertContent([{ type: "wikiLink", attrs: { target, alias: null, embed: false } }, { type: "text", text: " " }])
            .run();
        },
        render: suggestPopup({ empty: "Type a note name", heading: "Tie to a note" }),
      }),
    ];
  },
});
