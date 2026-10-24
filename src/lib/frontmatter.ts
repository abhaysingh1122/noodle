/**
 * Notes may start with a YAML frontmatter block. The editor only edits the
 * body, so the frontmatter is split off on load and put back on save,
 * byte for byte.
 */
export interface SplitNote {
  frontmatter: string; // including the --- fences and trailing newline, or ""
  body: string;
}

const FM_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

export function splitFrontmatter(text: string): SplitNote {
  const m = text.match(FM_RE);
  if (!m) return { frontmatter: "", body: text };
  return { frontmatter: m[0], body: text.slice(m[0].length).replace(/^\r?\n/, "") };
}

export function joinFrontmatter({ frontmatter, body }: SplitNote): string {
  if (!frontmatter) return body;
  const fm = frontmatter.endsWith("\n") ? frontmatter : frontmatter + "\n";
  return `${fm}\n${body}`;
}

/** Reads simple `key: value` pairs, enough for page icon and cover. */
export function readField(frontmatter: string, key: string): string | null {
  const m = frontmatter.match(new RegExp(`^${key}:\\s*(.+?)\\s*$`, "m"));
  return m ? m[1].replace(/^["']|["']$/g, "") : null;
}

/** Sets (or with `null`, removes) a top-level `key: value` line. */
export function setField(frontmatter: string, key: string, value: string | null): string {
  const lines = frontmatter ? frontmatter.replace(/\r?\n$/, "").split(/\r?\n/).slice(1, -1) : [];
  const idx = lines.findIndex((l) => l.startsWith(`${key}:`));
  if (value === null) {
    if (idx >= 0) lines.splice(idx, 1);
  } else if (idx >= 0) {
    lines[idx] = `${key}: ${value}`;
  } else {
    lines.push(`${key}: ${value}`);
  }
  return lines.length ? `---\n${lines.join("\n")}\n---\n` : "";
}
