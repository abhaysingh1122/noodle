import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { baseExtensions } from "./extensions";
import { splitFrontmatter, joinFrontmatter, readField, setField } from "../lib/frontmatter";

function roundTrip(md: string): string {
  const editor = new Editor({ extensions: baseExtensions(), content: md });
  const out = (editor.storage as unknown as { markdown: { getMarkdown(): string } }).markdown.getMarkdown();
  editor.destroy();
  return out;
}

describe("markdown round trip", () => {
  it.each([
    "# Title\n\nSome **bold** and *italic* text.",
    "See [[Note]] and [[Folder/Other#Heading|alias]] and ![[Image.png]].",
    "- one\n- two\n  - nested",
    "1. first\n2. second",
    "- [ ] todo\n- [x] done",
    "> [!tip] Remember\n> Callouts survive the trip.",
    "> [!warning]\n> No title here.",
    "> A plain quote",
    "```js\nconst x = [[1]];\n```",
    "A [regular link](https://example.com).",
  ])("keeps %j", (md) => {
    expect(roundTrip(md)).toBe(md);
  });

  it("parses wikilinks into nodes", () => {
    const editor = new Editor({ extensions: baseExtensions(), content: "Go to [[Home|start]]" });
    const json = JSON.stringify(editor.getJSON());
    expect(json).toContain('"type":"wikiLink"');
    expect(json).toContain('"alias":"start"');
    editor.destroy();
  });
});

describe("frontmatter", () => {
  it("splits and joins without changing the file", () => {
    const text = "---\nicon: 🍜\ncover: banner.png\n---\n\n# Hi\n";
    const parts = splitFrontmatter(text);
    expect(parts.body).toBe("# Hi\n");
    expect(readField(parts.frontmatter, "icon")).toBe("🍜");
    expect(joinFrontmatter(parts)).toBe(text);
  });

  it("leaves notes without frontmatter alone", () => {
    expect(splitFrontmatter("# Hi").frontmatter).toBe("");
    expect(joinFrontmatter({ frontmatter: "", body: "# Hi" })).toBe("# Hi");
  });
});

describe("setField", () => {
  it("adds, replaces and removes fields", () => {
    const fm = setField("", "icon", "🍜");
    expect(fm).toBe("---\nicon: 🍜\n---\n");
    const fm2 = setField(fm, "cover", "garden");
    expect(fm2).toBe("---\nicon: 🍜\ncover: garden\n---\n");
    expect(setField(fm2, "icon", "🌱")).toBe("---\nicon: 🌱\ncover: garden\n---\n");
    expect(setField(fm, "icon", null)).toBe("");
  });
});
