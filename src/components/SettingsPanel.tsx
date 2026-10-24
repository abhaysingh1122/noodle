import { useState } from "react";
import { Copy, Check, Download, Eye, EyeOff, RefreshCw, KeyRound } from "lucide-react";
import type { useLocalApi } from "../lib/localApi";
import { DEFAULT_PORT, newApiKey } from "../lib/localApi";
import type { Mode, ThemeSettings } from "../lib/theme";
import type { useUpdates } from "../lib/updates";
import { PALETTES } from "../lib/theme";
import { Modal } from "./Modal";
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
  const { settings, state, update } = localApi;
  const [showKey, setShowKey] = useState(false);
  const base = `http://127.0.0.1:${settings.port}`;
  const examples = [
    `curl.exe ${base}/v1/notes -H "Authorization: Bearer ${settings.key}"`,
    `curl.exe ${base}/v1/notes/Welcome -H "Authorization: Bearer ${settings.key}"`,
    `curl.exe -X PUT ${base}/v1/notes/Inbox --data-binary "# Inbox" -H "Authorization: Bearer ${settings.key}"`,
    `curl.exe -X POST ${base}/v1/notes/Inbox/append --data-binary "- new idea" -H "Authorization: Bearer ${settings.key}"`,
    `curl.exe "${base}/v1/search?q=noodle" -H "Authorization: Bearer ${settings.key}"`,
  ];
  return (
    <div className="api-box">
      <div className="api-head">
        <div>
          <b>Local API</b>
          <p className="muted">
            Lets scripts and apps on this computer read and write your notes over HTTP. Only this computer can reach it, and every call needs your key.
          </p>
        </div>
        <button className={`switch ${settings.enabled ? "on" : ""}`} role="switch" aria-checked={settings.enabled} onClick={() => update({ enabled: !settings.enabled })}>
          <span />
        </button>
      </div>
      {state.kind === "error" && <p className="error">{state.message}</p>}
      {state.kind === "on" && <p className="api-live">Listening on {base}</p>}
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
      </div>
      {settings.enabled && (
        <details className="api-examples">
          <summary>Try it with curl</summary>
          {examples.map((ex) => (
            <div key={ex} className="api-example">
              <code>{ex}</code>
              <CopyButton text={ex} />
            </div>
          ))}
          <p className="muted small">
            Endpoints: GET /v1/notes · GET, PUT, DELETE /v1/notes/&lt;path&gt; · POST /v1/notes/&lt;path&gt;/append · GET /v1/search?q= · GET /v1/backlinks/&lt;path&gt; · GET /v1/graph · GET /v1/health
          </p>
        </details>
      )}
    </div>
  );
}

export function SettingsPanel(props: {
  theme: ThemeSettings;
  updates: ReturnType<typeof useUpdates>;
  localApi: ReturnType<typeof useLocalApi>;
  onChange(t: ThemeSettings): void;
  onClose(): void;
}) {
  const u = props.updates;
  const t = props.theme;
  const set = (patch: Partial<ThemeSettings>) => props.onChange({ ...t, ...patch });
  return (
    <Modal onClose={props.onClose} wide>
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
              {u.state.kind === "installing" && `Downloading ${u.state.info.latest}… Noodle will close, update and reopen by itself.`}
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
