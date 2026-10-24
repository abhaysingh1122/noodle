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
}

type MarkdownStorage = { markdown: { getMarkdown(): string } };

export function Editor({ docKey, markdown, onChange, onOpenLink }: Props) {
  const onChangeRef = useRef(onChange);
  const onOpenRef = useRef(onOpenLink);
  onChangeRef.current = onChange;
  onOpenRef.current = onOpenLink;

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
    onUpdate({ editor }) {
      onChangeRef.current((editor.storage as unknown as MarkdownStorage).markdown.getMarkdown());
    },
  });

  // Load a different note without recreating the editor.
  useEffect(() => {
    if (!editor) return;
    editor.commands.setContent(markdown, { emitUpdate: false });
    editor.commands.focus("start");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey, editor]);

  return <EditorContent editor={editor} />;
}
