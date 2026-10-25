import { createClient, type RealtimeChannel, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type SyncItem } from "./api";

/**
 * Cloud sync through Noodle Cloud (a Supabase project shared by every account).
 *
 * Each account has vaults; every device keeps a full copy of a vault as plain
 * files. The cloud keeps one row per note/folder/attachment (attachments'
 * bytes live in Storage, named by their hash). A sync compares three hash
 * lists: this device now, the cloud now, and both as they were after the last
 * sync (the "base"). Whatever changed on only one side is copied to the other;
 * if a note changed on both, the cloud's version is kept next to ours as a
 * conflict copy.
 */

/** Noodle Cloud. The publishable key is meant to ship in apps; the database's rules keep each account's data private. */
export const NOODLE_CLOUD = {
  url: "https://rvkpswyezcmkdtrixcrp.supabase.co",
  anonKey: "sb_publishable_H3Fq2GLzvRvxf_k4IQ2aBg_2xscrHsD",
};

/** Where the confirmation email sends people after they click it. */
export const CONFIRMED_PAGE = "https://abhaysingh1122.github.io/noodle/confirmed.html";

export interface CloudVault {
  id: string;
  name: string;
  updated_at: string;
}

interface RemoteRow {
  path: string;
  kind: SyncItem["kind"];
  hash: string;
  deleted: boolean;
  device: string | null;
}

export interface SyncResult {
  /** Local paths that changed because of the cloud. */
  changed: string[];
  pushed: number;
  conflicts: string[];
}

/** Which cloud vault each vault folder on this device syncs with. */
const LINKS_KEY = "noodle.cloudLinks";
/** Vault folders whose "keep it in the cloud?" question was answered with "not now". */
const DECLINED_KEY = "noodle.cloudDeclined";
/** Set when someone chose to use Noodle without an account. */
const SKIPPED_KEY = "noodle.cloudSkipped";
const DEVICE_KEY = "noodle.device";
const BUCKET = "attachments";
const CHUNK = 200;

export function readJson<T>(key: string, fallback: T): T {
  try {
    return (JSON.parse(localStorage.getItem(key) ?? "null") as T) ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: sync still works, it just compares more next time.
  }
}

export function deviceId(): string {
  let id = readJson<string | null>(DEVICE_KEY, null);
  if (!id) {
    id = `${navigator.userAgent.includes("Android") ? "phone" : "pc"}-${Math.random().toString(36).slice(2, 10)}`;
    writeJson(DEVICE_KEY, id);
  }
  return id;
}

let cached: SupabaseClient | null = null;
export function cloudClient(): SupabaseClient {
  cached ??= createClient(NOODLE_CLOUD.url, NOODLE_CLOUD.anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
  return cached;
}

export type CloudLinks = Record<string, { id: string; name: string }>;
export const readLinks = () => readJson<CloudLinks>(LINKS_KEY, {});

/** The account's vaults in the cloud, most recently changed first. */
export async function listCloudVaults(client: SupabaseClient): Promise<CloudVault[]> {
  const { data, error } = await client.from("vaults").select("id, name, updated_at").order("updated_at", { ascending: false });
  if (error) throw describe(error.message);
  return data as CloudVault[];
}

export async function createCloudVault(client: SupabaseClient, name: string): Promise<CloudVault> {
  const { data, error } = await client.from("vaults").insert({ name }).select("id, name, updated_at").single();
  if (error) throw describe(error.message);
  return data as CloudVault;
}

const baseKey = (uid: string, vaultId: string, root: string) => `noodle.syncBase:${uid}:${vaultId}:${root}`;
const depth = (p: string) => p.split("/").length;

function conflictName(path: string): string {
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ").replace(":", "-");
  return path.replace(/(\.md)?$/i, ` (conflict ${stamp}).md`);
}

async function fetchRemote(client: SupabaseClient, vaultId: string): Promise<Map<string, RemoteRow>> {
  const rows = new Map<string, RemoteRow>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client.from("notes").select("path, kind, hash, deleted, device").eq("vault_id", vaultId).order("path").range(from, from + 999);
    if (error) throw describe(error.message);
    for (const r of data as RemoteRow[]) rows.set(r.path, r);
    if (data.length < 1000) return rows;
  }
}

function describe(message: string): Error {
  if (/relation .*(notes|vaults).* does not exist|Could not find the table/i.test(message)) {
    return new Error("Noodle Cloud isn't set up yet: run supabase/schema.sql in the Supabase SQL editor once.");
  }
  return new Error(message);
}

