import { useCallback, useEffect, useState } from "react";
import { api, isDesktop } from "./api";

const KEY = "noodle.api";
export const DEFAULT_PORT = 27183;

export interface ApiSettings {
  enabled: boolean;
  port: number;
  key: string;
  /** Also reachable from other devices on the same Wi-Fi. */
  lan: boolean;
}

export function newApiKey(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return "noodle_" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function load(): ApiSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<ApiSettings> | null;
    if (saved?.key) return { enabled: !!saved.enabled, port: saved.port ?? DEFAULT_PORT, key: saved.key, lan: !!saved.lan };
  } catch {
    // fall through to fresh settings
  }
  return { enabled: false, port: DEFAULT_PORT, key: newApiKey(), lan: false };
}

export type ApiState = { kind: "off" } | { kind: "on"; port: number } | { kind: "error"; message: string };

/** The local HTTP API's settings, applied to the app whenever they change. */
export function useLocalApi() {
  const [settings, setSettings] = useState<ApiSettings>(load);
  const [state, setState] = useState<ApiState>({ kind: "off" });
  const [ip, setIp] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch {
      // Not remembering is fine; the API just starts off next time.
    }
    if (!isDesktop) {
      setState(settings.enabled ? { kind: "on", port: settings.port } : { kind: "off" });
      return;
    }
    api
      .configureApi(settings.enabled, settings.port, settings.key, settings.lan)
      .then((port) => setState(port ? { kind: "on", port } : { kind: "off" }))
      .catch((e) => setState({ kind: "error", message: String(e) }));
  }, [settings]);

  useEffect(() => {
    if (settings.enabled && settings.lan) api.localIp().then(setIp, () => setIp(null));
  }, [settings.enabled, settings.lan]);

  const update = useCallback((patch: Partial<ApiSettings>) => setSettings((s) => ({ ...s, ...patch })), []);
  return { settings, state, update, ip };
}
