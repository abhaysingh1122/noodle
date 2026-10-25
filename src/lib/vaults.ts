/** Every vault folder opened on this device, newest first, for the vault list. */

export interface VaultEntry {
  path: string;
  name: string;
  openedAt: number;
}

const KEY = "noodle.vaultHistory";
/** Older versions only remembered the last vault. */
const LEGACY_KEY = "noodle.lastVault";

export const folderName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

export function readHistory(): VaultEntry[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? "null") as VaultEntry[] | null;
    if (list) return list;
    const last = localStorage.getItem(LEGACY_KEY);
    return last ? [{ path: last, name: folderName(last), openedAt: Date.now() }] : [];
  } catch {
    return [];
  }
}

function save(list: VaultEntry[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Not remembering it is fine.
  }
}

export function rememberVault(path: string): VaultEntry[] {
  const list = [{ path, name: folderName(path), openedAt: Date.now() }, ...readHistory().filter((v) => v.path !== path)].slice(0, 30);
  save(list);
  return list;
}

export function forgetVault(path: string): VaultEntry[] {
  const list = readHistory().filter((v) => v.path !== path);
  save(list);
  return list;
}
