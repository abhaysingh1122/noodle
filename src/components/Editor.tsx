import { useEffect, useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import Placeholder from "@tiptap/extension-placeholder";
import { baseExtensions } from "../editor/extensions";

interface Props {
  /** Changes whenever a different note (or an outside edit) is loaded. */
  docKey: string;
  markdown: string;
  onChange(markdown: string): void;
  onOpenLink(target: string): void;
  /** Receives a function that delivers any not-yet-reported edit right away. */
  flushRef?: { current: (() => void) | null };
}

// Turning the whole document back into Markdown on every keystroke is what
// made typing in long notes sluggish, so it waits for a short pause instead.
const SERIALIZE_DELAY_MS = 200;

type MarkdownStorage = { markdown: { getMarkdown(): string } };

export function Editor({ docKey, markdown, onChange, onOpenLink, flushRef }: Props) {
  const onChangeRef = useRef(onChange);
  const onOpenRef = useRef(onOpenLink);
  onChangeRef.current = onChange;
  onOpenRef.current = onOpenLink;
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorRef = useRef<ReturnType<typeof useEditor>>(null);

  const flush = () => {
    if (!pending.current) return;
    clearTimeout(pending.current);
    pending.current = null;
    const ed = editorRef.current;
    if (ed && !ed.isDestroyed) onChangeRef.current((ed.storage as unknown as MarkdownStorage).markdown.getMarkdown());
  };

  const editor = useEditor({
    extensions: [
      ...baseExtensions(),
      Placeholder.configure({ placeholder: "Start typing. Use [[ to tie this note to another one…" }),
    ],
    content: markdown,
    editorProps: {
      attributes: { class: "noodle-prose", spellcheck: "true" },
      handleClickOn(_view, _pos, node) {
        if (node.type.name === "wikiLink") {
          onOpenRef.current(node.attrs.target as string);
          return true;
        }
        return false;
      },
    },
    onUpdate() {
      if (pending.current) clearTimeout(pending.current);
      pending.current = setTimeout(flush, SERIALIZE_DELAY_MS);
    },
  });
  editorRef.current = editor;

  useEffect(() => {
    if (!flushRef) return;
    flushRef.current = flush;
    return () => {
      flush();
      flushRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flushRef]);

  // Load a different note without recreating the editor.
  useEffect(() => {
    if (!editor) return;
    if (pending.current) clearTimeout(pending.current);
    pending.current = null;
    editor.commands.setContent(markdown, { emitUpdate: false });
    editor.commands.focus("start");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey, editor]);

  return <EditorContent editor={editor} />;
}
