import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from "react";

export interface SuggestItem {
  id: string;
  title: string;
  hint?: string;
  icon?: ReactNode;
}

export interface SuggestMenuHandle {
  onKeyDown(event: KeyboardEvent): boolean;
}

interface Props {
  items: SuggestItem[];
  /** Shown when nothing matches. */
  empty: string;
  heading?: string;
  command(item: SuggestItem): void;
}

/** The pop-up list used by the "/" menu and the "[[" note picker. */
export const SuggestMenu = forwardRef<SuggestMenuHandle, Props>(function SuggestMenu({ items, empty, heading, command }, ref) {
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => setIndex(0), [items]);
  useEffect(() => {
    listRef.current?.querySelector(".on")?.scrollIntoView({ block: "nearest" });
  }, [index]);

  useImperativeHandle(ref, () => ({
    onKeyDown(event) {
      if (!items.length) return false;
      if (event.key === "ArrowDown") setIndex((i) => (i + 1) % items.length);
      else if (event.key === "ArrowUp") setIndex((i) => (i + items.length - 1) % items.length);
      else if (event.key === "Enter" || event.key === "Tab") command(items[index]);
      else return false;
      return true;
    },
  }));

  return (
    <div className="suggest-menu" ref={listRef}>
      {heading && <div className="panel-label">{heading}</div>}
      {items.length === 0 && <div className="suggest-empty">{empty}</div>}
      {items.map((item, i) => (
        <button
          key={item.id}
          className={i === index ? "on" : ""}
          onMouseEnter={() => setIndex(i)}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => command(item)}
        >
          {item.icon && <span className="suggest-icon">{item.icon}</span>}
          <span className="suggest-text">
            <span className="suggest-title">{item.title}</span>
            {item.hint && <span className="suggest-hint">{item.hint}</span>}
          </span>
        </button>
      ))}
    </div>
  );
});
