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

/** Where the confirmation email sends people after they click it. */
const CONFIRMED_PAGE = "https://abhaysingh1122.github.io/noodle/confirmed.html";

/** Connect a Supabase project, sign in with email, and link this vault to it. */
function AccountSection({ cloud, root }: { cloud: CloudSync; root: string | null }) {
  const [url, setUrl] = useState(cloud.config?.url ?? "");
  const [anonKey, setAnonKey] = useState(cloud.config?.anonKey ?? "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  // Set when the email exists but hasn't been confirmed, so we can offer a fresh link.
  const [unconfirmed, setUnconfirmed] = useState(false);
  const vaultName = root?.split(/[\\/]/).filter(Boolean).pop();

  const run = async (work: () => Promise<string | void>) => {
    setBusy(true);
    setMessage(null);
    try {
      const done = await work();
      if (done) setMessage({ error: false, text: done });
    } catch (e) {
      setMessage({ error: true, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  if (!cloud.client) {
    return (
      <div className="api-box">
        <div className="api-head">
          <div>
            <b>
              <Cloud size={16} /> Noodle Cloud
            </b>
            <p className="muted">
              Sync your notes between your computer and phone with an email login. Noodle uses your own free Supabase project: create one at supabase.com, run
              the <code>supabase/schema.sql</code> file from Noodle's repository in its SQL editor, then paste the project's URL and anon public key here.
            </p>
          </div>
        </div>
        <div className="account-form">
          <input placeholder="Project URL, like https://abcd.supabase.co" value={url} onChange={(e) => setUrl(e.target.value)} />
          <input placeholder="anon public key" value={anonKey} onChange={(e) => setAnonKey(e.target.value)} />
          <button
            className="primary"
            disabled={!/^https:\/\/.+/.test(url.trim()) || anonKey.trim().length < 20}
            onClick={() => cloud.setConfig({ url: url.trim(), anonKey: anonKey.trim(), vault: null })}
          >
            Connect
          </button>
        </div>
      </div>
    );
  }

  if (!cloud.session) {
    return (
      <div className="api-box">
        <b>
          <Cloud size={16} /> Sign in to Noodle Cloud
        </b>
        <form
          className="account-form"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              const { error } = await cloud.client!.auth.signInWithPassword({ email, password });
              if (error && /not confirmed/i.test(error.message)) {
                setUnconfirmed(true);
                throw new Error("This email isn't confirmed yet. Tap \"Send a new link\" and open it on any device.");
              }
              if (error) throw new Error(/invalid login/i.test(error.message) ? "That email and password don't match." : error.message);
            });
          }}
        >
          <input type="email" autoComplete="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input type="password" autoComplete="current-password" placeholder="Password (8+ characters)" value={password} onChange={(e) => setPassword(e.target.value)} />
          <div className="prompt-buttons">
            <button
              type="button"
              className="ghost"
              disabled={busy || !email || password.length < 8}
              onClick={() =>
                run(async () => {
                  const { data, error } = await cloud.client!.auth.signUp({ email, password, options: { emailRedirectTo: CONFIRMED_PAGE } });
                  if (error) throw new Error(/already registered/i.test(error.message) ? "You already have an account. Just press Sign in." : error.message);
                  // An address that's already taken comes back as a user with no identities, and no email goes out.
                  if (data.user && data.user.identities?.length === 0) {
                    setUnconfirmed(true);
                    return "You already have an account with this email. Press Sign in. If it was never confirmed, tap \"Send a new link\".";
                  }
                  if (!data.session) {
                    setUnconfirmed(true);
                    return "Almost there! We sent a confirmation link to your inbox. Open it, then press Sign in here.";
                  }
                })
              }
            >
              Create account
            </button>
            <button type="submit" className="primary" disabled={busy || !email || !password}>
              Sign in
            </button>
          </div>
        </form>
        {message && <p className={message.error ? "error" : "api-live"}>{message.text}</p>}
        {unconfirmed && (
          <button
            className="ghost small-btn"
            disabled={busy || !email}
            onClick={() =>
              run(async () => {
                const { error } = await cloud.client!.auth.resend({ type: "signup", email, options: { emailRedirectTo: CONFIRMED_PAGE } });
                if (error) throw new Error(/rate|seconds/i.test(error.message) ? "Too many emails just now. Wait a minute and try again." : error.message);
                return `A new link is on its way to ${email}. Check spam too.`;
              })
            }
          >
            Send a new link
          </button>
        )}
        <button className="ghost small-btn" onClick={() => cloud.setConfig(null)}>
          Use a different Supabase project
        </button>
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
            {cloud.linked
              ? status.kind === "syncing"
                ? "Syncing…"
                : status.kind === "error"
                  ? ""
                  : status.kind === "idle" && status.at
                    ? `“${vaultName}” is synced. Last sync ${status.at.toLocaleTimeString()}.`
                    : `“${vaultName}” syncs with the cloud.`
              : cloud.config?.vault
                ? "Another vault is the synced one. Link this one instead to sync it."
                : "Pick which vault to keep in the cloud."}
          </p>
        </div>
      </div>
      {status.kind === "error" && <p className="error">{status.message}</p>}
      <div className="prompt-buttons account-actions">
        <button className="ghost small-btn" onClick={() => cloud.client!.auth.signOut()}>
          <LogOut size={14} /> Sign out
        </button>
        {cloud.linked ? (
          <button className="primary" disabled={status.kind === "syncing"} onClick={() => cloud.syncNow()}>
            <RefreshCw size={15} className={status.kind === "syncing" ? "spin" : ""} /> Sync now
          </button>
        ) : (
          root && (
            <button className="primary" onClick={() => cloud.setConfig({ ...cloud.config!, vault: root })}>
              <Cloud size={15} /> Sync “{vaultName}”
            </button>
          )
        )}
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
