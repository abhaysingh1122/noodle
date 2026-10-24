import { useState } from "react";
import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { Bold, Code, Highlighter, Italic, Link, Strikethrough, Underline, ChevronDown, Type, Check } from "lucide-react";

/** Text colours: soft enough for the pastel theme, dark enough to read on it. */
export const TEXT_COLORS = [
  { name: "Default", value: null },
  { name: "Moss", value: "#4f8a3c" },
  { name: "Olive", value: "#7d7a2a" },
  { name: "Honey", value: "#b7791f" },
  { name: "Clay", value: "#c0563b" },
  { name: "Berry", value: "#b03a6f" },
  { name: "Plum", value: "#7a4fb0" },
  { name: "Sea", value: "#2f7f9e" },
  { name: "Stone", value: "#7a8270" },
];

export const HIGHLIGHTS = [
  { name: "None", value: null },
  { name: "Lemon", value: "#fff3b0" },
  { name: "Mint", value: "#d5f0cb" },
  { name: "Peach", value: "#fde0cc" },
  { name: "Rose", value: "#fbd5e3" },
  { name: "Lilac", value: "#e6dcf8" },
  { name: "Sky", value: "#d3ecf6" },
];

export const FONTS = [
  { name: "Rounded", value: null, css: "var(--font)" },
  { name: "Serif", value: "Georgia, 'Iowan Old Style', serif", css: "Georgia, serif" },
  { name: "Mono", value: "ui-monospace, 'Cascadia Code', Consolas, monospace", css: "var(--mono)" },
  { name: "Hand", value: "'Segoe Print', 'Bradley Hand', 'Comic Sans MS', cursive", css: "'Segoe Print', 'Bradley Hand', cursive" },
];

type BlockKind = { label: string; isActive(e: Editor): boolean; apply(e: Editor): void };

export const BLOCKS: BlockKind[] = [
  { label: "Text", isActive: (e) => e.isActive("paragraph"), apply: (e) => e.chain().focus().setParagraph().run() },
  { label: "Heading 1", isActive: (e) => e.isActive("heading", { level: 1 }), apply: (e) => e.chain().focus().setHeading({ level: 1 }).run() },
  { label: "Heading 2", isActive: (e) => e.isActive("heading", { level: 2 }), apply: (e) => e.chain().focus().setHeading({ level: 2 }).run() },
  { label: "Heading 3", isActive: (e) => e.isActive("heading", { level: 3 }), apply: (e) => e.chain().focus().setHeading({ level: 3 }).run() },
  { label: "Bulleted list", isActive: (e) => e.isActive("bulletList"), apply: (e) => e.chain().focus().toggleBulletList().run() },
  { label: "Numbered list", isActive: (e) => e.isActive("orderedList"), apply: (e) => e.chain().focus().toggleOrderedList().run() },
  { label: "Checklist", isActive: (e) => e.isActive("taskList"), apply: (e) => e.chain().focus().toggleTaskList().run() },
  { label: "Quote", isActive: (e) => e.isActive("blockquote"), apply: (e) => e.chain().focus().toggleBlockquote().run() },
  { label: "Code", isActive: (e) => e.isActive("codeBlock"), apply: (e) => e.chain().focus().toggleCodeBlock().run() },
];

type Panel = "block" | "color" | "font" | "link" | null;

