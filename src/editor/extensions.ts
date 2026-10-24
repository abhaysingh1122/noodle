import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Image from "@tiptap/extension-image";
import Highlight from "@tiptap/extension-highlight";
import { Color, FontFamily, TextStyle } from "@tiptap/extension-text-style";
import { Markdown } from "tiptap-markdown";
import { mergeAttributes } from "@tiptap/core";
import { WikiLink } from "./WikiLink";
import { mediaUrl } from "../lib/media";
import { Callout } from "./Callout";

// Task lists are always written tight ("- [ ] a\n- [ ] b"), like bullet lists.
const TightTaskList = TaskList.extend({
  addAttributes() {
    return { ...this.parent?.(), tight: { default: true, rendered: false } };
  },
});

// Pictures keep their vault path (attachments/x.png) in the Markdown, but
// are shown through a URL the window can load.
const VaultImage = Image.extend({
  renderHTML({ HTMLAttributes }) {
    return ["img", mergeAttributes(this.options.HTMLAttributes, { ...HTMLAttributes, src: mediaUrl(String(HTMLAttributes.src ?? "")) })];
  },
});

/** Everything the editor understands, shared by the app and the tests. */
export function baseExtensions(onOpenLink: (target: string) => void = () => {}) {
  return [
    StarterKit.configure({ link: { openOnClick: false, autolink: true } }),
    TightTaskList,
    TaskItem.configure({ nested: true }),
    VaultImage,
    // Colours, highlights and fonts have no Markdown syntax, so they are
    // stored as small inline HTML tags, which Markdown allows.
    TextStyle,
    Color,
    FontFamily,
    Highlight.configure({ multicolor: true }),
    WikiLink.configure({ onOpen: onOpenLink }),
    Callout,
    Markdown.configure({ html: true, tightLists: true, bulletListMarker: "-", linkify: false, breaks: false, transformPastedText: true }),
  ];
}
