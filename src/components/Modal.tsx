import { useEffect, useRef, type ReactNode } from "react";

export function Modal({ onClose, children, wide }: { onClose(): void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className={`modal ${wide ? "wide" : ""}`} onMouseDown={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

/** A small text prompt, used instead of window.prompt (which desktop webviews may not support). */
export function PromptModal(props: { title: string; initial?: string; confirm: string; onSubmit(v: string): void; onClose(): void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <Modal onClose={props.onClose}>
      <form
        className="prompt"
        onSubmit={(e) => {
          e.preventDefault();
          const v = ref.current?.value.trim();
          if (v) props.onSubmit(v);
        }}
      >
        <label>{props.title}</label>
        <input ref={ref} defaultValue={props.initial} />
        <div className="prompt-buttons">
          <button type="button" className="ghost" onClick={props.onClose}>
            Cancel
          </button>
          <button type="submit" className="primary">
            {props.confirm}
          </button>
        </div>
      </form>
    </Modal>
  );
}
