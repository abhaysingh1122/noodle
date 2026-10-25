//! A small local HTTP API, so scripts and other apps on this computer can
//! read and write notes (curl, automations, your own tools).
//!
//! It is off until switched on in Settings, listens on 127.0.0.1 (or, if
//! asked, on the Wi-Fi network too), and every request except `/v1/health`
//! needs `Authorization: Bearer <key>`.
//!
//! `/mcp` speaks the Model Context Protocol (JSON-RPC over HTTP), so AI
//! assistants can use the vault as a set of tools.

use crate::vault::Vault;
use serde::Serialize;
use std::io::Read;
use std::sync::Arc;
use tiny_http::{Header, Method, Request, Response, Server};

/// A running server; dropping it doesn't stop it, `stop` does.
pub struct ApiServer {
    server: Arc<Server>,
    pub port: u16,
}

impl ApiServer {
    pub fn stop(&self) {
        self.server.unblock();
    }
}

/// What the handlers need from the app: run a closure against the open vault.
pub trait VaultAccess: Send + Sync + 'static {
    fn with_vault<T>(&self, f: impl FnOnce(&mut Vault) -> Result<T, String>) -> Result<T, String>;
    fn version(&self) -> String;
}

/// Max size of a note body sent to the API.
const MAX_BODY: u64 = 20 * 1024 * 1024;

/// `lan` also accepts connections from other devices on the same network.
pub fn start<A: VaultAccess>(access: A, port: u16, key: String, lan: bool) -> Result<ApiServer, String> {
    if key.trim().len() < 16 {
        return Err("The API key is too short".into());
    }
    let host = if lan { "0.0.0.0" } else { "127.0.0.1" };
    let server = Arc::new(Server::http((host, port)).map_err(|e| format!("Couldn't start the API on port {port}: {e}"))?);
    let worker = server.clone();
    let access = Arc::new(access);
    std::thread::spawn(move || {
        for request in worker.incoming_requests() {
            let access = access.clone();
            let key = key.clone();
            // One thread per request keeps a slow client from blocking others.
            std::thread::spawn(move || handle(&*access, &key, request));
        }
    });
    Ok(ApiServer { server, port })
}

#[derive(Serialize)]
struct ErrorBody<'a> {
    error: &'a str,
}

fn header(name: &str, value: &str) -> Header {
    Header::from_bytes(name.as_bytes(), value.as_bytes()).expect("valid header")
}

fn with_common(mut r: Response<std::io::Cursor<Vec<u8>>>) -> Response<std::io::Cursor<Vec<u8>>> {
    r.add_header(header("Access-Control-Allow-Origin", "*"));
    r.add_header(header("Access-Control-Allow-Headers", "Authorization, Content-Type"));
    r.add_header(header("Access-Control-Allow-Methods", "GET, PUT, POST, DELETE, OPTIONS"));
    r
}

fn json<T: Serialize>(status: u16, body: &T) -> Response<std::io::Cursor<Vec<u8>>> {
    let bytes = serde_json::to_vec_pretty(body).unwrap_or_default();
    with_common(Response::from_data(bytes).with_status_code(status).with_header(header("Content-Type", "application/json; charset=utf-8")))
}

fn error(status: u16, msg: &str) -> Response<std::io::Cursor<Vec<u8>>> {
    json(status, &ErrorBody { error: msg })
}

fn text(status: u16, body: String, content_type: &str) -> Response<std::io::Cursor<Vec<u8>>> {
    with_common(Response::from_data(body.into_bytes()).with_status_code(status).with_header(header("Content-Type", content_type)))
}

/// Decodes `%20`-style escapes; `+` stays a plus (paths), see `query_param` for queries.
pub fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Some(b) = s.get(i + 1..i + 3).and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn query_param(query: &str, name: &str) -> Option<String> {
    query.split('&').find_map(|pair| {
        let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
        (k == name).then(|| percent_decode(&v.replace('+', " ")))
    })
}

/// Notes are addressed by vault path; `.md` is optional in URLs.
fn note_path(raw: &str) -> String {
    let p = percent_decode(raw).trim_matches('/').to_string();
    if p.to_lowercase().ends_with(".md") {
        p
    } else {
        format!("{p}.md")
    }
}

