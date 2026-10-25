import { useState } from "react";
import { Copy, Check, Download, Eye, EyeOff, RefreshCw, KeyRound } from "lucide-react";
import type { useLocalApi } from "../lib/localApi";
import type { CloudSync } from "../lib/sync";
import { Cloud, LogOut } from "lucide-react";
import { DEFAULT_PORT, newApiKey } from "../lib/localApi";
import type { Mode, ThemeSettings } from "../lib/theme";
import type { useUpdates } from "../lib/updates";
import { PALETTES } from "../lib/theme";
import { isMobile } from "../lib/api";
import { Modal } from "./Modal";
import { SignInForm } from "./SignIn";
import { Logo } from "./Logo";

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="ghost small-btn"
      title="Copy"
      onClick={() => {
        navigator.clipboard?.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
    >
      {done ? <Check size={14} /> : <Copy size={14} />} {label}
    </button>
  );
}

/** Switch the local HTTP API on or off, and see how to call it. */
function ApiSection({ localApi }: { localApi: ReturnType<typeof useLocalApi> }) {
  const { settings, state, update, ip } = localApi;
  const [showKey, setShowKey] = useState(false);
  const base = `http://127.0.0.1:${settings.port}`;
  const lanBase = settings.lan && ip ? `http://${ip}:${settings.port}` : null;
  const auth = `Authorization: Bearer ${settings.key}`;
  const curl = isMobile ? "curl" : "curl.exe";
  const examples = [
    `${curl} ${base}/v1/notes -H "${auth}"`,
    `${curl} ${base}/v1/notes/Welcome -H "${auth}"`,
    `${curl} -X PUT ${base}/v1/notes/Inbox --data-binary "# Inbox" -H "${auth}"`,
    `${curl} -X POST ${base}/v1/notes/Inbox/append --data-binary "- new idea" -H "${auth}"`,
    `${curl} "${base}/v1/search?q=noodle" -H "${auth}"`,
  ];
  const mcpUrl = `${lanBase ?? base}/mcp`;
  const claudeCode = `claude mcp add --transport http noodle ${mcpUrl} --header "${auth}"`;
  // The header goes through an env variable because some apps split arguments at spaces.
  const claudeDesktop = JSON.stringify(
    { mcpServers: { noodle: { command: "npx", args: ["-y", "mcp-remote", mcpUrl, "--allow-http", "--header", "Authorization:${AUTH_HEADER}"], env: { AUTH_HEADER: `Bearer ${settings.key}` } } } },
    null,
    2,
  );
  return (
    <div className="api-box">
      <div className="api-head">
        <div>
          <b>Local API</b>
          <p className="muted">
            Lets scripts, apps and AI assistants read and write your notes over HTTP. Every call needs your key.
            {isMobile && " On the phone it works while Noodle is open."}
          </p>
        </div>
        <button className={`switch ${settings.enabled ? "on" : ""}`} role="switch" aria-checked={settings.enabled} onClick={() => update({ enabled: !settings.enabled })}>
          <span />
        </button>
      </div>
      {state.kind === "error" && <p className="error">{state.message}</p>}
      {state.kind === "on" && (
        <p className="api-live">
          Listening on {base}
          {lanBase && ` and ${lanBase}`}
        </p>
      )}
      <div className="api-grid">
        <label>Port</label>
        <input
          type="number"
          min={1024}
          max={65535}
          value={settings.port}
          onChange={(e) => {
            const port = Number(e.target.value);
            if (port >= 1024 && port <= 65535) update({ port });
          }}
          onBlur={(e) => !e.target.value && update({ port: DEFAULT_PORT })}
        />
        <label>
          <KeyRound size={14} /> Key
        </label>
        <div className="api-key">
          <code>{showKey ? settings.key : settings.key.slice(0, 10) + "•".repeat(18)}</code>
          <button className="ghost small-btn" title={showKey ? "Hide" : "Show"} onClick={() => setShowKey(!showKey)}>
            {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          <CopyButton text={settings.key} />
          <button className="ghost small-btn" title="Make a new key; the old one stops working" onClick={() => update({ key: newApiKey() })}>
            <RefreshCw size={14} /> New key
          </button>
        </div>
        <label>Wi-Fi</label>
        <label className="check-row">
          <input type="checkbox" checked={settings.lan} onChange={(e) => update({ lan: e.target.checked })} />
          Let my other devices on this Wi-Fi connect {settings.lan && !ip && settings.enabled && <span className="muted">(no network found)</span>}
        </label>
      </div>
      {settings.enabled && (
        <>
          <details className="api-examples">
            <summary>Connect Claude or another AI assistant</summary>
            <p className="muted small">Noodle speaks MCP at {mcpUrl}. In Claude Code, run:</p>
            <div className="api-example">
              <code>{claudeCode}</code>
              <CopyButton text={claudeCode} />
            </div>
            <p className="muted small">For Claude Desktop, add this to its config file (Settings → Developer → Edit config), then restart it:</p>
            <div className="api-example">
              <code className="pre">{claudeDesktop}</code>
              <CopyButton text={claudeDesktop} />
            </div>
            <p className="muted small">Tools: list_notes, read_note, write_note, append_to_note, search_notes, get_backlinks.</p>
          </details>
          <details className="api-examples">
            <summary>Try it with curl</summary>
            {examples.map((ex) => (
              <div key={ex} className="api-example">
                <code>{ex}</code>
                <CopyButton text={ex} />
              </div>
            ))}
            <p className="muted small">
              Endpoints: GET /v1/notes · GET, PUT, DELETE /v1/notes/&lt;path&gt; · POST /v1/notes/&lt;path&gt;/append · GET /v1/search?q= · GET /v1/backlinks/&lt;path&gt; · GET /v1/graph · GET /v1/health · POST /mcp
            </p>
          </details>
        </>
      )}
    </div>
  );
}

/** Noodle Cloud: the account, and whether the open vault syncs. */
function AccountSection({ cloud, root }: { cloud: CloudSync; root: string | null }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const vaultName = root?.split(/[\\/]/).filter(Boolean).pop() ?? "";

  if (!cloud.session) {
    return (
      <div className="api-box">
        <b>
          <Cloud size={16} /> Sign in to Noodle Cloud
        </b>
        <p className="muted">Your vaults follow you to your phone and other computers.</p>
        <SignInForm client={cloud.client} />
      </div>
    );
  }

  const status = cloud.status;
  return (
    <div className="api-box">
      <div className="api-head">
        <div>
          <b>
            <Cloud size={16} /> Signed in as {cloud.session.user.email}
          </b>
          <p className="muted">
            {!root
              ? ""
              : cloud.linked
                ? status.kind === "syncing"
                  ? "Syncing…"
                  : status.kind === "idle" && status.at
                    ? `“${vaultName}” is in Noodle Cloud. Last sync ${status.at.toLocaleTimeString()}.`
                    : `“${vaultName}” is in Noodle Cloud.`
                : `“${vaultName}” is only on this device.`}
          </p>
        </div>
      </div>
      {status.kind === "error" && <p className="error">{status.message}</p>}
      {problem && <p className="error">{problem}</p>}
      <div className="prompt-buttons account-actions">
        <button className="ghost small-btn" onClick={() => cloud.signOut()}>
          <LogOut size={14} /> Sign out
        </button>
        {root && cloud.linked && (
          <button className="ghost small-btn" title="This copy stops syncing; the cloud copy stays" onClick={() => cloud.linkFolder(root, null)}>
            Stop syncing here
          </button>
        )}
        {root &&
          (cloud.linked ? (
            <button className="primary" disabled={status.kind === "syncing"} onClick={() => cloud.syncNow()}>
              <RefreshCw size={15} className={status.kind === "syncing" ? "spin" : ""} /> Sync now
            </button>
          ) : (
            <button
              className="primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setProblem(null);
                try {
                  await cloud.keepInCloud(root, vaultName);
                } catch (e) {
                  setProblem(e instanceof Error ? e.message : String(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Cloud size={15} /> Keep “{vaultName}” in the cloud
            </button>
          ))}
      </div>
    </div>
  );
}

export function SettingsPanel(props: {
  theme: ThemeSettings;
  updates: ReturnType<typeof useUpdates>;
  localApi: ReturnType<typeof useLocalApi>;
  cloud: CloudSync;
  root: string | null;
  onChange(t: ThemeSettings): void;
  onClose(): void;
}) {
  const u = props.updates;
  const t = props.theme;
  const set = (patch: Partial<ThemeSettings>) => props.onChange({ ...t, ...patch });
  return (
    <Modal onClose={props.onClose} wide closable>
      <div className="settings">
        <header>
          <Logo size={36} />
          <div>
            <h2>Noodle settings</h2>
            <p className="muted">Make Noodle look the way you like. Your notes are never changed by this.</p>
          </div>
        </header>
        <h4>Colour palette</h4>
        <div className="swatches">
          {PALETTES.map((p) => (
            <button key={p.id} className={`swatch ${t.palette === p.id && !t.customAccent ? "selected" : ""}`} onClick={() => set({ palette: p.id, customAccent: null })}>
              <span className="swatch-colors">
                <i style={{ background: p.light["--sidebar"] }} />
                <i style={{ background: p.light["--accent"] }} />
                <i style={{ background: p.light["--yellow"] }} />
              </span>
              {p.name}
            </button>
          ))}
        </div>
        <h4>Custom accent colour</h4>
        <div className="row">
          <input type="color" value={t.customAccent ?? "#7DB46C"} onChange={(e) => set({ customAccent: e.target.value })} />
          {t.customAccent && (
            <button className="ghost" onClick={() => set({ customAccent: null })}>
              Use palette colour
            </button>
          )}
        </div>
        <h4>Appearance</h4>
        <div className="segmented">
          {(["system", "light", "dark"] as Mode[]).map((m) => (
            <button key={m} className={t.mode === m ? "selected" : ""} onClick={() => set({ mode: m })}>
              {m[0].toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>
        <h4>Account &amp; sync</h4>
        <AccountSection cloud={props.cloud} root={props.root} />
        <h4>Connections</h4>
        <ApiSection localApi={props.localApi} />
        <h4>Updates</h4>
        <div className="update-box">
          <div>
            <b>Noodle {u.version && `v${u.version}`}</b>
            <p className="muted">
              {u.state.kind === "idle" && "Noodle checks for a new version every time it starts."}
              {u.state.kind === "checking" && "Looking for a new version…"}
              {u.state.kind === "latest" && "You have the newest version."}
              {u.state.kind === "available" && `Version ${u.state.info.latest} is ready to install.`}
              {u.state.kind === "available" && isMobile && " Tap Update now, then open the downloaded file to install it."}
              {u.state.kind === "installing" && (isMobile ? "Opening the download…" : `Downloading ${u.state.info.latest}… Noodle will close, update and reopen by itself.`)}
              {u.state.kind === "error" && u.state.message}
            </p>
          </div>
          {u.state.kind === "available" ? (
            <button className="primary" onClick={() => u.state.kind === "available" && u.install(u.state.info)}>
              <Download size={16} /> Update now
            </button>
          ) : (
            <button className="ghost" disabled={u.state.kind === "checking" || u.state.kind === "installing"} onClick={u.check}>
              <RefreshCw size={15} className={u.state.kind === "checking" || u.state.kind === "installing" ? "spin" : ""} /> Check for updates
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