/** The toolbar that pops up over selected text. */
export function FormatBar({ editor }: { editor: Editor }) {
  const [panel, setPanel] = useState<Panel>(null);
  const [href, setHref] = useState("");
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      code: e.isActive("code"),
      link: e.isActive("link"),
      color: (e.getAttributes("textStyle").color as string | undefined) ?? null,
      font: (e.getAttributes("textStyle").fontFamily as string | undefined) ?? null,
      highlight: e.isActive("highlight"),
      block: BLOCKS.find((b) => b.isActive(e))?.label ?? "Text",
    }),
  });

  const toggle = (p: Panel) => setPanel((cur) => (cur === p ? null : p));
  const chain = () => editor.chain().focus();
  const mark = (on: boolean, run: () => void, title: string, icon: React.ReactNode) => (
    <button className={on ? "on" : ""} title={title} onMouseDown={(e) => e.preventDefault()} onClick={run}>
      {icon}
    </button>
  );

  return (
    <BubbleMenu
      editor={editor}
      className="format-bar"
      options={{ placement: "top", offset: 10, onHide: () => setPanel(null) }}
      shouldShow={({ editor: e, from, to }) => from !== to && !e.isActive("codeBlock") && !e.isActive("wikiLink") && e.isEditable}
    >
      <div className="format-row">
        <button className="format-block" onMouseDown={(e) => e.preventDefault()} onClick={() => toggle("block")}>
          {state.block} <ChevronDown size={13} />
        </button>
        <span className="format-sep" />
        {mark(state.bold, () => chain().toggleBold().run(), "Bold (Ctrl B)", <Bold size={15} />)}
        {mark(state.italic, () => chain().toggleItalic().run(), "Italic (Ctrl I)", <Italic size={15} />)}
        {mark(state.underline, () => chain().toggleUnderline().run(), "Underline (Ctrl U)", <Underline size={15} />)}
        {mark(state.strike, () => chain().toggleStrike().run(), "Strikethrough", <Strikethrough size={15} />)}
        {mark(state.code, () => chain().toggleCode().run(), "Inline code", <Code size={15} />)}
        {mark(
          state.link,
          () => {
            setHref((editor.getAttributes("link").href as string | undefined) ?? "");
            toggle("link");
          },
          "Link",
          <Link size={15} />,
        )}
        <span className="format-sep" />
        <button className={`format-color ${panel === "color" ? "on" : ""}`} title="Colour and highlight" onMouseDown={(e) => e.preventDefault()} onClick={() => toggle("color")}>
          <span className="color-a" style={{ color: state.color ?? undefined, background: state.highlight ? "var(--yellow)" : undefined }}>
            A
          </span>
          <Highlighter size={13} />
        </button>
        <button className={panel === "font" ? "on" : ""} title="Font" onMouseDown={(e) => e.preventDefault()} onClick={() => toggle("font")}>
          <Type size={15} />
        </button>
      </div>

      {panel === "block" && (
        <div className="format-panel list">
          {BLOCKS.map((b) => (
            <button key={b.label} onMouseDown={(e) => e.preventDefault()} onClick={() => (b.apply(editor), setPanel(null))}>
              {b.label} {state.block === b.label && <Check size={14} />}
            </button>
          ))}
        </div>
      )}

      {panel === "color" && (
        <div className="format-panel">
          <div className="panel-label">Text</div>
          <div className="fmt-swatches">
            {TEXT_COLORS.map((c) => (
              <button
                key={c.name}
                title={c.name}
                className={`fmt-swatch text ${state.color === c.value ? "on" : ""}`}
                style={{ color: c.value ?? "var(--text)" }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => (c.value ? chain().setColor(c.value).run() : chain().unsetColor().run())}
              >
                A
              </button>
            ))}
          </div>
          <div className="panel-label">Highlight</div>
          <div className="fmt-swatches">
            {HIGHLIGHTS.map((h) => (
              <button
                key={h.name}
                title={h.name}
                className="fmt-swatch"
                style={{ background: h.value ?? "var(--bg)" }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => (h.value ? chain().setHighlight({ color: h.value }).run() : chain().unsetHighlight().run())}
              >
                {h.value ? "" : "∅"}
              </button>
            ))}
          </div>
        </div>
      )}

      {panel === "font" && (
        <div className="format-panel list">
          {FONTS.map((f) => (
            <button
              key={f.name}
              style={{ fontFamily: f.css }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                if (f.value) chain().setFontFamily(f.value).run();
                else chain().unsetFontFamily().run();
                setPanel(null);
              }}
            >
              {f.name} {(state.font ?? null) === f.value && <Check size={14} />}
            </button>
          ))}
        </div>
      )}

      {panel === "link" && (
        <form
          className="format-panel link"
          onSubmit={(e) => {
            e.preventDefault();
            const url = href.trim();
            if (url) chain().extendMarkRange("link").setLink({ href: /^[a-z]+:/i.test(url) ? url : `https://${url}` }).run();
            else chain().extendMarkRange("link").unsetLink().run();
            setPanel(null);
          }}
        >
          <input autoFocus placeholder="Paste a link…" value={href} onChange={(e) => setHref(e.target.value)} />
          <button type="submit" className="primary">
            {href.trim() ? "Save" : "Remove"}
          </button>
        </form>
      )}
    </BubbleMenu>
  );
}