/** One full sync of the open vault folder (`root`) with a cloud vault. */
export async function syncOnce(client: SupabaseClient, vaultId: string, root: string): Promise<SyncResult> {
  const { data: auth } = await client.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) throw new Error("Sign in to sync");
  const device = deviceId();

  const local = new Map((await api.syncSnapshot()).map((i) => [i.path, i]));
  const remoteRows = await fetchRemote(client, vaultId);
  const remote = new Map([...remoteRows].filter(([, r]) => !r.deleted));
  const base = new Map(Object.entries(readJson<Record<string, string>>(baseKey(uid, vaultId, root), {})));

  const result: SyncResult = { changed: [], pushed: 0, conflicts: [] };
  const toPush: string[] = [];
  const toPull: string[] = [];
  const toDeleteRemote: string[] = [];
  const toDeleteLocal: string[] = [];

  for (const path of new Set([...local.keys(), ...remote.keys(), ...base.keys()])) {
    const L = local.get(path)?.hash;
    const R = remote.get(path)?.hash;
    const B = base.get(path);
    if (L === R) {
      if (L === undefined) base.delete(path);
      else base.set(path, L);
      continue;
    }
    const localChanged = L !== B;
    const remoteChanged = R !== B;
    if (localChanged && !remoteChanged) (L === undefined ? toDeleteRemote : toPush).push(path);
    else if (remoteChanged && !localChanged) (R === undefined ? toDeleteLocal : toPull).push(path);
    else if (L === undefined) toPull.push(path); // deleted here, edited there: keep the edit
    else if (R === undefined) toPush.push(path); // edited here, deleted there: keep the edit
    else if (local.get(path)!.kind === "note" && remote.get(path)!.kind === "note") {
      // Edited on both: keep ours under the real name, theirs as a conflict copy.
      const copy = conflictName(path);
      const { data, error } = await client.from("notes").select("content").eq("vault_id", vaultId).eq("path", path).single();
      if (error) throw describe(error.message);
      await api.writeNote(copy, (data as { content: string }).content);
      result.changed.push(copy);
      result.conflicts.push(copy);
      toPush.push(path, copy);
      local.set(copy, { path: copy, kind: "note", hash: "" });
    } else toPush.push(path);
  }

  // Download, parents before children.
  toPull.sort((a, b) => depth(a) - depth(b));
  for (let i = 0; i < toPull.length; i += CHUNK) {
    const chunk = toPull.slice(i, i + CHUNK);
    const notes = chunk.filter((p) => remote.get(p)!.kind === "note");
    const contents = new Map<string, string>();
    if (notes.length) {
      const { data, error } = await client.from("notes").select("path, content").eq("vault_id", vaultId).in("path", notes);
      if (error) throw describe(error.message);
      for (const r of data as { path: string; content: string }[]) contents.set(r.path, r.content);
    }
    for (const path of chunk) {
      const row = remote.get(path)!;
      if (row.kind === "folder") await api.createFolder(path);
      else if (row.kind === "note") await api.writeNote(path, contents.get(path) ?? "");
      else {
        const { data, error } = await client.storage.from(BUCKET).download(`${uid}/${vaultId}/${row.hash}`);
        if (error) throw new Error(`Couldn't download ${path}: ${error.message}`);
        await api.writeBytes(path, new Uint8Array(await data.arrayBuffer()));
      }
      base.set(path, row.hash);
      result.changed.push(path);
    }
  }

  // Deletions that came from the cloud, children before parents.
  toDeleteLocal.sort((a, b) => depth(b) - depth(a));
  for (const path of toDeleteLocal) {
    const item = local.get(path);
    // A folder only goes if everything in it went too (anything new in it here is kept).
    const keepsChildren = item?.kind === "folder" && [...local.keys()].some((p) => p.startsWith(path + "/") && !toDeleteLocal.includes(p));
    if (item && !keepsChildren) {
      await api.trashEntry(path).catch(() => {});
      result.changed.push(path);
    }
    base.delete(path);
  }

  // Upload.
  if (toPush.length) {
    const fresh = new Map((await api.syncSnapshot()).map((i) => [i.path, i]));
    for (let i = 0; i < toPush.length; i += CHUNK) {
      const rows = [];
      for (const path of toPush.slice(i, i + CHUNK)) {
        const item = fresh.get(path);
        if (!item) continue;
        let content = "";
        if (item.kind === "note") content = await api.readNote(path);
        if (item.kind === "file") {
          const bytes = await api.readBytes(path);
          const { error } = await client.storage.from(BUCKET).upload(`${uid}/${vaultId}/${item.hash}`, bytes, { upsert: true, contentType: "application/octet-stream" });
          if (error && !/exists/i.test(error.message)) throw new Error(`Couldn't upload ${path}: ${error.message}`);
        }
        rows.push({ vault_id: vaultId, path, kind: item.kind, hash: item.hash, content, deleted: false, device });
        base.set(path, item.hash);
      }
      if (rows.length) {
        const { error } = await client.from("notes").upsert(rows, { onConflict: "vault_id,path" });
        if (error) throw describe(error.message);
        result.pushed += rows.length;
      }
    }
  }
  for (let i = 0; i < toDeleteRemote.length; i += CHUNK) {
    const rows = toDeleteRemote.slice(i, i + CHUNK).map((path) => ({ vault_id: vaultId, path, kind: remote.get(path)?.kind ?? "note", hash: "", content: "", deleted: true, device }));
    const { error } = await client.from("notes").upsert(rows, { onConflict: "vault_id,path" });
    if (error) throw describe(error.message);
    rows.forEach((r) => base.delete(r.path));
    result.pushed += rows.length;
  }

  writeJson(baseKey(uid, vaultId, root), Object.fromEntries(base));
  return result;
}

