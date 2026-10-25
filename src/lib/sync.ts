import { createClient, type RealtimeChannel, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type SyncItem } from "./api";

/**
 * Cloud sync through the user's own Supabase project.
 *
 * Every device keeps a full copy of the vault as plain files. The cloud keeps
 * one row per note/folder/attachment (attachments' bytes live in Storage,
 * named by their hash). A sync compares three hash lists: this device now,
 * the cloud now, and both as they were after the last sync (the "base").
 * Whatever changed on only one side is copied to the other; if a note
 * changed on both, the cloud's version is kept next to ours as a conflict copy.
 */

export interface CloudConfig {
  url: string;
  anonKey: string;
  /** The vault folder (on this device) that is linked to the cloud. */
  vault: string | null;
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

const CONFIG_KEY = "noodle.cloud";
const DEVICE_KEY = "noodle.device";
const BUCKET = "attachments";
const CHUNK = 200;

function readJson<T>(key: string, fallback: T): T {
  try {
    return (JSON.parse(localStorage.getItem(key) ?? "null") as T) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
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

let cached: { key: string; client: SupabaseClient } | null = null;
export function cloudClient(config: Pick<CloudConfig, "url" | "anonKey">): SupabaseClient {
  const key = `${config.url}|${config.anonKey}`;
  if (cached?.key !== key) {
    cached = { key, client: createClient(config.url.trim().replace(/\/+$/, ""), config.anonKey.trim(), { auth: { persistSession: true, autoRefreshToken: true } }) };
  }
  return cached.client;
}

const baseKey = (uid: string, vault: string) => `noodle.syncBase:${uid}:${vault}`;
const depth = (p: string) => p.split("/").length;

function conflictName(path: string): string {
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ").replace(":", "-");
  return path.replace(/(\.md)?$/i, ` (conflict ${stamp}).md`);
}

async function fetchRemote(client: SupabaseClient): Promise<Map<string, RemoteRow>> {
  const rows = new Map<string, RemoteRow>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client.from("notes").select("path, kind, hash, deleted, device").order("path").range(from, from + 999);
    if (error) throw describe(error.message);
    for (const r of data as RemoteRow[]) rows.set(r.path, r);
    if (data.length < 1000) return rows;
  }
}

function describe(message: string): Error {
  if (/relation .*notes.* does not exist|Could not find the table/i.test(message)) {
    return new Error("Your cloud isn't set up yet: run supabase/schema.sql in the Supabase SQL editor once.");
  }
  return new Error(message);
}

/** One full sync of the linked vault. */
export async function syncOnce(client: SupabaseClient, vault: string): Promise<SyncResult> {
  const { data: auth } = await client.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) throw new Error("Sign in to sync");
  const device = deviceId();

  const local = new Map((await api.syncSnapshot()).map((i) => [i.path, i]));
  const remoteRows = await fetchRemote(client);
  const remote = new Map([...remoteRows].filter(([, r]) => !r.deleted));
  const base = new Map(Object.entries(readJson<Record<string, string>>(baseKey(uid, vault), {})));

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
      const { data, error } = await client.from("notes").select("content").eq("path", path).single();
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
      const { data, error } = await client.from("notes").select("path, content").in("path", notes);
      if (error) throw describe(error.message);
      for (const r of data as { path: string; content: string }[]) contents.set(r.path, r.content);
    }
    for (const path of chunk) {
      const row = remote.get(path)!;
      if (row.kind === "folder") await api.createFolder(path);
      else if (row.kind === "note") await api.writeNote(path, contents.get(path) ?? "");
      else {
        const { data, error } = await client.storage.from(BUCKET).download(`${uid}/${row.hash}`);
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
          const { error } = await client.storage.from(BUCKET).upload(`${uid}/${item.hash}`, bytes, { upsert: true, contentType: "application/octet-stream" });
          if (error && !/exists/i.test(error.message)) throw new Error(`Couldn't upload ${path}: ${error.message}`);
        }
        rows.push({ path, kind: item.kind, hash: item.hash, content, deleted: false, device });
        base.set(path, item.hash);
      }
      if (rows.length) {
        const { error } = await client.from("notes").upsert(rows, { onConflict: "user_id,path" });
        if (error) throw describe(error.message);
        result.pushed += rows.length;
      }
    }
  }
  for (let i = 0; i < toDeleteRemote.length; i += CHUNK) {
    const rows = toDeleteRemote.slice(i, i + CHUNK).map((path) => ({ path, kind: remote.get(path)?.kind ?? "note", hash: "", content: "", deleted: true, device }));
    const { error } = await client.from("notes").upsert(rows, { onConflict: "user_id,path" });
    if (error) throw describe(error.message);
    rows.forEach((r) => base.delete(r.path));
    result.pushed += rows.length;
  }

  writeJson(baseKey(uid, vault), Object.fromEntries(base));
  return result;
}

