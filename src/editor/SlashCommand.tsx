import { Extension, type Editor, type Range } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion from "@tiptap/suggestion";
import { CheckSquare, Code2, Heading1, Heading2, Heading3, Highlighter, Link2, List, ListOrdered, Minus, Quote, Sparkles, Type } from "lucide-react";
import type { SuggestItem } from "../components/SuggestMenu";
import { suggestPopup } from "./suggestPopup";

interface SlashItem extends SuggestItem {
  keywords: string;
  run(editor: Editor, range: Range): void;
}

const callout = (type: string, title: string | null) => ({
  type: "callout",
  attrs: { type, title },
  content: [{ type: "paragraph" }],
});

/** Everything the "/" menu can insert. `extra` lets the app add its own items. */
export function slashItems(extra: SlashItem[] = []): SlashItem[] {
  const base: SlashItem[] = [
    { id: "text", title: "Text", hint: "Just start writing", icon: <Type size={16} />, keywords: "paragraph plain", run: (e, r) => e.chain().focus().deleteRange(r).setParagraph().run() },
    { id: "h1", title: "Big heading", hint: "# ", icon: <Heading1 size={16} />, keywords: "h1 title heading", run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 1 }).run() },
    { id: "h2", title: "Medium heading", hint: "## ", icon: <Heading2 size={16} />, keywords: "h2 subtitle heading", run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 2 }).run() },
    { id: "h3", title: "Small heading", hint: "### ", icon: <Heading3 size={16} />, keywords: "h3 heading", run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 3 }).run() },
    { id: "bullets", title: "Bulleted list", hint: "- ", icon: <List size={16} />, keywords: "ul unordered bullet", run: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run() },
    { id: "numbers", title: "Numbered list", hint: "1. ", icon: <ListOrdered size={16} />, keywords: "ol ordered number", run: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run() },
    { id: "todo", title: "Checklist", hint: "[ ] ", icon: <CheckSquare size={16} />, keywords: "todo task checkbox", run: (e, r) => e.chain().focus().deleteRange(r).toggleTaskList().run() },
    { id: "quote", title: "Quote", hint: "> ", icon: <Quote size={16} />, keywords: "blockquote citation", run: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run() },
    { id: "tip", title: "Tip bubble", hint: "Callout", icon: <Sparkles size={16} />, keywords: "callout tip note info", run: (e, r) => e.chain().focus().deleteRange(r).insertContent(callout("tip", null)).run() },
    { id: "warning", title: "Warning bubble", hint: "Callout", icon: <Sparkles size={16} />, keywords: "callout warning caution", run: (e, r) => e.chain().focus().deleteRange(r).insertContent(callout("warning", null)).run() },
    { id: "code", title: "Code block", hint: "```", icon: <Code2 size={16} />, keywords: "snippet pre", run: (e, r) => e.chain().focus().deleteRange(r).toggleCodeBlock().run() },
    { id: "divider", title: "Divider", hint: "---", icon: <Minus size={16} />, keywords: "hr rule line separator", run: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run() },
    { id: "highlight", title: "Highlight", hint: "==text==", icon: <Highlighter size={16} />, keywords: "mark marker", run: (e, r) => e.chain().focus().deleteRange(r).setHighlight({ color: "#fff3b0" }).run() },
    { id: "strand", title: "Strand to a note", hint: "[[", icon: <Link2 size={16} />, keywords: "link wikilink note page", run: (e, r) => e.chain().focus().deleteRange(r).insertContent("[[").run() },
  ];
  return [...base, ...extra];
}

export function filterSlash(items: SlashItem[], query: string): SlashItem[] {
  const q = query.toLowerCase().trim();
  if (!q) return items;
  return items.filter((i) => i.title.toLowerCase().includes(q) || i.keywords.includes(q) || i.id.startsWith(q));
}

export interface SlashOptions {
  /** Read on every keystroke, so items can depend on app state. */
  getItems(): SlashItem[];
}

export const SlashCommand = Extension.create<SlashOptions>({
  name: "slashCommand",
  addOptions() {
    return { getItems: () => slashItems() };
  },
  addProseMirrorPlugins() {
    return [
      Suggestion<SuggestItem>({
        editor: this.editor,
        pluginKey: new PluginKey("slashCommand"),
        char: "/",
        items: ({ query }) => filterSlash(this.options.getItems(), query),
        command: ({ editor, range, props }) => (props as SlashItem).run(editor, range),
        allow: ({ state, range }) => !state.doc.resolve(range.from).parent.type.spec.code,
        render: suggestPopup({ empty: "Nothing like that yet", heading: "Add a block" }),
      }),
    ];
  },
});

export type { SlashItem };
