import { useCallback, useEffect, useState } from "react";
import { api, isDesktop, isMobile, type UpdateInfo } from "./api";

export type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "latest"; info: UpdateInfo }
  | { kind: "available"; info: UpdateInfo }
  | { kind: "installing"; info: UpdateInfo }
  | { kind: "error"; message: string };

/** Checks GitHub for a newer Noodle once at startup, and on demand. */
export function useUpdates() {
  const [state, setState] = useState<UpdateState>({ kind: "idle" });
  const [version, setVersion] = useState<string>("");

  const check = useCallback(async () => {
    setState({ kind: "checking" });
    try {
      const info = await api.checkUpdate();
      setState(info.available ? { kind: "available", info } : { kind: "latest", info });
    } catch (e) {
      setState({ kind: "error", message: String(e) });
    }
  }, []);

  const install = useCallback(async (info: UpdateInfo) => {
    if (!info.installerUrl) {
      setState({ kind: "error", message: "This release has no Windows installer yet." });
      return;
    }
    setState({ kind: "installing", info });
    try {
      await api.installUpdate(info.installerUrl, info.installerSize);
    } catch (e) {
      setState({ kind: "error", message: String(e) });
    }
  }, []);

  useEffect(() => {
    api.appVersion().then(setVersion).catch(() => {});
    // The phone app is updated by installing the new APK from the releases page.
    if (!isDesktop || isMobile) return;
    // Quietly look for an update a few seconds after launch.
    const t = setTimeout(() => {
      api
        .checkUpdate()
        .then((info) => info.available && setState({ kind: "available", info }))
        .catch(() => {});
    }, 4000);
    return () => clearTimeout(t);
  }, []);

  return { state, version, check, install };
}
