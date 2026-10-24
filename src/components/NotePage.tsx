import { useCallback, useEffect, useRef, useState } from "react";
import { ImagePlus, Smile, Link2, Upload, Shuffle, Trash2 } from "lucide-react";
import type { Backlink } from "../lib/api";
import { noteName } from "../lib/api";
import { readField } from "../lib/frontmatter";
import { api, isDesktop } from "../lib/api";
import { isImagePath, mediaUrl } from "../lib/media";
import { Editor } from "./Editor";

/** Pastel gradient covers, referenced from frontmatter as `cover: <id>`. */
export const COVERS: Record<string, string> = {
  garden: "linear-gradient(120deg, #CDEBC3 0%, #FFF3B0 100%)",
  meadow: "linear-gradient(135deg, #B9DFA8 0%, #E9F6D9 60%, #FFF6CC 100%)",
  butter: "linear-gradient(120deg, #FFF3B0 0%, #FBE7A1 50%, #F6D982 100%)",
  matcha: "linear-gradient(120deg, #9CC98A 0%, #D7EBC8 100%)",
  olive: "linear-gradient(120deg, #A3AE6A 0%, #E6E9CC 100%)",
  dusk: "linear-gradient(120deg, #DDEFD4 0%, #F9E7C8 50%, #F4C9A8 100%)",
};
const ICONS = [
  "🍜", "🌱", "🍋", "🥒", "🌼", "📒", "✨", "🧠", "🗂️", "🌿", "🍵", "🐸",
  "📝", "📚", "💡", "🎯", "🚀", "🧩", "🗓️", "✅", "🔖", "📌", "🎨", "🎧",
  "🏠", "💼", "💰", "🧪", "🛠️", "🌍", "☕", "🍀", "🌈", "🔥", "⭐", "❤️",
];

