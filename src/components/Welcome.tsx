import { FolderOpen, History, Sparkles } from "lucide-react";
import { Logo } from "./Logo";
import { isDesktop } from "../lib/api";

export function Welcome(props: { recent: string | null; error: string | null; onPick(): void; onOpenRecent(path: string): void }) {
  return (
    <div className="welcome">
      <div className="welcome-card">
        <Logo size={88} />
        <h1>Noodle</h1>
        <p className="tagline">Your notes, as plain Markdown files, looking their best.</p>
        <button className="primary big" onClick={props.onPick}>
          {isDesktop ? <FolderOpen size={18} /> : <Sparkles size={18} />}
          {isDesktop ? "Open a folder of notes" : "Try the demo vault"}
        </button>
        {props.recent && isDesktop && (
          <button className="ghost" onClick={() => props.onOpenRecent(props.recent!)}>
            <History size={16} /> Reopen {props.recent}
          </button>
        )}
        {props.error && <p className="error">{props.error}</p>}
        <p className="muted small">Works with any folder of Markdown files. Nothing leaves your computer.</p>
      </div>
    </div>
  );
}
