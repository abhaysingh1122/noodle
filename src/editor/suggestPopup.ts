import { ReactRenderer } from "@tiptap/react";
import type { SuggestionOptions, SuggestionProps } from "@tiptap/suggestion";
import { SuggestMenu, type SuggestItem, type SuggestMenuHandle } from "../components/SuggestMenu";

type Render = NonNullable<SuggestionOptions<SuggestItem>["render"]>;

/** Renders a suggestion list in a floating pop-up next to the caret. */
export function suggestPopup(texts: { empty: string; heading?: string }): Render {
  return () => {
    let renderer: ReactRenderer<SuggestMenuHandle> | null = null;
    let box: HTMLDivElement | null = null;

    const place = (props: SuggestionProps<SuggestItem>) => {
      const rect = props.clientRect?.();
      if (!rect || !box) return;
      const height = box.offsetHeight || 320;
      const below = rect.bottom + 8 + height < window.innerHeight;
      box.style.left = `${Math.max(8, Math.min(rect.left - 12, window.innerWidth - box.offsetWidth - 8))}px`;
      box.style.top = below ? `${rect.bottom + 8}px` : `${Math.max(8, rect.top - height - 8)}px`;
    };
    const propsFor = (props: SuggestionProps<SuggestItem>) => ({ ...texts, items: props.items, command: props.command });

    return {
      onStart(props) {
        renderer = new ReactRenderer(SuggestMenu, { props: propsFor(props), editor: props.editor });
        box = document.createElement("div");
        box.className = "suggest-popup";
        box.appendChild(renderer.element);
        document.body.appendChild(box);
        requestAnimationFrame(() => place(props));
      },
      onUpdate(props) {
        renderer?.updateProps(propsFor(props));
        requestAnimationFrame(() => place(props));
      },
      onKeyDown({ event }) {
        if (event.key === "Escape") {
          box?.remove();
          return true;
        }
        return renderer?.ref?.onKeyDown(event) ?? false;
      },
      onExit() {
        box?.remove();
        renderer?.destroy();
        box = null;
        renderer = null;
      },
    };
  };
}
