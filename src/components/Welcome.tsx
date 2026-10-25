import { useState } from "react";
import { Cloud, CloudDownload, FolderOpen, FolderPlus, HardDrive, LogIn, Sparkles, X } from "lucide-react";
import { Logo } from "./Logo";
import { isDesktop, isMobile } from "../lib/api";
import type { CloudLinks, CloudVault } from "../lib/sync";
import type { VaultEntry } from "../lib/vaults";
import { folderName } from "../lib/vaults";

interface Props {
  history: VaultEntry[];
  /** The account's cloud vaults, or null when signed out. */
  cloudVaults: CloudVault[] | null;
  links: CloudLinks;
  email: string | null;
  error: string | null;
  onPick(): void;
  onOpen(path: string): void;
  onOpenCloud(vault: CloudVault): void;
  onForget(path: string): void;
  onSignIn(): void;
  /** Creates a new empty vault; `chooseParent` asks where to put it first. */
  onCreate(name: string, chooseParent: boolean): void;
}

interface Row {
  key: string;
  name: string;
  /** The folder on this device, if there is one. */
  path: string | null;
  cloud: CloudVault | null;
  time: number;
}

/** Vaults on this device and in the cloud, as one list with the newest first. */
function vaultRows(history: VaultEntry[], cloudVaults: CloudVault[] | null, links: CloudLinks): Row[] {
  const rows: Row[] = [];
  const cloudById = new Map((cloudVaults ?? []).map((v) => [v.id, v]));
  const seen = new Set<string>();
  for (const h of history) {
    const cloud = links[h.path] ? (cloudById.get(links[h.path].id) ?? null) : null;
    if (cloud) seen.add(cloud.id);
    rows.push({ key: h.path, name: h.name, path: h.path, cloud, time: Math.max(h.openedAt, cloud ? Date.parse(cloud.updated_at) : 0) });
  }
  for (const v of cloudVaults ?? []) {
    if (seen.has(v.id)) continue;
    // Synced to a folder here that isn't in the history (yet).
    const local = Object.entries(links).find(([, l]) => l.id === v.id)?.[0] ?? null;
    rows.push({ key: v.id, name: v.name, path: local, cloud: v, time: Date.parse(v.updated_at) });
  }
  return rows.sort((a, b) => b.time - a.time);
}

function ago(time: number): string {
  const s = Math.max(0, (Date.now() - time) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.round(s / 86400)} d ago`;
  return new Date(time).toLocaleDateString();
}

export function Welcome(props: Props) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("My notes");
  const rows = vaultRows(props.history, props.cloudVaults, props.links);

  return (
    <div className="welcome">
      <div className="welcome-card vaults-card">
        <Logo size={72} />
        <h1>Noodle</h1>
        <p className="tagline">Your notes, as plain Markdown files, looking their best.</p>

        {rows.length > 0 && !naming && (
          <div className="vault-list">
            <div className="vault-list-head">
              <span>Your vaults</span>
              {props.email ? (
                <span className="muted small">
                  <Cloud size={13} /> {props.email}
                </span>
              ) : (
                isDesktop && (
                  <button className="link-btn" onClick={props.onSignIn}>
                    <LogIn size={13} /> Sign in to see your cloud vaults
                  </button>
                )
              )}
            </div>
            {rows.map((r, i) => (
              <div key={r.key} className="vault-row" style={{ "--tilt": `${i % 2 ? 0.6 : -0.6}deg` } as React.CSSProperties}>
                <button className="vault-open" onClick={() => (r.path ? props.onOpen(r.path) : r.cloud && props.onOpenCloud(r.cloud))}>
                  <span className={`vault-icon ${r.cloud ? "cloud" : ""}`}>{r.path ? r.cloud ? <Cloud size={17} /> : <HardDrive size={17} /> : <CloudDownload size={17} />}</span>
                  <span className="vault-text">
                    <b>{r.name}</b>
                    <small>
                      {r.path ? (r.cloud ? "Synced" : "This device only") : "In Noodle Cloud · tap to download"}
                      {r.path && !isMobile && folderName(r.path) !== r.path && <> · {r.path}</>}
                    </small>
                  </span>
                  <span className="vault-time">{ago(r.time)}</span>
                </button>
                {r.path && props.history.some((h) => h.path === r.path) && (
                  <button className="vault-forget" title="Remove from this list (the folder stays)" onClick={() => props.onForget(r.path!)}>
                    <X size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

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
            <p className="muted small">
              {isMobile ? "It's kept on this phone" : "It becomes a new, empty folder in your Documents"}
              {props.email ? ", and in Noodle Cloud." : "."}
            </p>
            <div className="prompt-buttons">
              <button type="button" className="ghost" onClick={() => setNaming(false)}>
                Back
              </button>
              {!isMobile && (
                <button type="button" className="ghost" onClick={() => props.onCreate(name, true)}>
                  Put it somewhere else…
                </button>
              )}
              <button type="submit" className="primary">
                Create
              </button>
            </div>
          </form>
        ) : (
          <div className="welcome-actions">
            {isDesktop && (
              <button className={rows.length ? "ghost big" : "primary big"} onClick={() => setNaming(true)}>
                <FolderPlus size={18} /> Start a new vault
              </button>
            )}
            {!isMobile && (
              <button className={isDesktop ? "ghost big" : "primary big"} onClick={props.onPick}>
                {isDesktop ? <FolderOpen size={18} /> : <Sparkles size={18} />}
                {isDesktop ? "Open a folder of notes" : "Try the demo vault"}
              </button>
            )}
          </div>
        )}
        {props.error && <p className="error">{props.error}</p>}
        <p className="muted small">Works with any folder of Markdown files.</p>
      </div>
    </div>
  );
}
