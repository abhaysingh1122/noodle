import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";
import { GripVertical, Plus } from "lucide-react";

interface Spot {
  /** Document position right before the hovered block. */
  pos: number;
  top: number;
}

const ITEM_TYPES = new Set(["listItem", "taskItem"]);

/**
 * The grip that appears to the left of whichever block the mouse is over.
 * Drag it to move the block, click it to select the block, or press + to add
 * a new block below (which opens the "/" menu).
 */
export function BlockHandle({ editor, shell }: { editor: Editor; shell: React.RefObject<HTMLDivElement | null> }) {
  const [spot, setSpot] = useState<Spot | null>(null);
  const spotRef = useRef<Spot | null>(null);
  spotRef.current = spot;

  useEffect(() => {
    const el = shell.current;
    if (!el) return;
    let frame = 0;
    const onMove = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest(".block-handle")) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (editor.isDestroyed) return;
        const view = editor.view;
        const rect = view.dom.getBoundingClientRect();
        // Probe inside the text column, so hovering the gutter still works.
        const left = Math.min(Math.max(e.clientX, rect.left + 24), rect.right - 4);
        const hit = view.posAtCoords({ left, top: e.clientY });
        if (!hit) return;
        const $pos = view.state.doc.resolve(hit.inside >= 0 ? hit.inside : hit.pos);
        let depth = Math.min(1, $pos.depth);
        for (let d = $pos.depth; d > 0; d--) {
          if (ITEM_TYPES.has($pos.node(d).type.name)) {
            depth = d;
            break;
          }
        }
        let pos: number;
        if (depth === 0) {
          // posAtCoords landed between blocks; use the block it points into.
          const node = view.state.doc.nodeAt(hit.inside >= 0 ? hit.inside : hit.pos);
          if (!node || node.isInline) return;
          pos = hit.inside >= 0 ? hit.inside : hit.pos;
        } else {
          pos = $pos.before(depth);
        }
        const dom = view.nodeDOM(pos);
        if (!(dom instanceof HTMLElement)) return;
        const shellRect = el.getBoundingClientRect();
        const lineHeight = parseFloat(getComputedStyle(dom).lineHeight) || 26;
        const top = dom.getBoundingClientRect().top - shellRect.top + Math.min(lineHeight, dom.offsetHeight) / 2 - 13;
        if (spotRef.current?.pos !== pos || spotRef.current.top !== top) setSpot({ pos, top });
      });
    };
    const onLeave = () => setSpot(null);
    el.addEventListener("mousemove", onMove);
    el.addEventListener("mouseleave", onLeave);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("mousemove", onMove);
      el.removeEventListener("mouseleave", onLeave);
    };
  }, [editor, shell]);

  // The document changed under the handle (typing, moving): hide until the mouse moves again.
  useEffect(() => {
    const hide = () => setSpot(null);
    editor.on("update", hide);
    return () => {
      editor.off("update", hide);
    };
  }, [editor]);

  if (!spot) return null;

  const select = () => {
    const { state, dispatch } = editor.view;
    if (spot.pos >= state.doc.content.size) return null;
    const sel = NodeSelection.create(state.doc, spot.pos);
    dispatch(state.tr.setSelection(sel));
    return sel;
  };

  const onDragStart = (e: React.DragEvent) => {
    const sel = select();
    if (!sel) return;
    const view = editor.view;
    const dom = view.nodeDOM(spot.pos);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", sel.content().content.textBetween(0, sel.content().content.size, "\n"));
    if (dom instanceof HTMLElement) e.dataTransfer.setDragImage(dom, 0, 0);
    // Hand the block to ProseMirror's own drop handling, which moves it.
    (view as unknown as { dragging: unknown }).dragging = { slice: sel.content(), move: true, node: sel };
  };

  const addBelow = () => {
    const node = editor.state.doc.nodeAt(spot.pos);
    if (!node) return;
    const after = spot.pos + node.nodeSize;
    const inItem = ITEM_TYPES.has(node.type.name);
    editor
      .chain()
      .insertContentAt(after, inItem ? { type: node.type.name, content: [{ type: "paragraph" }] } : { type: "paragraph" })
      .focus(after + (inItem ? 2 : 1))
      .insertContent("/")
      .run();
  };

  return (
    <div className="block-handle" style={{ top: spot.top }}>
      <button title="Add a block below" onMouseDown={(e) => e.preventDefault()} onClick={addBelow}>
        <Plus size={16} />
      </button>
      <button className="grip" title="Drag to move, click to select" draggable onDragStart={onDragStart} onDragEnd={() => setSpot(null)} onMouseDown={(e) => e.stopPropagation()} onClick={() => (select(), editor.view.focus())}>
        <GripVertical size={16} />
      </button>
    </div>
  );
}