function coverStyle(cover: string | null): string | null {
  if (!cover) return null;
  if (COVERS[cover]) return COVERS[cover];
  if (/^https?:\/\//.test(cover) || isImagePath(cover)) return `center / cover no-repeat url("${mediaUrl(cover)}")`;
  return COVERS.garden;
}

/** A small floating card that closes when you click anywhere else. */
function Popover({ onClose, className, children }: { onClose(): void; className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    setTimeout(() => document.addEventListener("mousedown", onDown));
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  return (
    <div ref={ref} className={`popover ${className ?? ""}`}>
      {children}
    </div>
  );
}

interface Props {
  path: string;
  docKey: string;
  frontmatter: string;
  body: string;
  backlinks: Backlink[];
  onBodyChange(markdown: string): void;
  onFieldChange(key: string, value: string | null): void;
  onRename(newName: string): void;
  onOpenLink(target: string): void;
  onOpenPath(path: string): void;
  flushRef?: { current: (() => void) | null };
  notes: string[];
}

export function NotePage(p: Props) {
  const icon = readField(p.frontmatter, "icon");
  const cover = coverStyle(readField(p.frontmatter, "cover"));
  const [title, setTitle] = useState(noteName(p.path));
  useEffect(() => setTitle(noteName(p.path)), [p.path]);

  const commitTitle = () => {
    const t = title.trim().replace(/[\\/:*?"<>|]/g, "");
    if (t && t !== noteName(p.path)) p.onRename(t);
    else setTitle(noteName(p.path));
  };
  // Banner motion: adding one unrolls it like a flag and knocks the emoji
  // badge into a wobble; removing it rolls it back up first.
  const [motion, setMotion] = useState<"unfurl" | "rollup" | null>(null);
  const motionTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(motionTimer.current), []);
  useEffect(() => setMotion(null), [p.path]);
  const play = (m: "unfurl" | "rollup", ms: number, then?: () => void) => {
    clearTimeout(motionTimer.current);
    setMotion(m);
    motionTimer.current = setTimeout(() => {
      setMotion(null);
      then?.();
    }, ms);
  };

  const cycleCover = () => {
    const ids = Object.keys(COVERS);
    const current = readField(p.frontmatter, "cover");
    p.onFieldChange("cover", ids[(ids.indexOf(current ?? "") + 1) % ids.length]);
    if (!current) play("unfurl", 1100);
  };
  const removeCover = () => play("rollup", 420, () => p.onFieldChange("cover", null));
  const randomIcon = () => p.onFieldChange("icon", ICONS[Math.floor(Math.random() * ICONS.length)]);
  const [picker, setPicker] = useState<"icon" | "banner" | null>(null);
  const closePicker = useCallback(() => setPicker(null), []);

  // Copies a picture from the computer into the vault and uses it.
  const upload = async (field: "icon" | "cover") => {
    setPicker(null);
    const picked = await api.pickImage();
    if (!picked) return;
    const hadCover = !!readField(p.frontmatter, "cover");
    p.onFieldChange(field, await api.importImage(picked));
    if (field === "cover" && !hadCover) play("unfurl", 1100);
  };
  const iconValue = icon && isImagePath(icon) ? <img src={mediaUrl(icon)} alt="" draggable={false} /> : icon;

  return (
    <div className="page-scroll">
      {cover && (
        <div className={`cover ${motion ?? ""}`} style={{ background: cover }}>
          <div className={`cover-actions ${picker === "banner" ? "pinned" : ""}`}>
            <button onClick={() => setPicker(picker === "banner" ? null : "banner")}>Change banner</button>
            <button onClick={removeCover}>Remove</button>
          </div>
          {picker === "banner" && (
            <Popover className="banner-picker" onClose={closePicker}>
              <div className="panel-label">Colours</div>
              <div className="banner-swatches">
                {Object.entries(COVERS).map(([id, bg]) => (
                  <button key={id} title={id} style={{ background: bg }} onClick={() => p.onFieldChange("cover", id)} />
                ))}
              </div>
              {isDesktop && (
                <button className="popover-action" onClick={() => upload("cover")}>
                  <Upload size={15} /> Upload an image…
                </button>
              )}
            </Popover>
          )}
        </div>
      )}
      <article className={`page ${cover ? "has-cover" : ""}`}>
        {icon && (
          <button className={`page-icon ${isImagePath(icon) ? "is-image" : ""} ${motion === "unfurl" ? "bumped" : ""}`} title="Change emoji (right-click to remove)" onClick={() => setPicker(picker === "icon" ? null : "icon")} onContextMenu={(e) => { e.preventDefault(); p.onFieldChange("icon", null); }}>
            {iconValue}
          </button>
        )}
        {picker === "icon" && (
          <Popover className="icon-picker" onClose={closePicker}>
            <div className="emoji-grid">
              {ICONS.map((e) => (
                <button key={e} onClick={() => (p.onFieldChange("icon", e), setPicker(null))}>
                  {e}
                </button>
              ))}
            </div>
            <div className="popover-actions">
              <button className="popover-action" onClick={() => (randomIcon(), setPicker(null))}>
                <Shuffle size={15} /> Surprise me
              </button>
              {isDesktop && (
                <button className="popover-action" onClick={() => upload("icon")}>
                  <Upload size={15} /> Upload…
                </button>
              )}
              {icon && (
                <button className="popover-action" onClick={() => (p.onFieldChange("icon", null), setPicker(null))}>
                  <Trash2 size={15} /> Remove
                </button>
              )}
            </div>
          </Popover>
        )}
        <div className="page-controls">
          {!icon && (
            <button onClick={() => setPicker("icon")}>
              <Smile size={14} /> Add emoji
            </button>
          )}
          {!cover && (
            <button onClick={cycleCover}>
              <ImagePlus size={14} /> Add banner
            </button>
          )}
        </div>
        <input
          className="page-title"
          value={title}
          placeholder="Untitled"
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
        <Editor docKey={p.docKey} markdown={p.body} onChange={p.onBodyChange} onOpenLink={p.onOpenLink} flushRef={p.flushRef} notes={p.notes} />
        <section className="backlinks">
          <h3>
            <Link2 size={15} /> {p.backlinks.length === 0 ? "No strands yet" : p.backlinks.length === 1 ? "1 strand leads here" : `${p.backlinks.length} strands lead here`}
          </h3>
          {p.backlinks.length === 0 && <p className="muted">Connect another note to this one by typing [[{noteName(p.path)}]] in it.</p>}
          {p.backlinks.map((b) => (
            <button key={`${b.source}:${b.line}`} className="backlink" onClick={() => p.onOpenPath(b.source)}>
              <span className="backlink-source">{noteName(b.source)}</span>
              <span className="backlink-context">{b.context}</span>
            </button>
          ))}
        </section>
      </article>
    </div>
  );
}
