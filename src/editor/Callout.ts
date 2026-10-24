import { Node, mergeAttributes } from "@tiptap/core";
import type { DOMOutputSpec } from "@tiptap/pm/model";
import type MarkdownIt from "markdown-it";

/**
 * Callout boxes, stored as plain Markdown blockquotes:
 *
 *   > [!tip] Optional title
 *   > Body text
 */
export const CALLOUT_TYPES: Record<string, string> = {
  note: "📝",
  tip: "💡",
  info: "ℹ️",
  success: "✅",
  warning: "⚠️",
  danger: "🔥",
  quote: "💬",
  idea: "🍜",
};

const MARKER_RE = /^\[!([a-zA-Z-]+)\][+-]?[ \t]*([^\n]*)\n?/;

export function calloutPlugin(md: MarkdownIt) {
  md.core.ruler.after("inline", "callout", (state) => {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length - 2; i++) {
      if (tokens[i].type !== "blockquote_open" || tokens[i + 1].type !== "paragraph_open") continue;
      const inline = tokens[i + 2];
      const m = inline.content.match(MARKER_RE);
      if (!m) continue;
      tokens[i].attrSet("data-callout", m[1].toLowerCase());
      if (m[2]) tokens[i].attrSet("data-title", m[2]);
      // Drop the marker line from the first paragraph.
      inline.content = inline.content.slice(m[0].length);
      const children = inline.children ?? [];
      let consumed = m[0].replace(/\n$/, "").length;
      while (children.length && consumed > 0) {
        const c = children[0];
        if (c.type === "text" && c.content.length <= consumed) {
          consumed -= c.content.length;
          children.shift();
        } else if (c.type === "text") {
          c.content = c.content.slice(consumed);
          consumed = 0;
        } else {
          children.shift();
        }
      }
      if (children[0]?.type === "softbreak") children.shift();
      if (!inline.content.trim()) {
        // The marker was the whole paragraph: remove the empty paragraph.
        tokens.splice(i + 1, 3);
      }
    }
  });
}

export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,
  priority: 200, // win over the plain blockquote when parsing HTML

  addAttributes() {
    return {
      type: { default: "note", parseHTML: (el) => el.getAttribute("data-callout") ?? "note" },
      title: { default: null, parseHTML: (el) => el.getAttribute("data-title") },
    };
  },

  parseHTML() {
    return [{ tag: "blockquote[data-callout]" }, { tag: "div[data-callout]", contentElement: ".callout-body" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const type = node.attrs.type as string;
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-callout": type, class: `callout callout-${type}` }),
      ["span", { class: "callout-icon", contenteditable: "false" }, CALLOUT_TYPES[type] ?? "📌"],
      [
        "div",
        { class: "callout-main" },
        ...(node.attrs.title ? [["div", { class: "callout-title", contenteditable: "false" }, node.attrs.title]] : []),
        ["div", { class: "callout-body" }, 0],
      ],
    ] as unknown as DOMOutputSpec;
  },

  addStorage() {
    return {
      markdown: {
        serialize(
          state: {
            wrapBlock(d: string, f: string | null, n: unknown, fn: () => void): void;
            write(s: string): void;
            ensureNewLine(): void;
            renderContent(n: unknown): void;
          },
          node: { attrs: { type: string; title: string | null } },
        ) {
          state.wrapBlock("> ", null, node, () => {
            state.write(`[!${node.attrs.type}]${node.attrs.title ? " " + node.attrs.title : ""}`);
            state.ensureNewLine();
            state.renderContent(node);
          });
        },
        parse: { setup: (md: MarkdownIt) => md.use(calloutPlugin) },
      },
    };
  },
});