fn authorized(request: &Request, key: &str) -> bool {
    request
        .headers()
        .iter()
        .find(|h| h.field.equiv("Authorization"))
        .map(|h| h.value.as_str().trim())
        .and_then(|v| v.strip_prefix("Bearer "))
        .is_some_and(|given| constant_time_eq(given.trim().as_bytes(), key.as_bytes()))
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn read_body(request: &mut Request) -> Result<String, String> {
    let mut body = String::new();
    request
        .as_reader()
        .take(MAX_BODY)
        .read_to_string(&mut body)
        .map_err(|_| "The body must be UTF-8 text".to_string())?;
    Ok(body)
}

#[derive(Serialize)]
struct Health {
    app: &'static str,
    version: String,
    vault_open: bool,
}

#[derive(Serialize)]
struct Saved {
    path: String,
}

fn handle<A: VaultAccess>(access: &A, key: &str, mut request: Request) {
    let url = request.url().to_string();
    let (path, query) = url.split_once('?').unwrap_or((&url, ""));
    let method = request.method().clone();

    let response = if method == Method::Options {
        with_common(Response::from_data(Vec::new()).with_status_code(204))
    } else if path == "/v1/health" || path == "/" {
        json(200, &Health { app: "Noodle", version: access.version(), vault_open: access.with_vault(|_| Ok(())).is_ok() })
    } else if !authorized(&request, key) {
        error(401, "Missing or wrong API key. Send: Authorization: Bearer <key>")
    } else {
        route(access, &method, path, query, &mut request).unwrap_or_else(|(status, msg)| error(status, &msg))
    };
    let _ = request.respond(response);
}

type Routed = Result<Response<std::io::Cursor<Vec<u8>>>, (u16, String)>;

fn route<A: VaultAccess>(access: &A, method: &Method, path: &str, query: &str, request: &mut Request) -> Routed {
    let fail = |status: u16| move |e: String| (status, e);
    match (method, path) {
        (Method::Get, "/v1/notes") => {
            let entries = access.with_vault(|v| Ok(v.entries())).map_err(fail(503))?;
            Ok(json(200, &entries))
        }
        (Method::Get, "/v1/search") => {
            let q = query_param(query, "q").ok_or((400, "Add ?q=words to search for".to_string()))?;
            let hits = access.with_vault(|v| Ok(v.search(&q, 200))).map_err(fail(503))?;
            Ok(json(200, &hits))
        }
        (Method::Get, "/v1/graph") => Ok(json(200, &access.with_vault(|v| Ok(v.graph())).map_err(fail(503))?)),
        (Method::Post, "/mcp") => {
            let body = read_body(request).map_err(fail(400))?;
            Ok(match mcp::handle(access, &body) {
                Some(reply) => json(200, &reply),
                // Notifications get no answer.
                None => with_common(Response::from_data(Vec::new()).with_status_code(202)),
            })
        }
        (_, "/mcp") => Err((405, "The MCP endpoint takes JSON-RPC messages by POST".into())),
        (Method::Get, p) if p.starts_with("/v1/backlinks/") => {
            let rel = note_path(&p["/v1/backlinks/".len()..]);
            Ok(json(200, &access.with_vault(|v| Ok(v.backlinks(&rel))).map_err(fail(503))?))
        }
        (_, p) if p.starts_with("/v1/notes/") => {
            let rest = &p["/v1/notes/".len()..];
            let (rest, append) = match rest.strip_suffix("/append") {
                Some(r) => (r, true),
                None => (rest, false),
            };
            let rel = note_path(rest);
            match (method, append) {
                (Method::Get, false) => {
                    let content = access.with_vault(|v| v.read(&rel)).map_err(|_| (404, format!("No note at {rel}")))?;
                    Ok(text(200, content, "text/markdown; charset=utf-8"))
                }
                (Method::Put, false) => {
                    let body = read_body(request).map_err(fail(400))?;
                    access.with_vault(|v| v.write(&rel, &body)).map_err(fail(400))?;
                    Ok(json(200, &Saved { path: rel }))
                }
                (Method::Post, true) => {
                    let body = read_body(request).map_err(fail(400))?;
                    access
                        .with_vault(|v| {
                            let current = v.read(&rel).unwrap_or_default();
                            let sep = if current.is_empty() || current.ends_with('\n') { "" } else { "\n" };
                            v.write(&rel, &format!("{current}{sep}{body}"))
                        })
                        .map_err(fail(400))?;
                    Ok(json(200, &Saved { path: rel }))
                }
                (Method::Delete, false) => {
                    access.with_vault(|v| v.trash(&rel)).map_err(fail(404))?;
                    Ok(json(200, &Saved { path: rel }))
                }
                _ => Err((405, "Use GET, PUT or DELETE on /v1/notes/<path>, or POST on /v1/notes/<path>/append".into())),
            }
        }
        _ => Err((404, "Unknown endpoint. Try GET /v1/notes".into())),
    }
}

/// The Model Context Protocol endpoint: the vault as tools for AI assistants.
mod mcp {
    use super::{note_path, VaultAccess};
    use serde_json::{json, Value};

    const PROTOCOL: &str = "2025-03-26";

    fn tools() -> Value {
        let path = json!({ "type": "string", "description": "Note path inside the vault, like \"Ideas/Plan\" (.md optional)" });
        json!([
            { "name": "list_notes", "description": "List every note and folder in the Noodle vault.", "inputSchema": { "type": "object", "properties": {} } },
            { "name": "read_note", "description": "Read a note's Markdown.", "inputSchema": { "type": "object", "properties": { "path": path }, "required": ["path"] } },
            { "name": "write_note", "description": "Create a note, or replace its whole Markdown.", "inputSchema": { "type": "object", "properties": { "path": path, "content": { "type": "string" } }, "required": ["path", "content"] } },
            { "name": "append_to_note", "description": "Add Markdown to the end of a note (creates it if missing).", "inputSchema": { "type": "object", "properties": { "path": path, "text": { "type": "string" } }, "required": ["path", "text"] } },
            { "name": "search_notes", "description": "Full-text search across the vault.", "inputSchema": { "type": "object", "properties": { "query": { "type": "string" } }, "required": ["query"] } },
            { "name": "get_backlinks", "description": "Notes that link to this note with [[strands]].", "inputSchema": { "type": "object", "properties": { "path": path }, "required": ["path"] } }
        ])
    }

    fn arg<'a>(args: &'a Value, name: &str) -> Result<&'a str, String> {
        args.get(name).and_then(Value::as_str).ok_or_else(|| format!("Missing \"{name}\""))
    }

    fn pretty<T: serde::Serialize>(v: &T) -> String {
        serde_json::to_string_pretty(v).unwrap_or_default()
    }

    fn call<A: VaultAccess>(access: &A, name: &str, args: &Value) -> Result<String, String> {
        match name {
            "list_notes" => access.with_vault(|v| Ok(pretty(&v.entries()))),
            "read_note" => {
                let rel = note_path(arg(args, "path")?);
                access.with_vault(|v| v.read(&rel)).map_err(|_| format!("No note at {rel}"))
            }
            "write_note" => {
                let rel = note_path(arg(args, "path")?);
                let content = arg(args, "content")?;
                access.with_vault(|v| v.write(&rel, content))?;
                Ok(format!("Saved {rel}"))
            }
            "append_to_note" => {
                let rel = note_path(arg(args, "path")?);
                let text = arg(args, "text")?;
                access.with_vault(|v| {
                    let current = v.read(&rel).unwrap_or_default();
                    let sep = if current.is_empty() || current.ends_with('\n') { "" } else { "\n" };
                    v.write(&rel, &format!("{current}{sep}{text}"))
                })?;
                Ok(format!("Added to {rel}"))
            }
            "search_notes" => {
                let q = arg(args, "query")?;
                access.with_vault(|v| Ok(pretty(&v.search(q, 50))))
            }
            "get_backlinks" => {
                let rel = note_path(arg(args, "path")?);
                access.with_vault(|v| Ok(pretty(&v.backlinks(&rel))))
            }
            _ => Err(format!("Unknown tool {name}")),
        }
    }

    /// Answers one JSON-RPC message; `None` for notifications.
    pub fn handle<A: VaultAccess>(access: &A, body: &str) -> Option<Value> {
        let msg: Value = match serde_json::from_str(body) {
            Ok(v) => v,
            Err(e) => return Some(json!({ "jsonrpc": "2.0", "id": null, "error": { "code": -32700, "message": format!("Not JSON: {e}") } })),
        };
        let id = msg.get("id").cloned()?;
        let method = msg.get("method").and_then(Value::as_str).unwrap_or("");
        let params = msg.get("params").cloned().unwrap_or(Value::Null);
        let result = match method {
            "initialize" => Ok(json!({
                "protocolVersion": params.get("protocolVersion").and_then(Value::as_str).unwrap_or(PROTOCOL),
                "capabilities": { "tools": {} },
                "serverInfo": { "name": "noodle", "version": access.version() },
                "instructions": "Tools for the user's Noodle notes vault: plain Markdown files where [[Note name]] links notes together."
            })),
            "ping" => Ok(json!({})),
            "tools/list" => Ok(json!({ "tools": tools() })),
            "tools/call" => {
                let name = params.get("name").and_then(Value::as_str).unwrap_or("");
                let args = params.get("arguments").cloned().unwrap_or(json!({}));
                Ok(match call(access, name, &args) {
                    Ok(text) => json!({ "content": [{ "type": "text", "text": text }] }),
                    Err(e) => json!({ "content": [{ "type": "text", "text": e }], "isError": true }),
                })
            }
            _ => Err(json!({ "code": -32601, "message": format!("Unknown method {method}") })),
        };
        Some(match result {
            Ok(r) => json!({ "jsonrpc": "2.0", "id": id, "result": r }),
            Err(e) => json!({ "jsonrpc": "2.0", "id": id, "error": e }),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    struct TestAccess(Mutex<Option<Vault>>);

    impl VaultAccess for TestAccess {
        fn with_vault<T>(&self, f: impl FnOnce(&mut Vault) -> Result<T, String>) -> Result<T, String> {
            let mut guard = self.0.lock().unwrap();
            f(guard.as_mut().ok_or("No vault is open in Noodle")?)
        }
        fn version(&self) -> String {
            "test".into()
        }
    }

    #[test]
    fn decodes_paths_and_queries() {
        assert_eq!(percent_decode("My%20notes/Caf%C3%A9"), "My notes/Café");
        assert_eq!(note_path("Ideas/Big%20plan"), "Ideas/Big plan.md");
        assert_eq!(note_path("a.md"), "a.md");
        assert_eq!(query_param("q=hello+world&x=1", "q").as_deref(), Some("hello world"));
        assert_eq!(query_param("x=1", "q"), None);
    }

    #[test]
    fn compares_keys_exactly() {
        assert!(constant_time_eq(b"abc", b"abc"));
        assert!(!constant_time_eq(b"abc", b"abd"));
        assert!(!constant_time_eq(b"abc", b"abcd"));
    }

    #[test]
    fn serves_notes_over_http() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("Hello.md"), "Hi [[World]]").unwrap();
        let access = TestAccess(Mutex::new(Some(Vault::open(dir.path()).unwrap())));
        let key = "k".repeat(32);
        let port = 27999;
        let server = start(access, port, key.clone(), false).unwrap();
        let base = format!("http://127.0.0.1:{port}");
        let auth = format!("Bearer {key}");

        let health: String = ureq::get(&format!("{base}/v1/health")).call().unwrap().body_mut().read_to_string().unwrap();
        assert!(health.contains("\"vault_open\": true"));

        assert_eq!(ureq::get(&format!("{base}/v1/notes")).call().map(|_| ()).unwrap_err().to_string(), "http status: 401");

        let note = ureq::get(&format!("{base}/v1/notes/Hello")).header("Authorization", &auth).call().unwrap().body_mut().read_to_string().unwrap();
        assert_eq!(note, "Hi [[World]]");

        ureq::put(&format!("{base}/v1/notes/World")).header("Authorization", &auth).send("Back to [[Hello]]").unwrap();
        ureq::post(&format!("{base}/v1/notes/World/append")).header("Authorization", &auth).send("- more").unwrap();
        assert_eq!(std::fs::read_to_string(dir.path().join("World.md")).unwrap(), "Back to [[Hello]]\n- more");

        let back = ureq::get(&format!("{base}/v1/backlinks/World")).header("Authorization", &auth).call().unwrap().body_mut().read_to_string().unwrap();
        assert!(back.contains("Hello.md"));

        let mcp = |body: &str| ureq::post(&format!("{base}/mcp")).header("Authorization", &auth).send(body).unwrap().body_mut().read_to_string().unwrap();
        assert!(mcp(r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}"#).contains("2025-06-18"));
        assert!(mcp(r#"{"jsonrpc":"2.0","id":2,"method":"tools/list"}"#).contains("append_to_note"));
        let read = mcp(r#"{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"read_note","arguments":{"path":"World"}}}"#);
        assert!(read.contains("Back to [[Hello]]"), "{read}");
        mcp(r#"{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"append_to_note","arguments":{"path":"World","text":"- from mcp"}}}"#);
        assert!(std::fs::read_to_string(dir.path().join("World.md")).unwrap().ends_with("- from mcp"));
        server.stop();
    }
}
