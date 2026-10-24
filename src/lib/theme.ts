/**
 * Noodle's colours live in CSS variables so the whole UI can be re-themed.
 * The default is pastel green + pastel yellow; people can pick another
 * palette or their own accent colour in Settings.
 */
export type Mode = "system" | "light" | "dark";

export interface Palette {
  id: string;
  name: string;
  light: Record<string, string>;
  dark: Record<string, string>;
}

const base = {
  light: { "--bg": "#FFFEF7", "--surface": "#FFFFFF", "--text": "#2E3326", "--muted": "#7A8270", "--border": "#E6EBDC" },
  dark: { "--bg": "#1B1F17", "--surface": "#23281E", "--text": "#E9ECDF", "--muted": "#9BA38E", "--border": "#343B2C" },
};

export const PALETTES: Palette[] = [
  {
    id: "garden",
    name: "Pastel garden",
    light: { ...base.light, "--sidebar": "#EEF6E7", "--accent": "#7DB46C", "--accent-soft": "#DDEFD4", "--accent-text": "#4C7F3C", "--yellow": "#FFF3B0", "--yellow-strong": "#F4D66C" },
    dark: { ...base.dark, "--sidebar": "#20261B", "--accent": "#A6D497", "--accent-soft": "#2F3D29", "--accent-text": "#B9E0AC", "--yellow": "#4A4421", "--yellow-strong": "#E6D07A" },
  },
  {
    id: "olive",
    name: "Olive grove",
    light: { ...base.light, "--sidebar": "#F1F2E4", "--accent": "#808B3E", "--accent-soft": "#E6E9CC", "--accent-text": "#5E6A22", "--yellow": "#FBF1C4", "--yellow-strong": "#E5CF6A" },
    dark: { ...base.dark, "--sidebar": "#23251A", "--accent": "#B6C26A", "--accent-soft": "#363A22", "--accent-text": "#C8D27E", "--yellow": "#4A4421", "--yellow-strong": "#E6D07A" },
  },
  {
    id: "butter",
    name: "Butter",
    light: { ...base.light, "--sidebar": "#FFF8DC", "--accent": "#D9B23F", "--accent-soft": "#FCEFC0", "--accent-text": "#8A6A0E", "--yellow": "#FFF3B0", "--yellow-strong": "#F4D66C" },
    dark: { ...base.dark, "--sidebar": "#28251A", "--accent": "#E6C866", "--accent-soft": "#3F3820", "--accent-text": "#F0D98A", "--yellow": "#4A4421", "--yellow-strong": "#E6D07A" },
  },
  {
    id: "mint",
    name: "Mint & honey",
    light: { ...base.light, "--sidebar": "#E8F7F0", "--accent": "#5FBF9A", "--accent-soft": "#D3F0E3", "--accent-text": "#2F8A67", "--yellow": "#FFEFC2", "--yellow-strong": "#F2C35B" },
    dark: { ...base.dark, "--sidebar": "#1C2621", "--accent": "#86D6B4", "--accent-soft": "#25392F", "--accent-text": "#9FE2C5", "--yellow": "#4A4021", "--yellow-strong": "#E8C46A" },
  },
];

export interface ThemeSettings {
  palette: string;
  mode: Mode;
  customAccent: string | null;
}

const KEY = "noodle.theme";
export const DEFAULT_THEME: ThemeSettings = { palette: "garden", mode: "system", customAccent: null };

export function loadTheme(): ThemeSettings {
  try {
    return { ...DEFAULT_THEME, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return DEFAULT_THEME;
  }
}

export function saveTheme(t: ThemeSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(t));
  } catch {
    // Storage can be unavailable (private mode); the theme just won't persist.
  }
}

export function isDark(mode: Mode): boolean {
  if (mode === "system") return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  return mode === "dark";
}

export function applyTheme(t: ThemeSettings) {
  const palette = PALETTES.find((p) => p.id === t.palette) ?? PALETTES[0];
  const dark = isDark(t.mode);
  const vars = { ...(dark ? palette.dark : palette.light) };
  if (t.customAccent) {
    vars["--accent"] = t.customAccent;
    vars["--accent-text"] = t.customAccent;
    vars["--accent-soft"] = `color-mix(in srgb, ${t.customAccent} 22%, ${vars["--bg"]})`;
  }
  const root = document.documentElement;
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.dataset.theme = dark ? "dark" : "light";
}