export type SyncStatus =
  | { kind: "off" }
  | { kind: "signed-out" }
  | { kind: "idle"; at: Date | null }
  | { kind: "syncing" }
  | { kind: "error"; message: string };

/**
 * Keeps the open vault in sync while signed in: on open, after local saves,
 * when another device changes something, and every minute as a fallback.
 */
export function useCloudSync(root: string | null, onRemoteChanges: (paths: string[]) => void) {
  const [config, setConfigState] = useState<CloudConfig | null>(() => readJson<CloudConfig | null>(CONFIG_KEY, null));
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<SyncStatus>({ kind: "off" });
  const running = useRef(false);
  const again = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const onChangesRef = useRef(onRemoteChanges);
  onChangesRef.current = onRemoteChanges;

  const setConfig = useCallback((c: CloudConfig | null) => {
    writeJson(CONFIG_KEY, c);
    setConfigState(c);
  }, []);

  const client = config?.url && config.anonKey ? cloudClient(config) : null;
  const linked = !!(client && session && root && config?.vault === root);

  useEffect(() => {
    if (!client) {
      setSession(null);
      return;
    }
    client.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = client.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, [client]);

  const syncNow = useCallback(async () => {
    if (!client || !root || !linked) return;
    if (running.current) {
      again.current = true;
      return;
    }
    running.current = true;
    setStatus({ kind: "syncing" });
    try {
      do {
        again.current = false;
        const result = await syncOnce(client, root);
        if (result.changed.length) onChangesRef.current(result.changed);
      } while (again.current);
      setStatus({ kind: "idle", at: new Date() });
    } catch (e) {
      setStatus({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    } finally {
      running.current = false;
    }
  }, [client, root, linked]);

  /** Asks for a sync soon, merging bursts of changes into one. */
  const requestSync = useCallback(
    (delay = 2000) => {
      clearTimeout(timer.current);
      timer.current = setTimeout(syncNow, delay);
    },
    [syncNow],
  );

  useEffect(() => {
    if (!client) return setStatus({ kind: "off" });
    if (!session) return setStatus({ kind: "signed-out" });
    if (!linked) return setStatus({ kind: "idle", at: null });
    syncNow();
    const every = setInterval(syncNow, 60_000);
    // Another device changed something: pull it in.
    const me = deviceId();
    const channel: RealtimeChannel = client
      .channel(`notes-${session.user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "notes", filter: `user_id=eq.${session.user.id}` }, (payload) => {
        const row = payload.new as Partial<RemoteRow> | undefined;
        if (row?.device !== me) requestSync(800);
      })
      .subscribe();
    return () => {
      clearInterval(every);
      clearTimeout(timer.current);
      client.removeChannel(channel);
    };
  }, [client, session, linked, syncNow, requestSync]);

  return { config, setConfig, client, session, status, linked, syncNow, requestSync };
}

export type CloudSync = ReturnType<typeof useCloudSync>;
