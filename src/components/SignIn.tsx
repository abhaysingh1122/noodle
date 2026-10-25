import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ArrowLeft, Cloud, Mail } from "lucide-react";
import { CONFIRMED_PAGE } from "../lib/sync";
import { Logo } from "./Logo";

type Mode = "signin" | "verify" | "forgot" | "reset";

/** Codes from the emails are 6 to 10 digits; people sometimes paste them with spaces. */
const cleanCode = (s: string) => s.replace(/\D/g, "");

function friendly(message: string): string {
  if (/invalid login/i.test(message)) return "That email and password don't match.";
  if (/expired|invalid.*(otp|token)|token.*(expired|invalid)/i.test(message)) return "That code didn't work. It may have expired, so ask for a new one.";
  if (/rate|seconds|too many/i.test(message)) return "Too many emails just now. Wait a minute and try again.";
  if (/at least|weak|short/i.test(message)) return "Pick a longer password (8 characters or more).";
  return message;
}

/** Email + password sign-in and sign-up for Noodle Cloud, with codes for confirming and resetting. */
export function SignInForm({ client }: { client: SupabaseClient }) {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const address = email.trim();

  const run = async (work: () => Promise<string | void>) => {
    setBusy(true);
    setMessage(null);
    try {
      const done = await work();
      if (done) setMessage({ error: false, text: done });
    } catch (e) {
      setMessage({ error: true, text: friendly(e instanceof Error ? e.message : String(e)) });
    } finally {
      setBusy(false);
    }
  };

  const go = (next: Mode, text?: string) => {
    setMode(next);
    setCode("");
    setMessage(text ? { error: false, text } : null);
  };

  const back = (
    <button type="button" className="ghost small-btn back-btn" onClick={() => go("signin")}>
      <ArrowLeft size={14} /> Back to sign in
    </button>
  );

  const feedback = message && <p className={message.error ? "error" : "api-live"}>{message.text}</p>;

  if (mode === "verify") {
    return (
      <>
        <form
          className="account-form"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              const { error } = await client.auth.verifyOtp({ email: address, token: cleanCode(code), type: "signup" });
              if (error) throw error;
            });
          }}
        >
          <p className="form-note">
            We sent a code to <b>{address}</b>. Type it here, or tap the button in the email.
          </p>
          <input className="code-input" inputMode="numeric" autoComplete="one-time-code" placeholder="Code from the email" value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
          <div className="prompt-buttons">
            <button
              type="button"
              className="ghost"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const { error } = await client.auth.resend({ type: "signup", email: address, options: { emailRedirectTo: CONFIRMED_PAGE } });
                  if (error) throw error;
                  return `A new code is on its way to ${address}. Check spam too.`;
                })
              }
            >
              <Mail size={14} /> Send a new code
            </button>
            <button type="submit" className="primary" disabled={busy || cleanCode(code).length < 6}>
              Confirm
            </button>
          </div>
        </form>
        {feedback}
        {back}
      </>
    );
  }

  if (mode === "forgot") {
    return (
      <>
        <form
          className="account-form"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              const { error } = await client.auth.resetPasswordForEmail(address);
              if (error) throw error;
              go("reset", `If ${address} has a Noodle account, a code is on its way. Check spam too.`);
            });
          }}
        >
          <p className="form-note">Forgot your password? We'll email you a code to set a new one.</p>
          <input type="email" autoComplete="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          <div className="prompt-buttons">
            <button type="submit" className="primary" disabled={busy || !address}>
              Email me a code
            </button>
          </div>
        </form>
        {feedback}
        {back}
      </>
    );
  }

  if (mode === "reset") {
    return (
      <>
        <form
          className="account-form"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              // The code signs you in for a moment, which is what allows the new password.
              const { error } = await client.auth.verifyOtp({ email: address, token: cleanCode(code), type: "recovery" });
              if (error) throw error;
              const { error: pwError } = await client.auth.updateUser({ password });
              if (pwError) throw pwError;
            });
          }}
        >
          <input className="code-input" inputMode="numeric" autoComplete="one-time-code" placeholder="Code from the email" value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
          <input type="password" autoComplete="new-password" placeholder="New password (8+ characters)" value={password} onChange={(e) => setPassword(e.target.value)} />
          <div className="prompt-buttons">
            <button type="button" className="ghost" disabled={busy} onClick={() => go("forgot")}>
              Send a new code
            </button>
            <button type="submit" className="primary" disabled={busy || cleanCode(code).length < 6 || password.length < 8}>
              Save new password
            </button>
          </div>
        </form>
        {feedback}
        {back}
      </>
    );
  }

  return (
    <>
      <form
        className="account-form"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            const { error } = await client.auth.signInWithPassword({ email: address, password });
            if (error && /not confirmed/i.test(error.message)) {
              await client.auth.resend({ type: "signup", email: address, options: { emailRedirectTo: CONFIRMED_PAGE } }).catch(() => {});
              go("verify", "This email isn't confirmed yet, so we sent a fresh code.");
              return;
            }
            if (error) throw error;
          });
        }}
      >
        <input type="email" autoComplete="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input type="password" autoComplete="current-password" placeholder="Password (8+ characters)" value={password} onChange={(e) => setPassword(e.target.value)} />
        <div className="prompt-buttons">
          <button
            type="button"
            className="ghost"
            disabled={busy || !address || password.length < 8}
            onClick={() =>
              run(async () => {
                const { data, error } = await client.auth.signUp({ email: address, password, options: { emailRedirectTo: CONFIRMED_PAGE } });
                if (error) throw new Error(/already registered/i.test(error.message) ? "You already have an account. Just press Sign in." : error.message);
                // An address that's already taken comes back as a user with no identities, and no email goes out.
                if (data.user && data.user.identities?.length === 0) return "You already have an account with this email. Press Sign in, or use Forgot password.";
                if (!data.session) go("verify");
              })
            }
          >
            Create account
          </button>
          <button type="submit" className="primary" disabled={busy || !address || !password}>
            Sign in
          </button>
        </div>
      </form>
      {feedback}
      <button type="button" className="link-btn forgot" onClick={() => go("forgot")}>
        Forgot password?
      </button>
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
