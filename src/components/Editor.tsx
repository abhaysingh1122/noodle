import { useEffect, useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import Placeholder from "@tiptap/extension-placeholder";
import { baseExtensions } from "../editor/extensions";
import { SlashCommand, slashItems } from "../editor/SlashCommand";
import { StrandSuggest } from "../editor/StrandSuggest";
import { FormatBar } from "./FormatBar";
import { BlockHandle } from "./BlockHandle";
import { ImageIcon } from "lucide-react";
import { api, isDesktop } from "../lib/api";

interface Props {
  /** Changes whenever a different note (or an outside edit) is loaded. */
  docKey: string;
  markdown: string;
  onChange(markdown: string): void;
  onOpenLink(target: string): void;
  /** Receives a function that delivers any not-yet-reported edit right away. */
  flushRef?: { current: (() => void) | null };
  /** Note paths, for the "[[" picker. */
  notes: string[];
}

// Turning the whole document back into Markdown on every keystroke is what
// made typing in long notes sluggish, so it waits for a short pause instead.
const SERIALIZE_DELAY_MS = 200;

type MarkdownStorage = { markdown: { getMarkdown(): string } };

export function Editor({ docKey, markdown, onChange, onOpenLink, flushRef, notes }: Props) {
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const shell = useRef<HTMLDivElement>(null);
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
      Placeholder.configure({ placeholder: "Write something, or press / for blocks and [[ to tie in another note…" }),
      SlashCommand.configure({
        getItems: () =>
          slashItems([
            {
              id: "image",
              title: "Image",
              hint: "From your computer",
              icon: <ImageIcon size={16} />,
              keywords: "picture photo upload file",
              run: async (e, r) => {
                e.chain().focus().deleteRange(r).run();
                const picked = await api.pickImage();
                if (!picked) return;
                const src = await api.importImage(picked);
                e.chain().focus().setImage({ src }).run();
              },
            },
          ]),
      }),
      StrandSuggest.configure({ getNotes: () => notesRef.current }),
    ],
    content: markdown,
    editorProps: {
      attributes: { class: "noodle-prose", spellcheck: "true" },
      // Pasted pictures (screenshots…) are saved into the vault's attachments.
      handlePaste(view, event) {
        const files = [...(event.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
        if (!files.length || !isDesktop) return false;
        event.preventDefault();
        for (const file of files) {
          const ext = file.type.split("/")[1]?.replace("jpeg", "jpg") ?? "png";
          const name = file.name && file.name !== "image.png" ? file.name : `Pasted ${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")}.${ext}`;
          file
            .arrayBuffer()
            .then((buf) => api.saveAttachment(name, new Uint8Array(buf)))
            .then((src) => {
              const image = view.state.schema.nodes.image.create({ src });
              view.dispatch(view.state.tr.replaceSelectionWith(image));
            })
            .catch((e) => console.error(e));
        }
        return true;
      },
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
    // Don't steal focus from a field the user just clicked into (renaming in the tree…).
    const active = document.activeElement;
    if (!active || active === document.body || editor.view.dom.contains(active)) editor.commands.focus("start");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey, editor]);

  return (
    <div className="editor-shell" ref={shell}>
      <EditorContent editor={editor} />
      {editor && <FormatBar editor={editor} />}
      {editor && <BlockHandle editor={editor} shell={shell} />}
    </div>
  );
}
