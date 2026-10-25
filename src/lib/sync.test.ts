import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// Each simulated device is an in-memory vault; `current` is the one the api talks to.
type Fs = { notes: Map<string, string>; folders: Set<string> };
let current: Fs;
// The engine only compares hashes, so any stand-in that changes with the text works.
const sha = (s: string) => `h:${s}`;

vi.mock("./api", () => ({
  api: {
    syncSnapshot: async () => [
      ...[...current.notes].map(([path, text]) => ({ path, kind: "note", hash: sha(text) })),
      ...[...current.folders].map((path) => ({ path, kind: "folder", hash: "" })),
    ],
    readNote: async (p: string) => current.notes.get(p) ?? "",
    writeNote: async (p: string, c: string) => void current.notes.set(p, c),
    createFolder: async (p: string) => void current.folders.add(p),
    trashEntry: async (p: string) => {
      current.notes.delete(p);
      current.folders.delete(p);
    },
    readBytes: async () => new Uint8Array(),
    writeBytes: async () => {},
  },
}));

const { syncOnce } = await import("./sync");

type Row = { vault_id: string; path: string; kind: string; hash: string; content: string; deleted: boolean; device: string | null };

/** Just enough of the Supabase client for the sync engine: filters, ranges and upserts on one table. */
function fakeCloud() {
  const rows = new Map<string, Row>();
  const key = (r: Pick<Row, "vault_id" | "path">) => `${r.vault_id}|${r.path}`;
  const pick = (r: Row, cols: string) => Object.fromEntries(cols.split(",").map((c) => [c.trim(), r[c.trim() as keyof Row]]));
  const query = (cols: string) => {
    let list = [...rows.values()].sort((a, b) => a.path.localeCompare(b.path));
    const q = {
      eq: (c: string, v: string) => ((list = list.filter((r) => r[c as keyof Row] === v)), q),
      in: (c: string, vs: string[]) => ((list = list.filter((r) => vs.includes(r[c as keyof Row] as string))), q),
      order: () => q,
      range: async (a: number, b: number) => ({ data: list.slice(a, b + 1).map((r) => pick(r, cols)), error: null }),
      single: async () => ({ data: pick(list[0], cols), error: null }),
      then: (resolve: (v: unknown) => void) => resolve({ data: list.map((r) => pick(r, cols)), error: null }),
    };
    return q;
  };
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    storage: { from: () => ({ upload: async () => ({ error: null }), download: async () => ({ data: new Blob([]), error: null }) }) },
    from: () => ({
      select: query,
      upsert: async (list: Row[]) => {
        list.forEach((r) => rows.set(key(r), { ...r }));
        return { error: null };
      },
    }),
  };
  const get = (path: string, vault = "V") => rows.get(`${vault}|${path}`);
  return { rows, get, client: client as unknown as SupabaseClient };
}

const device = (notes: Record<string, string> = {}, folders: string[] = []): Fs => ({ notes: new Map(Object.entries(notes)), folders: new Set(folders) });

describe("cloud sync", () => {
  beforeEach(() => localStorage.clear());

  it("copies notes and folders from one device to another", async () => {
    const cloud = fakeCloud();
    const pc = device({ "A.md": "hello", "Sub/B.md": "bee" }, ["Sub"]);
    const phone = device();
    current = pc;
    await syncOnce(cloud.client, "V", "pc-vault");
    current = phone;
    const r = await syncOnce(cloud.client, "V", "phone-vault");
    expect(Object.fromEntries(phone.notes)).toEqual({ "A.md": "hello", "Sub/B.md": "bee" });
    expect([...phone.folders]).toEqual(["Sub"]);
    expect(r.changed.sort()).toEqual(["A.md", "Sub", "Sub/B.md"]);
  });

  it("sends edits and deletions both ways", async () => {
    const cloud = fakeCloud();
    const pc = device({ "A.md": "one", "B.md": "bee" });
    const phone = device();
    current = pc;
    await syncOnce(cloud.client, "V", "v");
    current = phone;
    await syncOnce(cloud.client, "V", "v2");

    phone.notes.set("A.md", "two");
    phone.notes.delete("B.md");
    await syncOnce(cloud.client, "V", "v2");
    current = pc;
    await syncOnce(cloud.client, "V", "v");
    expect(Object.fromEntries(pc.notes)).toEqual({ "A.md": "two" });
    expect(cloud.get("B.md")!.deleted).toBe(true);
  });

  it("keeps both versions when a note changed on two devices", async () => {
    const cloud = fakeCloud();
    const pc = device({ "A.md": "base" });
    const phone = device();
    current = pc;
    await syncOnce(cloud.client, "V", "v");
    current = phone;
    await syncOnce(cloud.client, "V", "v2");

    phone.notes.set("A.md", "from phone");
    await syncOnce(cloud.client, "V", "v2");
    current = pc;
    pc.notes.set("A.md", "from pc");
    const r = await syncOnce(cloud.client, "V", "v");
    expect(pc.notes.get("A.md")).toBe("from pc");
    expect(r.conflicts).toHaveLength(1);
    expect(pc.notes.get(r.conflicts[0])).toBe("from phone");
    expect(cloud.get("A.md")!.content).toBe("from pc");
  });

  it("keeps vaults apart", async () => {
    const cloud = fakeCloud();
    current = device({ "Work.md": "work" });
    await syncOnce(cloud.client, "W", "work");
    current = device({ "Home.md": "home" });
    await syncOnce(cloud.client, "H", "home");
    const phone = device();
    current = phone;
    await syncOnce(cloud.client, "H", "phone-home");
    expect(Object.fromEntries(phone.notes)).toEqual({ "Home.md": "home" });
  });

  it("does nothing when nothing changed", async () => {
    const cloud = fakeCloud();
    current = device({ "A.md": "same" });
    await syncOnce(cloud.client, "V", "v");
    const r = await syncOnce(cloud.client, "V", "v");
    expect(r).toEqual({ changed: [], pushed: 0, conflicts: [] });
  });
});
