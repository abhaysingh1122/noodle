import type { Mode, ThemeSettings } from "../lib/theme";
import { PALETTES } from "../lib/theme";
import { Modal } from "./Modal";
import { Logo } from "./Logo";

export function SettingsPanel(props: { theme: ThemeSettings; onChange(t: ThemeSettings): void; onClose(): void }) {
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
      </div>
    </Modal>
  );
}
