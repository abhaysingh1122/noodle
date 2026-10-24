import { Node, InputRule, mergeAttributes } from "@tiptap/core";
import type MarkdownIt from "markdown-it";

/**
 * `[[Note]]`, `[[Note#Heading|alias]]` and `![[Embed]]` as an inline,
 * atomic chip. It round-trips to exactly the same Markdown, so files stay
 * readable by any other Markdown tool.
 */
export interface WikiLinkAttrs {
  target: string; // everything before the "|", e.g. "Note#Heading"
  alias: string | null;
  embed: boolean;
}

const INLINE_RE = /^(!?)\[\[([^\]\n|]+)(?:\|([^\]\n]*))?\]\]/;

export function wikiLinkPlugin(md: MarkdownIt) {
  md.inline.ruler.before("link", "wikilink", (state, silent) => {
    const src = state.src.slice(state.pos);
    const m = src.match(INLINE_RE);
    if (!m) return false;
    if (!silent) {
      const token = state.push("html_inline", "", 0);
      const span = document.createElement("span");
      span.setAttribute("data-wikilink", m[2].trim());
      if (m[3] !== undefined) span.setAttribute("data-alias", m[3]);
      if (m[1]) span.setAttribute("data-embed", "true");
      span.textContent = m[3] || m[2];
      token.content = span.outerHTML;
    }
    state.pos += m[0].length;
    return true;
  });
}

export const WikiLink = Node.create({
  name: "wikiLink",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addOptions() {
    return { onOpen: (_target: string) => {} };
  },

  addAttributes() {
    return {
      target: { default: "", parseHTML: (el) => el.getAttribute("data-wikilink") ?? "" },
      alias: { default: null, parseHTML: (el) => el.getAttribute("data-alias") },
      embed: { default: false, parseHTML: (el) => el.getAttribute("data-embed") === "true" },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-wikilink]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const { target, alias, embed } = node.attrs as WikiLinkAttrs;
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-wikilink": target,
        class: embed ? "wikilink wikilink-embed" : "wikilink",
        title: target,
      }),
      alias || target.replace(/#/, " › "),
    ];
  },

  renderText({ node }) {
    return node.attrs.alias || node.attrs.target;
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: { write(s: string): void }, node: { attrs: WikiLinkAttrs }) {
          const { target, alias, embed } = node.attrs;
          state.write(`${embed ? "!" : ""}[[${target}${alias !== null ? `|${alias}` : ""}]]`);
        },
        parse: { setup: (md: MarkdownIt) => md.use(wikiLinkPlugin) },
      },
    };
  },

  addInputRules() {
    // Typing the closing "]]" turns the text into a link chip.
    return [
      new InputRule({
        find: /(!?)\[\[([^\]\n|]+)(?:\|([^\]\n]*))?\]\]$/,
        handler: ({ state, range, match }) => {
          const node = this.type.create({ target: match[2].trim(), alias: match[3] ?? null, embed: match[1] === "!" });
          state.tr.replaceWith(range.from, range.to, node);
        },
      }),
    ];
  },
});
