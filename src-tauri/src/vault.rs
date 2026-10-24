//! The vault: a plain folder of Markdown notes, plus an in-memory index of
//! the `[[wikilinks]]` between them. Everything here is pure file-system
//! logic so it can be unit tested without a window.

use regex::Regex;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::OnceLock;
use std::time::UNIX_EPOCH;
use walkdir::WalkDir;

/// Folders that are never shown or indexed, besides hidden (dot) folders
/// such as `.git`, `.trash` and app settings folders.
const IGNORED_DIRS: &[&str] = &["node_modules"];

/// Where uploaded images (emoji badges, banners, pasted pictures) are kept.
pub const ATTACHMENTS_DIR: &str = "attachments";

fn is_ignored_dir(name: &str) -> bool {
    name.starts_with('.') || IGNORED_DIRS.contains(&name)
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    /// Path relative to the vault root, always with `/` separators.
    pub path: String,
    pub kind: EntryKind,
    pub mtime: u64,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum EntryKind {
    File,
    Folder,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Backlink {
    pub source: String,
    pub line: usize,
    pub context: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub path: String,
    pub line: usize,
    pub snippet: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Graph {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<(String, String)>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GraphNode {
    pub id: String,
    /// False for links that point at a note which does not exist yet.
    pub exists: bool,
}

#[derive(Debug, Clone, PartialEq)]
struct Link {
    target: String,
    line: usize,
    context: String,
}

pub struct Vault {
    root: PathBuf,
    /// Outgoing links per note, as written (not yet resolved).
    links: HashMap<String, Vec<Link>>,
}

pub type Result<T> = std::result::Result<T, String>;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn wikilink_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    // [[target]], [[target#heading]], [[target|alias]], ![[embed]]
    RE.get_or_init(|| Regex::new(r"!?\[\[([^\]\|#\^\n]+)(?:[#\^][^\]\|\n]*)?(?:\|[^\]\n]*)?\]\]").unwrap())
}

/// Extracts `[[wikilink]]` targets, skipping fenced code blocks and inline code.
pub fn extract_links(content: &str) -> Vec<(String, usize, String)> {
    let mut out = Vec::new();
    let mut in_fence = false;
    for (i, line) in content.lines().enumerate() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            continue;
        }
        let without_code = strip_inline_code(line);
        for cap in wikilink_re().captures_iter(&without_code) {
            let target = cap[1].trim().to_string();
            if !target.is_empty() {
                out.push((target, i + 1, line.trim().to_string()));
            }
        }
    }
    out
}

fn strip_inline_code(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut in_code = false;
    for c in line.chars() {
        if c == '`' {
            in_code = !in_code;
            out.push(' ');
        } else if in_code {
            out.push(' ');
        } else {
            out.push(c);
        }
    }
    out
}

fn to_rel(root: &Path, p: &Path) -> Option<String> {
    let rel = p.strip_prefix(root).ok()?;
    let parts: Vec<String> = rel.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect();
    if parts.is_empty() {
        None
    } else {
        Some(parts.join("/"))
    }
}

fn is_ignored(rel: &str) -> bool {
    rel.split('/').any(is_ignored_dir)
}

fn is_note(rel: &str) -> bool {
    rel.to_lowercase().ends_with(".md")
}

fn mtime(p: &Path) -> u64 {
    fs::metadata(p)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// The name `[[links]]` use for a note: its file name without `.md`.
pub fn note_name(rel: &str) -> &str {
    let file = rel.rsplit('/').next().unwrap_or(rel);
    file.strip_suffix(".md").unwrap_or(file)
}

impl Vault {
    pub fn open(root: impl Into<PathBuf>) -> Result<Self> {
        let root = root.into();
        if !root.is_dir() {
            return Err(format!("{} is not a folder", root.display()));
        }
        let root = root.canonicalize().map_err(err)?;
        let mut vault = Vault { root, links: HashMap::new() };
        vault.reindex();
        Ok(vault)
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Turns a vault-relative path into an absolute one, refusing anything
    /// that would escape the vault folder.
    pub fn resolve_path(&self, rel: &str) -> Result<PathBuf> {
        let rel = rel.trim_start_matches('/');
        if rel.is_empty() {
            return Err("empty path".into());
        }
        let p = Path::new(rel);
        for c in p.components() {
            match c {
                Component::Normal(_) => {}
                _ => return Err(format!("invalid path: {rel}")),
            }
        }
        Ok(self.root.join(p))
    }

    pub fn entries(&self) -> Vec<Entry> {
        let mut out: Vec<Entry> = WalkDir::new(&self.root)
            .min_depth(1)
            .into_iter()
            .filter_entry(|e| {
                let name = e.file_name().to_string_lossy();
                !(e.file_type().is_dir() && is_ignored_dir(&name))
            })
            .filter_map(|e| e.ok())
            .filter_map(|e| {
                let rel = to_rel(&self.root, e.path())?;
                if e.file_type().is_dir() {
                    Some(Entry { path: rel, kind: EntryKind::Folder, mtime: 0 })
                } else if is_note(&rel) {
                    Some(Entry { mtime: mtime(e.path()), path: rel, kind: EntryKind::File })
                } else {
                    None
                }
            })
            .collect();
        out.sort_by(|a, b| a.path.to_lowercase().cmp(&b.path.to_lowercase()));
        out
    }

    fn note_paths(&self) -> Vec<String> {
        self.entries().into_iter().filter(|e| e.kind == EntryKind::File).map(|e| e.path).collect()
    }

    pub fn reindex(&mut self) {
        self.links.clear();
        for rel in self.note_paths() {
            self.index_file(&rel);
        }
    }

    /// Re-reads one note into the link index (or drops it if it is gone).
    pub fn index_file(&mut self, rel: &str) {
        if !is_note(rel) || is_ignored(rel) {
            return;
        }
        match self.resolve_path(rel).and_then(|p| fs::read_to_string(p).map_err(err)) {
            Ok(content) => {
                let links = extract_links(&content)
                    .into_iter()
                    .map(|(target, line, context)| Link { target, line, context })
                    .collect();
                self.links.insert(rel.to_string(), links);
            }
            Err(_) => {
                self.links.remove(rel);
            }
        }
    }

    pub fn read(&self, rel: &str) -> Result<String> {
        fs::read_to_string(self.resolve_path(rel)?).map_err(err)
    }

    pub fn write(&mut self, rel: &str, content: &str) -> Result<()> {
        let p = self.resolve_path(rel)?;
        if let Some(parent) = p.parent() {
            fs::create_dir_all(parent).map_err(err)?;
        }
        fs::write(&p, content).map_err(err)?;
        self.index_file(rel);
        Ok(())
    }

    /// Creates a new empty note, picking `Name 1.md`, `Name 2.md`… if taken.
    pub fn create_note(&mut self, rel: &str) -> Result<String> {
        let rel = if is_note(rel) { rel.to_string() } else { format!("{rel}.md") };
        let base = rel.strip_suffix(".md").unwrap().to_string();
        let mut candidate = rel.clone();
        let mut n = 1;
        while self.resolve_path(&candidate)?.exists() {
            candidate = format!("{base} {n}.md");
            n += 1;
        }
        self.write(&candidate, "")?;
        Ok(candidate)
    }

    pub fn create_folder(&self, rel: &str) -> Result<()> {
        fs::create_dir_all(self.resolve_path(rel)?).map_err(err)
    }

    pub fn rename(&mut self, from: &str, to: &str) -> Result<()> {
        let src = self.resolve_path(from)?;
        let dst = self.resolve_path(to)?;
        if dst.exists() {
            return Err(format!("{to} already exists"));
        }
        if let Some(parent) = dst.parent() {
            fs::create_dir_all(parent).map_err(err)?;
        }
        fs::rename(&src, &dst).map_err(err)?;
        self.reindex();
        Ok(())
    }

    /// Moves a note or folder into `.trash/` inside the vault instead of
    /// deleting it, so nothing is lost by a misclick.
    pub fn trash(&mut self, rel: &str) -> Result<()> {
        let src = self.resolve_path(rel)?;
        let trash = self.root.join(".trash");
        fs::create_dir_all(&trash).map_err(err)?;
        let name = src.file_name().ok_or("invalid path")?.to_string_lossy().into_owned();
        let mut dst = trash.join(&name);
        let mut n = 1;
        while dst.exists() {
            dst = trash.join(format!("{n} {name}"));
            n += 1;
        }
        fs::rename(&src, &dst).map_err(err)?;
        self.reindex();
        Ok(())
    }

    /// Saves a file into the vault's `attachments/` folder under a free name
    /// ("photo.png", "photo 1.png"…) and returns its vault path.
    pub fn save_attachment(&self, name: &str, bytes: &[u8]) -> Result<String> {
        let clean: String = name.chars().filter(|c| !r#"\/:*?"<>|"#.contains(*c) && !c.is_control()).collect();
        let clean = clean.trim().trim_start_matches('.');
        let clean = if clean.is_empty() { "image.png" } else { clean };
        let (stem, ext) = match clean.rsplit_once('.') {
            Some((s, e)) if !s.is_empty() => (s.to_string(), format!(".{e}")),
            _ => (clean.to_string(), String::new()),
        };
        let mut rel = format!("{ATTACHMENTS_DIR}/{stem}{ext}");
        let mut n = 1;
        while self.resolve_path(&rel)?.exists() {
            rel = format!("{ATTACHMENTS_DIR}/{stem} {n}{ext}");
            n += 1;
        }
        let p = self.resolve_path(&rel)?;
        fs::create_dir_all(p.parent().ok_or("invalid path")?).map_err(err)?;
        fs::write(&p, bytes).map_err(err)?;
        Ok(rel)
    }

    /// Copies a file from anywhere on the computer into `attachments/`.
    pub fn import_file(&self, source: &Path) -> Result<String> {
        let name = source.file_name().ok_or("not a file")?.to_string_lossy().into_owned();
        let bytes = fs::read(source).map_err(|e| format!("Couldn't read {}: {e}", source.display()))?;
        self.save_attachment(&name, &bytes)
    }

    /// Finds the note a link target points at: an exact vault path first,
    /// then any note with that file name (the shortest path wins).
    pub fn resolve_link(&self, target: &str) -> Option<String> {
        let target = target.trim().trim_end_matches(".md").to_lowercase();
        let mut best: Option<String> = None;
        for rel in self.links.keys() {
            let lower = rel.to_lowercase();
            let without_ext = lower.strip_suffix(".md").unwrap_or(&lower);
            if without_ext == target {
                return Some(rel.clone());
            }
            if note_name(&lower) == target && best.as_ref().map_or(true, |b| rel.len() < b.len()) {
                best = Some(rel.clone());
            }
        }
        best
    }

    pub fn backlinks(&self, rel: &str) -> Vec<Backlink> {
        let mut out: Vec<Backlink> = self
            .links
            .iter()
            .filter(|(source, _)| source.as_str() != rel)
            .flat_map(|(source, links)| {
                links
                    .iter()
                    .filter(|l| self.resolve_link(&l.target).as_deref() == Some(rel))
                    .map(|l| Backlink { source: source.clone(), line: l.line, context: l.context.clone() })
            })
            .collect();
        out.sort_by(|a, b| a.source.cmp(&b.source).then(a.line.cmp(&b.line)));
        out
    }

    /// Case-insensitive search over note names and contents.
    pub fn search(&self, query: &str, limit: usize) -> Vec<SearchHit> {
        let q = query.trim().to_lowercase();
        if q.is_empty() {
            return Vec::new();
        }
        let mut hits = Vec::new();
        let mut paths = self.note_paths();
        paths.sort();
        for rel in paths {
            if note_name(&rel).to_lowercase().contains(&q) {
                hits.push(SearchHit { path: rel.clone(), line: 0, snippet: note_name(&rel).to_string() });
            }
            let Ok(content) = self.read(&rel) else { continue };
            for (i, line) in content.lines().enumerate() {
                if line.to_lowercase().contains(&q) {
                    hits.push(SearchHit { path: rel.clone(), line: i + 1, snippet: snippet(line, &q) });
                }
            }
            if hits.len() >= limit {
                hits.truncate(limit);
                break;
            }
        }
        hits
    }

    pub fn graph(&self) -> Graph {
        let mut nodes: Vec<GraphNode> = self.links.keys().map(|k| GraphNode { id: k.clone(), exists: true }).collect();
        let mut missing = HashSet::new();
        let mut edges = HashSet::new();
        for (source, links) in &self.links {
            for l in links {
                let target = match self.resolve_link(&l.target) {
                    Some(t) => t,
                    None => {
                        missing.insert(l.target.clone());
                        l.target.clone()
                    }
                };
                if &target != source {
                    edges.insert((source.clone(), target));
                }
            }
        }
        nodes.extend(missing.into_iter().map(|id| GraphNode { id, exists: false }));
        nodes.sort_by(|a, b| a.id.cmp(&b.id));
        let mut edges: Vec<_> = edges.into_iter().collect();
        edges.sort();
        Graph { nodes, edges }
    }
}

fn snippet(line: &str, q: &str) -> String {
    let lower = line.to_lowercase();
    let chars: Vec<char> = line.chars().collect();
    // Work in chars so multi-byte text never splits mid-character.
    let start_byte = lower.find(q).unwrap_or(0);
    let start = lower[..start_byte].chars().count();
    let from = start.saturating_sub(40);
    let to = (start + q.chars().count() + 80).min(chars.len());
    let mut s: String = chars[from..to].iter().collect();
    if from > 0 {
        s.insert(0, '…');
    }
    if to < chars.len() {
        s.push('…');
    }
    s.trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vault_with(files: &[(&str, &str)]) -> (tempfile::TempDir, Vault) {
        let dir = tempfile::tempdir().unwrap();
        for (path, content) in files {
            let p = dir.path().join(path);
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            fs::write(p, content).unwrap();
        }
        let v = Vault::open(dir.path()).unwrap();
        (dir, v)
    }

    #[test]
    fn extracts_all_link_forms_and_skips_code() {
        let md = "See [[Alpha]] and [[Beta#Intro|the beta]].\n![[Gamma]]\n`[[Nope]]`\n```\n[[AlsoNope]]\n```\n[[Delta^abc]]";
        let targets: Vec<String> = extract_links(md).into_iter().map(|l| l.0).collect();
        assert_eq!(targets, vec!["Alpha", "Beta", "Gamma", "Delta"]);
    }

    #[test]
    fn lists_notes_and_folders_but_not_hidden_dirs() {
        let (_d, v) = vault_with(&[("a.md", ""), ("sub/b.md", ""), (".config/app.json", "{}"), ("pic.png", "")]);
        let paths: Vec<String> = v.entries().into_iter().map(|e| e.path).collect();
        assert_eq!(paths, vec!["a.md", "sub", "sub/b.md"]);
    }

    #[test]
    fn resolves_links_by_name_and_path() {
        let (_d, v) = vault_with(&[("Home.md", ""), ("deep/nested/Home.md", ""), ("projects/Plan.md", "")]);
        assert_eq!(v.resolve_link("plan").as_deref(), Some("projects/Plan.md"));
        assert_eq!(v.resolve_link("Home").as_deref(), Some("Home.md"));
        assert_eq!(v.resolve_link("deep/nested/Home").as_deref(), Some("deep/nested/Home.md"));
        assert_eq!(v.resolve_link("Missing"), None);
    }

    #[test]
    fn computes_backlinks_with_context() {
        let (_d, v) = vault_with(&[("a.md", "intro\nlinks to [[b]]"), ("b.md", "no links"), ("c.md", "[[B|bee]] too")]);
        let bl = v.backlinks("b.md");
        assert_eq!(bl.len(), 2);
        assert_eq!(bl[0], Backlink { source: "a.md".into(), line: 2, context: "links to [[b]]".into() });
        assert_eq!(bl[1].source, "c.md");
    }

    #[test]
    fn write_updates_index_and_create_picks_free_name() {
        let (_d, mut v) = vault_with(&[("a.md", ""), ("Untitled.md", "")]);
        v.write("a.md", "now links [[Untitled]]").unwrap();
        assert_eq!(v.backlinks("Untitled.md").len(), 1);
        assert_eq!(v.create_note("Untitled").unwrap(), "Untitled 1.md");
    }

    #[test]
    fn refuses_paths_outside_the_vault() {
        let (_d, v) = vault_with(&[]);
        assert!(v.resolve_path("../secret.md").is_err());
        assert!(v.resolve_path("a/../../x.md").is_err());
        assert!(v.resolve_path("ok/note.md").is_ok());
    }

    #[test]
    fn trash_moves_into_hidden_folder() {
        let (d, mut v) = vault_with(&[("a.md", "x")]);
        v.trash("a.md").unwrap();
        assert!(!d.path().join("a.md").exists());
        assert!(d.path().join(".trash/a.md").exists());
        assert!(v.entries().is_empty());
    }

    #[test]
    fn search_matches_names_and_lines() {
        let (_d, v) = vault_with(&[("Recipes.md", "pasta\nnoodle soup"), ("b.md", "Noodles are great")]);
        let hits = v.search("noodle", 10);
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].path, "Recipes.md");
        assert_eq!(hits[0].line, 2);
        assert!(v.search("recipes", 10)[0].line == 0);
    }

    #[test]
    fn attachments_get_free_names_inside_the_vault() {
        let (_dir, v) = vault_with(&[]);
        assert_eq!(v.save_attachment("cat.png", b"1").unwrap(), "attachments/cat.png");
        assert_eq!(v.save_attachment("cat.png", b"2").unwrap(), "attachments/cat 1.png");
        assert_eq!(v.save_attachment("../../evil.png", b"3").unwrap(), "attachments/evil.png");
        assert_eq!(v.read("attachments/cat 1.png").unwrap(), "2");
    }

    #[test]
    fn graph_includes_unresolved_links() {
        let (_d, v) = vault_with(&[("a.md", "[[b]] [[ghost]]"), ("b.md", "")]);
        let g = v.graph();
        assert_eq!(g.edges, vec![("a.md".into(), "b.md".into()), ("a.md".into(), "ghost".into())]);
        assert!(g.nodes.iter().any(|n| n.id == "ghost" && !n.exists));
    }
}
