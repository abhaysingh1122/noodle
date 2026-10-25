import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Cloud, Mail } from "lucide-react";
import { CONFIRMED_PAGE } from "../lib/sync";
import { Logo } from "./Logo";

/** Email + password sign-in and sign-up for Noodle Cloud. */
export function SignInForm({ client }: { client: SupabaseClient }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  // Set when the email exists but hasn't been confirmed, so we can offer a fresh link.
  const [unconfirmed, setUnconfirmed] = useState(false);

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

  return (
    <>
      <form
        className="account-form"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            const { error } = await client.auth.signInWithPassword({ email: email.trim(), password });
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
                const { data, error } = await client.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: CONFIRMED_PAGE } });
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
              const { error } = await client.auth.resend({ type: "signup", email: email.trim(), options: { emailRedirectTo: CONFIRMED_PAGE } });
              if (error) throw new Error(/rate|seconds/i.test(error.message) ? "Too many emails just now. Wait a minute and try again." : error.message);
              return `A new link is on its way to ${email.trim()}. Check spam too.`;
            })
          }
        >
          <Mail size={14} /> Send a new link
        </button>
      )}
    </>
  );
}

/** The first thing people see: sign in so every device shares the same vaults, or carry on without an account. */
export function SignInScreen({ client, onSkip }: { client: SupabaseClient; onSkip(): void }) {
  return (
    <div className="welcome">
      <div className="welcome-card signin-card">
        <Logo size={80} />
        <h1>Hello there!</h1>
        <p className="tagline">
          Sign in to keep your vaults on <Cloud size={15} className="inline-icon" /> Noodle Cloud, so your phone and computers all share them.
        </p>
        <SignInForm client={client} />
        <button className="ghost skip" onClick={onSkip}>
          Skip, keep my notes on this device only
        </button>
      </div>
    </div>
  );
}