export type SyncStatus =
  | { kind: "signed-out" }
  | { kind: "idle"; at: Date | null }
  | { kind: "syncing" }
  | { kind: "error"; message: string };

/**
 * The account, and keeping the open vault in sync while signed in: on open,
 * after local saves, when another device changes something, and every minute
 * as a fallback. Changes made while offline (or with the computer off) are
 * picked up by the next sync, because it compares against the last one.
 */
export function useCloudSync(root: string | null, onRemoteChanges: (paths: string[]) => void) {
  const client = cloudClient();
  const [session, setSession] = useState<Session | null>(null);
  // False until the saved sign-in has been looked up, so the sign-in screen doesn't flash.
  const [ready, setReady] = useState(false);
  const [skipped, setSkippedState] = useState(() => readJson<boolean>(SKIPPED_KEY, false));
  const [links, setLinks] = useState<CloudLinks>(readLinks);
  const [declined, setDeclined] = useState<string[]>(() => readJson<string[]>(DECLINED_KEY, []));
  const [vaults, setVaults] = useState<CloudVault[] | null>(null);
  const [status, setStatus] = useState<SyncStatus>({ kind: "signed-out" });
  const running = useRef(false);
  const again = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const onChangesRef = useRef(onRemoteChanges);
  onChangesRef.current = onRemoteChanges;

  const link = root ? links[root] : undefined;
  const linked = !!(session && link);

  useEffect(() => {
    client.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data } = client.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, [client]);

  const setSkipped = useCallback((v: boolean) => {
    writeJson(SKIPPED_KEY, v);
    setSkippedState(v);
  }, []);

  const refreshVaults = useCallback(async () => {
    if (!session) return setVaults(null);
    try {
      setVaults(await listCloudVaults(client));
    } catch (e) {
      setStatus({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, [client, session]);

  useEffect(() => {
    refreshVaults();
  }, [refreshVaults]);

  /** Syncs a vault folder on this device with a cloud vault from now on. */
  const linkFolder = useCallback((folder: string, vault: { id: string; name: string } | null) => {
    setLinks((prev) => {
      const next = { ...prev };
      if (vault) next[folder] = { id: vault.id, name: vault.name };
      else delete next[folder];
      writeJson(LINKS_KEY, next);
      return next;
    });
  }, []);

  /** Puts a vault folder in the cloud: joins the cloud vault with the same name, or makes one. */
  const keepInCloud = useCallback(
    async (folder: string, name: string) => {
      const existing = (await listCloudVaults(client)).find((v) => v.name === name && !Object.values(readLinks()).some((l) => l.id === v.id));
      linkFolder(folder, existing ?? (await createCloudVault(client, name)));
      refreshVaults();
    },
    [client, linkFolder, refreshVaults],
  );

  const decline = useCallback((folder: string) => {
    setDeclined((prev) => {
      const next = [...new Set([...prev, folder])];
      writeJson(DECLINED_KEY, next);
      return next;
    });
  }, []);

  const signOut = useCallback(async () => {
    await client.auth.signOut();
    setVaults(null);
  }, [client]);

  const syncNow = useCallback(async () => {
    if (!root || !link || !session) return;
    if (running.current) {
      again.current = true;
      return;
    }
    running.current = true;
    setStatus({ kind: "syncing" });
    try {
      do {
        again.current = false;
        const result = await syncOnce(client, link.id, root);
        if (result.changed.length) onChangesRef.current(result.changed);
      } while (again.current);
      setStatus({ kind: "idle", at: new Date() });
    } catch (e) {
      setStatus({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    } finally {
      running.current = false;
    }
  }, [client, root, link, session]);

  /** Asks for a sync soon, merging bursts of changes into one. */
  const requestSync = useCallback(
    (delay = 2000) => {
      clearTimeout(timer.current);
      timer.current = setTimeout(syncNow, delay);
    },
    [syncNow],
  );

  useEffect(() => {
    if (!session) return setStatus({ kind: "signed-out" });
    if (!link) return setStatus({ kind: "idle", at: null });
    syncNow();
    const every = setInterval(syncNow, 60_000);
    // Another device changed something: pull it in.
    const me = deviceId();
    const channel: RealtimeChannel = client
      .channel(`notes-${link.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "notes", filter: `vault_id=eq.${link.id}` }, (payload) => {
        const row = payload.new as Partial<RemoteRow> | undefined;
        if (row?.device !== me) requestSync(800);
      })
      .subscribe();
    // Coming back to the app (phones pause it in the background): catch up.
    const onVisible = () => document.visibilityState === "visible" && requestSync(300);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(every);
      clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", onVisible);
      client.removeChannel(channel);
    };
  }, [client, session, link, syncNow, requestSync]);

  return {
    client,
    session,
    ready,
    skipped,
    setSkipped,
    status,
    link,
    linked,
    links,
    linkFolder,
    keepInCloud,
    declined: root ? declined.includes(root) : false,
    decline,
    vaults,
    refreshVaults,
    signOut,
    syncNow,
    requestSync,
  };
}

export type CloudSync = ReturnType<typeof useCloudSync>;
