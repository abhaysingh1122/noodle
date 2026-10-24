import { useState } from "react";
import { FolderOpen, FolderPlus, History, Sparkles } from "lucide-react";
import { Logo } from "./Logo";
import { isDesktop } from "../lib/api";

interface Props {
  recent: string | null;
  error: string | null;
  onPick(): void;
  onOpenRecent(path: string): void;
  /** Creates a new empty vault; `chooseParent` asks where to put it first. */
  onCreate(name: string, chooseParent: boolean): void;
}

export function Welcome(props: Props) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("My notes");

  return (
    <div className="welcome">
      <div className="welcome-card">
        <Logo size={88} />
        <h1>Noodle</h1>
        <p className="tagline">Your notes, as plain Markdown files, looking their best.</p>
        {naming && isDesktop ? (
          <form
            className="new-vault"
            onSubmit={(e) => {
              e.preventDefault();
              props.onCreate(name, false);
            }}
          >
            <label>Name your vault</label>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onFocus={(e) => e.target.select()} />
            <p className="muted small">It becomes a new, empty folder in your Documents.</p>
            <div className="prompt-buttons">
              <button type="button" className="ghost" onClick={() => props.onCreate(name, true)}>
                Put it somewhere else…
              </button>
              <button type="submit" className="primary">
                Create
              </button>
            </div>
          </form>
        ) : (
          <>
            {isDesktop && (
              <button className="primary big" onClick={() => setNaming(true)}>
                <FolderPlus size={18} /> Start a new vault
              </button>
            )}
            <button className={isDesktop ? "ghost big" : "primary big"} onClick={props.onPick}>
              {isDesktop ? <FolderOpen size={18} /> : <Sparkles size={18} />}
              {isDesktop ? "Open a folder of notes" : "Try the demo vault"}
            </button>
            {props.recent && isDesktop && (
              <button className="ghost" onClick={() => props.onOpenRecent(props.recent!)}>
                <History size={16} /> Reopen {props.recent}
              </button>
            )}
          </>
        )}
        {props.error && <p className="error">{props.error}</p>}
        <p className="muted small">Works with any folder of Markdown files. Nothing leaves your computer.</p>
      </div>
    </div>
  );
}
