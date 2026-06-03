//! Built-in local HTTP translation proxy for OpenWorkflow "free channels".
//!
//! When the user picks the `claude-code` runtime with a free channel, the
//! `claude` CLI is pointed at `http://127.0.0.1:<port>/ch/<channelId>`
//! (`ANTHROPIC_BASE_URL`). The CLI appends `/v1/messages`, so requests arrive
//! here as `POST /ch/<id>/v1/messages` with an Anthropic Messages JSON body.
//!
//! This proxy holds the real upstream config per channel and either:
//!   - reverse-proxies the request to a native Anthropic endpoint (`transport: "anthropic"`), or
//!   - translates Anthropic <-> OpenAI chat-completions SSE (`transport: "openai"`).
//!
//! Binds 127.0.0.1 ONLY. Uses tiny_http (blocking server) + ureq (upstream).

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tiny_http::{Header, Method, Request, Response, Server};

/// Per-channel upstream config sent from the JS layer.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FreeChannelCfg {
    pub id: String,
    /// "openai" | "anthropic"
    pub transport: String,
    pub base_url: String,
    pub api_key: String,
    pub model: String,
}

/// Returned to JS from `free_proxy_ensure`.
#[derive(Debug, Clone, Serialize)]
pub struct FreeProxyInfo {
    pub port: u16,
}

struct ProxyState {
    port: u16,
}

static SERVER_STATE: OnceLock<Mutex<Option<ProxyState>>> = OnceLock::new();
static REGISTRY: OnceLock<Mutex<HashMap<String, FreeChannelCfg>>> = OnceLock::new();
static MSG_COUNTER: AtomicU64 = AtomicU64::new(1);

fn state_lock() -> &'static Mutex<Option<ProxyState>> {
    SERVER_STATE.get_or_init(|| Mutex::new(None))
}

fn registry() -> &'static Mutex<HashMap<String, FreeChannelCfg>> {
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

fn next_message_id() -> String {
    let n = MSG_COUNTER.fetch_add(1, Ordering::Relaxed);
    let pid = std::process::id();
    format!("msg_{:x}{:x}", pid, n)
}

/// Tauri command: start the proxy if needed, swap the channel registry, return the port.
#[tauri::command]
pub async fn free_proxy_ensure(channels: Vec<FreeChannelCfg>) -> Result<FreeProxyInfo, String> {
    // Swap the registry first (cheap, takes effect immediately).
    {
        let mut reg = registry().lock().map_err(|_| "registry poisoned")?;
        reg.clear();
        for c in channels {
            reg.insert(c.id.clone(), c);
        }
    }

    // If already running, just return the existing port.
    {
        let guard = state_lock().lock().map_err(|_| "state poisoned")?;
        if let Some(st) = guard.as_ref() {
            return Ok(FreeProxyInfo { port: st.port });
        }
    }

    // Bind + start the accept loop (blocking bind is cheap; do it on a blocking pool).
    let port = tauri::async_runtime::spawn_blocking(start_server)
        .await
        .map_err(|e| format!("spawn_blocking join error: {e}"))??;

    Ok(FreeProxyInfo { port })
}

/// Tauri command: stop the proxy. (Idempotent best-effort.)
#[tauri::command]
pub fn free_proxy_stop() -> Result<(), String> {
    // tiny_http's Server has no clean shutdown handle here; we simply drop our
    // record of it. The accept thread keeps the bound socket but is harmless and
    // will be reused on the next ensure (same port returned). For a hard stop the
    // app process exit releases the socket. Clearing the registry disables routing.
    if let Ok(mut reg) = registry().lock() {
        reg.clear();
    }
    Ok(())
}

/// Bind 127.0.0.1 on the first free port in 8765..=8799 and spawn the accept loop.
/// Returns the chosen port. Idempotent guard via SERVER_STATE.
fn start_server() -> Result<u16, String> {
    let mut guard = state_lock().lock().map_err(|_| "state poisoned")?;
    if let Some(st) = guard.as_ref() {
        return Ok(st.port);
    }

    let mut bound: Option<(Server, u16)> = None;
    for port in 8765u16..=8799u16 {
        match Server::http(("127.0.0.1", port)) {
            Ok(server) => {
                bound = Some((server, port));
                break;
            }
            Err(_) => continue,
        }
    }

    let (server, port) = bound.ok_or_else(|| {
        "free proxy: no free port in 8765..8799 to bind on 127.0.0.1".to_string()
    })?;

    std::thread::Builder::new()
        .name("owf-free-proxy".to_string())
        .spawn(move || {
            for request in server.incoming_requests() {
                // One worker thread per request so a long-lived stream does not
                // block other channels.
                std::thread::spawn(move || {
                    handle_request(request);
                });
            }
        })
        .map_err(|e| format!("free proxy: failed to spawn accept thread: {e}"))?;

    *guard = Some(ProxyState { port });
    Ok(port)
}

fn cors_headers() -> Vec<Header> {
    vec![
        Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap(),
        Header::from_bytes(
            &b"Access-Control-Allow-Methods"[..],
            &b"POST, OPTIONS"[..],
        )
        .unwrap(),
        Header::from_bytes(
            &b"Access-Control-Allow-Headers"[..],
            &b"*"[..],
        )
        .unwrap(),
    ]
}

fn anthropic_error_json(message: &str) -> Value {
    json!({
        "type": "error",
        "error": { "type": "api_error", "message": message }
    })
}

/// Respond with a plain JSON anthropic-style error (used before any streaming).
fn respond_json_error(request: Request, status: u16, message: &str) {
    let body = anthropic_error_json(message).to_string();
    let mut response = Response::from_string(body).with_status_code(status);
    let ct = Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap();
    response.add_header(ct);
    for h in cors_headers() {
        response.add_header(h);
    }
    let _ = request.respond(response);
}

fn handle_request(mut request: Request) {
    let method = request.method().clone();
    let url = request.url().to_string();

    // CORS preflight.
    if method == Method::Options {
        let mut response = Response::empty(200);
        for h in cors_headers() {
            response.add_header(h);
        }
        let _ = request.respond(response);
        return;
    }

    // Route: /ch/<id>/v1/messages or /ch/<id>/v1/messages/count_tokens
    // (tolerate query strings like ?beta=true).
    let path = url.split('?').next().unwrap_or(&url);
    let (channel_id, endpoint) = match parse_channel_route(path) {
        Some(parsed) => parsed,
        None => {
            respond_json_error(request, 404, "free proxy: unknown route (expected /ch/<id>/v1/messages)");
            return;
        }
    };

    let cfg = {
        let reg = match registry().lock() {
            Ok(r) => r,
            Err(_) => {
                respond_json_error(request, 500, "free proxy: registry poisoned");
                return;
            }
        };
        match reg.get(&channel_id) {
            Some(c) => c.clone(),
            None => {
                respond_json_error(
                    request,
                    404,
                    &format!("free proxy: channel '{channel_id}' not registered"),
                );
                return;
            }
        }
    };

    // Detect anthropic-beta passthrough header before consuming the body.
    let anthropic_beta = request
        .headers()
        .iter()
        .find(|h| h.field.as_str().as_str().eq_ignore_ascii_case("anthropic-beta"))
        .map(|h| h.value.as_str().to_string());

    // Read the full request body (Anthropic Messages JSON).
    let mut body_bytes = Vec::new();
    if request.as_reader().read_to_end(&mut body_bytes).is_err() {
        respond_json_error(request, 400, "free proxy: failed to read request body");
        return;
    }

    let anthropic_body: Value = match serde_json::from_slice(&body_bytes) {
        Ok(v) => v,
        Err(e) => {
            respond_json_error(request, 400, &format!("free proxy: invalid JSON body: {e}"));
            return;
        }
    };

    // The claude CLI pre-flights token usage via POST /v1/messages/count_tokens.
    // Handle it explicitly so a missing route doesn't 404 (which degrades the
    // CLI's /context and /compact accounting).
    if endpoint == ProxyEndpoint::CountTokens {
        handle_count_tokens(request, &cfg, anthropic_body, anthropic_beta);
        return;
    }

    match cfg.transport.as_str() {
        "anthropic" => handle_anthropic_passthrough(request, &cfg, anthropic_body, anthropic_beta),
        "openai" => handle_openai_translate(request, &cfg, anthropic_body),
        other => {
            respond_json_error(
                request,
                400,
                &format!("free proxy: unknown transport '{other}'"),
            );
        }
    }
}

/// Which Anthropic endpoint a request targets.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ProxyEndpoint {
    Messages,
    CountTokens,
}

/// Extract `<id>` and the endpoint kind from `/ch/<id>/v1/messages[/count_tokens]`.
fn parse_channel_route(path: &str) -> Option<(String, ProxyEndpoint)> {
    let rest = path.strip_prefix("/ch/")?;
    let id_end = rest.find('/')?;
    let id = &rest[..id_end];
    let tail = &rest[id_end..];
    if id.is_empty() {
        return None;
    }
    match tail {
        "/v1/messages" | "/v1/messages/" => Some((id.to_string(), ProxyEndpoint::Messages)),
        "/v1/messages/count_tokens" | "/v1/messages/count_tokens/" => {
            Some((id.to_string(), ProxyEndpoint::CountTokens))
        }
        _ => None,
    }
}

/// Respond with a plain JSON body + CORS (used for count_tokens and similar
/// non-streamed JSON replies).
fn respond_json(request: Request, status: u16, value: &Value) {
    let body = value.to_string();
    let mut response = Response::from_string(body).with_status_code(status);
    let ct = Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap();
    response.add_header(ct);
    for h in cors_headers() {
        response.add_header(h);
    }
    let _ = request.respond(response);
}

/// Rough Anthropic-style token estimate from a Messages body: ~4 chars/token
/// over the joined system + message text. Used for OpenAI-transport channels
/// (which have no count_tokens endpoint) and as a fallback.
fn estimate_input_tokens(anthropic_body: &Value) -> u64 {
    let mut chars = 0usize;
    if let Some(system) = anthropic_body.get("system") {
        chars += join_system_text(system).chars().count();
    }
    if let Some(msgs) = anthropic_body.get("messages").and_then(|m| m.as_array()) {
        for msg in msgs {
            match msg.get("content") {
                Some(Value::String(s)) => chars += s.chars().count(),
                Some(Value::Array(blocks)) => {
                    chars += collect_text_blocks(blocks).chars().count();
                }
                _ => {}
            }
        }
    }
    ((chars / 4) as u64).max(1)
}

/// Answer a count_tokens request. For native Anthropic upstreams, forward it;
/// for OpenAI-translated channels (no such endpoint), synthesize an estimate.
fn handle_count_tokens(
    request: Request,
    cfg: &FreeChannelCfg,
    mut anthropic_body: Value,
    anthropic_beta: Option<String>,
) {
    if cfg.transport == "anthropic" {
        if !cfg.model.is_empty() {
            if let Some(obj) = anthropic_body.as_object_mut() {
                obj.insert("model".to_string(), Value::String(cfg.model.clone()));
            }
        }
        let upstream_url = format!("{}/v1/messages/count_tokens", trim_base(&cfg.base_url));
        let mut req = ureq::post(&upstream_url)
            .set("x-api-key", &cfg.api_key)
            .set("authorization", &format!("Bearer {}", cfg.api_key))
            .set("anthropic-version", "2023-06-01")
            .set("content-type", "application/json");
        if let Some(beta) = anthropic_beta.as_deref() {
            req = req.set("anthropic-beta", beta);
        }
        match req.send_string(&anthropic_body.to_string()) {
            Ok(response) => {
                let body = response
                    .into_string()
                    .unwrap_or_else(|_| json!({ "input_tokens": 0 }).to_string());
                let value: Value = serde_json::from_str(&body)
                    .unwrap_or_else(|_| json!({ "input_tokens": estimate_input_tokens(&anthropic_body) }));
                respond_json(request, 200, &value);
            }
            // On any upstream failure, fall back to a local estimate so the CLI
            // keeps working instead of erroring on a 404/5xx.
            Err(_) => {
                respond_json(
                    request,
                    200,
                    &json!({ "input_tokens": estimate_input_tokens(&anthropic_body) }),
                );
            }
        }
        return;
    }

    // OpenAI-compatible upstreams have no count_tokens endpoint: estimate.
    respond_json(
        request,
        200,
        &json!({ "input_tokens": estimate_input_tokens(&anthropic_body) }),
    );
}

fn trim_base(base: &str) -> &str {
    base.trim_end_matches('/')
}

// ---------------------------------------------------------------------------
// Native Anthropic reverse proxy
// ---------------------------------------------------------------------------

fn handle_anthropic_passthrough(
    request: Request,
    cfg: &FreeChannelCfg,
    mut anthropic_body: Value,
    anthropic_beta: Option<String>,
) {
    // Override model if configured.
    if !cfg.model.is_empty() {
        if let Some(obj) = anthropic_body.as_object_mut() {
            obj.insert("model".to_string(), Value::String(cfg.model.clone()));
        }
    }

    let upstream_url = format!("{}/v1/messages", trim_base(&cfg.base_url));
    let body_string = anthropic_body.to_string();

    let mut req = ureq::post(&upstream_url)
        .set("anthropic-version", "2023-06-01")
        .set("content-type", "application/json")
        .set("accept", "text/event-stream");
    // Only attach credentials when we actually have a key. Local channels send
    // an empty key; a literal `Authorization: Bearer ` (no token) makes some
    // auth-enabled local backends 401.
    if !cfg.api_key.is_empty() {
        req = req
            .set("x-api-key", &cfg.api_key)
            .set("authorization", &format!("Bearer {}", cfg.api_key));
    }
    if let Some(beta) = anthropic_beta.as_deref() {
        req = req.set("anthropic-beta", beta);
    }

    let resp = req.send_string(&body_string);

    match resp {
        Ok(response) => {
            stream_passthrough(request, response);
        }
        Err(ureq::Error::Status(code, response)) => {
            // Surface upstream error body as-is. We buffer it below, so if the
            // upstream labelled the error as an SSE stream, relabel it JSON —
            // otherwise the downstream CLI switches to SSE parsing and chokes on
            // a single non-streamed payload.
            let raw_ct = response
                .header("content-type")
                .unwrap_or("application/json")
                .to_string();
            let ct = if raw_ct.starts_with("text/event-stream") {
                "application/json".to_string()
            } else {
                raw_ct
            };
            let detail = response
                .into_string()
                .unwrap_or_else(|_| "<no body>".to_string());
            let mut out = Response::from_string(detail).with_status_code(code);
            if let Ok(h) = Header::from_bytes(&b"Content-Type"[..], ct.as_bytes()) {
                out.add_header(h);
            }
            for h in cors_headers() {
                out.add_header(h);
            }
            let _ = request.respond(out);
        }
        Err(e) => {
            respond_json_error(
                request,
                502,
                &format!("free proxy: upstream request failed: {e}"),
            );
        }
    }
}

/// Stream an upstream ureq response back to the client unchanged.
///
/// We write the HTTP response head + body manually onto the raw socket
/// (`Request::into_writer`) so SSE streams flush live, byte-for-byte.
fn stream_passthrough(request: Request, response: ureq::Response) {
    let status = response.status();
    let content_type = response
        .header("content-type")
        .unwrap_or("text/event-stream")
        .to_string();

    let mut reader = response.into_reader();
    let mut writer = request.into_writer();

    if write_stream_head(&mut writer, status, &content_type).is_err() {
        return;
    }

    let mut buf = [0u8; 8192];
    loop {
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                if write_chunk(&mut writer, &buf[..n]).is_err() {
                    break;
                }
                let _ = writer.flush();
            }
            Err(_) => break,
        }
    }
    // Terminate the chunked body.
    let _ = writer.write_all(b"0\r\n\r\n");
    let _ = writer.flush();
}

/// Write an HTTP/1.1 response head using chunked transfer-encoding + CORS.
fn write_stream_head<W: Write>(writer: &mut W, status: u16, content_type: &str) -> std::io::Result<()> {
    let head = format!(
        "HTTP/1.1 {status} OK\r\n\
         Content-Type: {content_type}\r\n\
         Transfer-Encoding: chunked\r\n\
         Cache-Control: no-cache\r\n\
         Connection: keep-alive\r\n\
         X-Accel-Buffering: no\r\n\
         Access-Control-Allow-Origin: *\r\n\
         \r\n"
    );
    writer.write_all(head.as_bytes())
}

/// Write one chunk in HTTP chunked-transfer framing.
fn write_chunk<W: Write>(writer: &mut W, data: &[u8]) -> std::io::Result<()> {
    if data.is_empty() {
        return Ok(());
    }
    writer.write_all(format!("{:x}\r\n", data.len()).as_bytes())?;
    writer.write_all(data)?;
    writer.write_all(b"\r\n")
}

// ---------------------------------------------------------------------------
// OpenAI translation
// ---------------------------------------------------------------------------

fn handle_openai_translate(request: Request, cfg: &FreeChannelCfg, anthropic_body: Value) {
    // The model the CLI requested. We echo this back in message_start so the
    // response model matches the request (Anthropic contract).
    let requested_model = anthropic_body
        .get("model")
        .and_then(|m| m.as_str())
        .unwrap_or("")
        .to_string();
    // The model actually sent upstream: the channel override, or — when no
    // override is configured — the requested model, so we never POST model:"".
    let upstream_model = if cfg.model.is_empty() {
        requested_model.clone()
    } else {
        cfg.model.clone()
    };
    let echo_model = if requested_model.is_empty() {
        upstream_model.clone()
    } else {
        requested_model
    };
    let openai_body = anthropic_to_openai_body(&anthropic_body, &upstream_model);
    let upstream_url = format!("{}/chat/completions", trim_base(&cfg.base_url));

    let mut req = ureq::post(&upstream_url)
        .set("content-type", "application/json")
        .set("accept", "text/event-stream");
    if !cfg.api_key.is_empty() {
        req = req.set("authorization", &format!("Bearer {}", cfg.api_key));
    }
    let resp = req.send_string(&openai_body.to_string());

    match resp {
        Ok(response) => {
            translate_openai_stream(request, response, &echo_model);
        }
        Err(ureq::Error::Status(code, response)) => {
            let detail = response
                .into_string()
                .unwrap_or_else(|_| "<no body>".to_string());
            respond_json_error(
                request,
                code,
                &format!("free proxy: upstream {code}: {detail}"),
            );
        }
        Err(e) => {
            respond_json_error(
                request,
                502,
                &format!("free proxy: upstream request failed: {e}"),
            );
        }
    }
}

/// Convert an Anthropic Messages body to an OpenAI chat/completions body.
fn anthropic_to_openai_body(anthropic: &Value, model: &str) -> Value {
    let mut messages: Vec<Value> = Vec::new();

    // system (string or array of {type:text,text}).
    if let Some(system) = anthropic.get("system") {
        let sys_text = join_system_text(system);
        if !sys_text.is_empty() {
            messages.push(json!({ "role": "system", "content": sys_text }));
        }
    }

    if let Some(msgs) = anthropic.get("messages").and_then(|m| m.as_array()) {
        for msg in msgs {
            convert_message(msg, &mut messages);
        }
    }

    let mut body = json!({
        "model": model,
        "messages": messages,
        "stream": true,
    });
    let obj = body.as_object_mut().unwrap();

    let max_tokens = anthropic
        .get("max_tokens")
        .and_then(|v| v.as_u64())
        .unwrap_or(4096);
    obj.insert("max_tokens".to_string(), json!(max_tokens));

    if let Some(t) = anthropic.get("temperature") {
        if !t.is_null() {
            obj.insert("temperature".to_string(), t.clone());
        }
    }
    if let Some(p) = anthropic.get("top_p") {
        if !p.is_null() {
            obj.insert("top_p".to_string(), p.clone());
        }
    }
    if let Some(stop) = anthropic.get("stop_sequences") {
        if stop.is_array() && !stop.as_array().unwrap().is_empty() {
            obj.insert("stop".to_string(), stop.clone());
        }
    }

    // tools.
    if let Some(tools) = anthropic.get("tools").and_then(|t| t.as_array()) {
        if !tools.is_empty() {
            let converted: Vec<Value> = tools
                .iter()
                .map(|tool| {
                    json!({
                        "type": "function",
                        "function": {
                            "name": tool.get("name").cloned().unwrap_or(Value::String(String::new())),
                            "description": tool.get("description").cloned().unwrap_or(Value::String(String::new())),
                            "parameters": tool.get("input_schema").cloned().unwrap_or(json!({"type":"object","properties":{}})),
                        }
                    })
                })
                .collect();
            obj.insert("tools".to_string(), json!(converted));
        }
    }

    // tool_choice.
    if let Some(tc) = anthropic.get("tool_choice") {
        if let Some(converted) = convert_tool_choice(tc) {
            obj.insert("tool_choice".to_string(), converted);
        }
    }

    body
}

fn join_system_text(system: &Value) -> String {
    match system {
        Value::String(s) => s.clone(),
        Value::Array(arr) => arr
            .iter()
            .filter_map(|b| {
                if b.get("type").and_then(|t| t.as_str()) == Some("text") {
                    b.get("text").and_then(|t| t.as_str()).map(|s| s.to_string())
                } else {
                    None
                }
            })
            .collect::<Vec<_>>()
            .join("\n\n"),
        _ => String::new(),
    }
}

fn convert_tool_choice(tc: &Value) -> Option<Value> {
    let obj = tc.as_object()?;
    match obj.get("type").and_then(|t| t.as_str()) {
        Some("auto") => Some(json!("auto")),
        Some("none") => Some(json!("none")),
        Some("any") => Some(json!("required")),
        Some("required") => Some(json!("required")),
        Some("tool") => {
            let name = obj.get("name").and_then(|n| n.as_str())?;
            Some(json!({ "type": "function", "function": { "name": name } }))
        }
        Some("function") if obj.contains_key("function") => Some(tc.clone()),
        _ => Some(tc.clone()),
    }
}

/// Extract the joined text from an array of content blocks.
fn collect_text_blocks(blocks: &[Value]) -> String {
    blocks
        .iter()
        .filter_map(|b| {
            if b.get("type").and_then(|t| t.as_str()) == Some("text") {
                b.get("text").and_then(|t| t.as_str()).map(|s| s.to_string())
            } else {
                None
            }
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

/// Serialize a tool_result block's `content` field to a plain string.
fn serialize_tool_result_content(content: &Value) -> String {
    match content {
        Value::Null => String::new(),
        Value::String(s) => s.clone(),
        Value::Array(arr) => arr
            .iter()
            .map(|item| {
                if item.get("type").and_then(|t| t.as_str()) == Some("text") {
                    item.get("text")
                        .and_then(|t| t.as_str())
                        .unwrap_or("")
                        .to_string()
                } else {
                    item.to_string()
                }
            })
            .collect::<Vec<_>>()
            .join("\n"),
        other => other.to_string(),
    }
}

fn convert_message(msg: &Value, out: &mut Vec<Value>) {
    let role = msg.get("role").and_then(|r| r.as_str()).unwrap_or("user");
    let content = match msg.get("content") {
        Some(c) => c,
        None => return,
    };

    // String content -> straightforward.
    if let Some(s) = content.as_str() {
        out.push(json!({ "role": role, "content": s }));
        return;
    }

    let blocks = match content.as_array() {
        Some(b) => b,
        None => {
            out.push(json!({ "role": role, "content": content.to_string() }));
            return;
        }
    };

    if role == "assistant" {
        convert_assistant_blocks(blocks, out);
    } else {
        convert_user_blocks(blocks, out);
    }
}

fn convert_assistant_blocks(blocks: &[Value], out: &mut Vec<Value>) {
    let text = collect_text_blocks(blocks);
    let mut tool_calls: Vec<Value> = Vec::new();
    for b in blocks {
        if b.get("type").and_then(|t| t.as_str()) == Some("tool_use") {
            let id = b.get("id").and_then(|i| i.as_str()).unwrap_or("");
            let name = b.get("name").and_then(|n| n.as_str()).unwrap_or("");
            let input = b.get("input").cloned().unwrap_or(json!({}));
            tool_calls.push(json!({
                "id": id,
                "type": "function",
                "function": {
                    "name": name,
                    "arguments": input.to_string(),
                }
            }));
        }
    }

    if !tool_calls.is_empty() {
        // OpenAI: assistant with tool_calls; content may be null.
        let content_val: Value = if text.is_empty() {
            Value::Null
        } else {
            Value::String(text)
        };
        out.push(json!({
            "role": "assistant",
            "content": content_val,
            "tool_calls": tool_calls,
        }));
    } else {
        out.push(json!({ "role": "assistant", "content": text }));
    }
}

fn convert_user_blocks(blocks: &[Value], out: &mut Vec<Value>) {
    // Collect plain text + best-effort image parts, then emit one user message
    // (if any non-tool content) followed by tool result messages.
    let mut text_parts: Vec<String> = Vec::new();
    let mut image_parts: Vec<Value> = Vec::new();
    let mut tool_msgs: Vec<Value> = Vec::new();

    for b in blocks {
        match b.get("type").and_then(|t| t.as_str()) {
            Some("text") => {
                if let Some(t) = b.get("text").and_then(|t| t.as_str()) {
                    text_parts.push(t.to_string());
                }
            }
            Some("image") => {
                if let Some(source) = b.get("source") {
                    let media_type = source
                        .get("media_type")
                        .and_then(|m| m.as_str())
                        .unwrap_or("image/png");
                    let data = source.get("data").and_then(|d| d.as_str()).unwrap_or("");
                    let url = format!("data:{media_type};base64,{data}");
                    image_parts.push(json!({
                        "type": "image_url",
                        "image_url": { "url": url }
                    }));
                }
            }
            Some("tool_result") => {
                let tool_use_id = b
                    .get("tool_use_id")
                    .and_then(|i| i.as_str())
                    .unwrap_or("");
                let serialized = b
                    .get("content")
                    .map(serialize_tool_result_content)
                    .unwrap_or_default();
                tool_msgs.push(json!({
                    "role": "tool",
                    "tool_call_id": tool_use_id,
                    "content": serialized,
                }));
            }
            _ => {}
        }
    }

    // Emit user text/image message first if present.
    let joined_text = text_parts.join("\n");
    if !image_parts.is_empty() {
        let mut parts: Vec<Value> = Vec::new();
        if !joined_text.is_empty() {
            parts.push(json!({ "type": "text", "text": joined_text }));
        }
        parts.extend(image_parts);
        out.push(json!({ "role": "user", "content": parts }));
    } else if !joined_text.is_empty() {
        out.push(json!({ "role": "user", "content": joined_text }));
    }

    out.extend(tool_msgs);
}

// ---------------------------------------------------------------------------
// OpenAI SSE -> Anthropic SSE translation
// ---------------------------------------------------------------------------

fn sse_event(event_type: &str, data: &Value) -> String {
    format!("event: {}\ndata: {}\n\n", event_type, data)
}

fn map_finish_reason(reason: Option<&str>) -> &'static str {
    match reason {
        Some("stop") => "end_turn",
        Some("length") => "max_tokens",
        Some("tool_calls") => "tool_use",
        Some("content_filter") => "end_turn",
        _ => "end_turn",
    }
}

/// Per-tool-call streaming block state. OpenAI-compatible providers vary in how
/// they split a streamed tool_call across deltas (id/name/arguments may each
/// arrive separately, in any order), so we accumulate fragments and defer the
/// Anthropic `content_block_start` until the tool name is known.
struct ToolAccum {
    /// Anthropic content-block index, assigned once the block is started.
    anthropic_index: Option<usize>,
    started: bool,
    name: String,
    id: Option<String>,
    /// Argument fragments seen before the block could be started.
    pending_args: String,
}

fn translate_openai_stream(request: Request, response: ureq::Response, echo_model: &str) {
    let mut writer = request.into_writer();
    if write_stream_head(&mut writer, 200, "text/event-stream").is_err() {
        return;
    }
    let message_id = next_message_id();
    let reader = BufReader::new(response.into_reader());

    // Sink: write each Anthropic SSE event as one chunked-transfer chunk.
    let mut sink = |event: &str, data: &Value| -> bool {
        let s = sse_event(event, data);
        if write_chunk(&mut writer, s.as_bytes()).is_err() {
            return false;
        }
        let _ = writer.flush();
        true
    };
    run_openai_translation(reader, echo_model, &message_id, &mut sink);

    // Terminate the chunked body.
    let _ = writer.write_all(b"0\r\n\r\n");
    let _ = writer.flush();
}

/// Drive the OpenAI-SSE -> Anthropic-SSE translation, emitting each Anthropic
/// event via `sink` (return false to abort). Kept independent of the socket
/// writer so it can be unit-tested by collecting events into a Vec.
fn run_openai_translation<R: BufRead>(
    reader: R,
    echo_model: &str,
    message_id: &str,
    sink: &mut dyn FnMut(&str, &Value) -> bool,
) {
    macro_rules! emit {
        ($event:expr, $data:expr) => {{
            if !sink($event, &$data) {
                return;
            }
        }};
    }

    // Emit message_start.
    emit!(
        "message_start",
        json!({
            "type": "message_start",
            "message": {
                "id": message_id,
                "type": "message",
                "role": "assistant",
                "model": echo_model,
                "content": [],
                "stop_reason": null,
                "stop_sequence": null,
                "usage": {
                    "input_tokens": 0,
                    "output_tokens": 0,
                    "cache_creation_input_tokens": 0,
                    "cache_read_input_tokens": 0
                }
            }
        })
    );

    // Block state.
    let mut next_index: usize = 0;
    let mut text_open = false;
    let mut text_index: usize = 0;
    let mut tool_blocks: HashMap<i64, ToolAccum> = HashMap::new();
    let mut finish_reason: Option<String> = None;
    let mut output_tokens: u64 = 0;
    let mut text_char_count: usize = 0;

    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };
        let line = line.trim_end_matches('\r');
        if line.is_empty() {
            continue;
        }
        let data = match line.strip_prefix("data:") {
            Some(d) => d.trim(),
            None => continue,
        };
        if data == "[DONE]" {
            break;
        }
        let chunk: Value = match serde_json::from_str(data) {
            Ok(v) => v,
            Err(_) => continue,
        };

        // usage (some providers send completion_tokens in a trailing chunk).
        if let Some(usage) = chunk.get("usage") {
            if let Some(ct) = usage.get("completion_tokens").and_then(|v| v.as_u64()) {
                output_tokens = ct;
            }
        }

        let choice = match chunk.get("choices").and_then(|c| c.as_array()).and_then(|a| a.first()) {
            Some(c) => c,
            None => continue,
        };

        if let Some(fr) = choice.get("finish_reason").and_then(|f| f.as_str()) {
            finish_reason = Some(fr.to_string());
        }

        let delta = match choice.get("delta") {
            Some(d) => d,
            None => continue,
        };

        // Text content.
        if let Some(text) = delta.get("content").and_then(|c| c.as_str()) {
            if !text.is_empty() {
                if !text_open {
                    text_index = next_index;
                    next_index += 1;
                    text_open = true;
                    emit!(
                        "content_block_start",
                        json!({
                            "type": "content_block_start",
                            "index": text_index,
                            "content_block": { "type": "text", "text": "" }
                        })
                    );
                }
                text_char_count += text.chars().count();
                emit!(
                    "content_block_delta",
                    json!({
                        "type": "content_block_delta",
                        "index": text_index,
                        "delta": { "type": "text_delta", "text": text }
                    })
                );
            }
        }

        // Tool calls. Accumulate id/name/arguments fragments per tool_call index
        // and defer content_block_start until the tool name is known, so a
        // provider that streams arguments before the name never produces an
        // un-dispatchable tool_use block with an empty name.
        if let Some(tool_calls) = delta.get("tool_calls").and_then(|t| t.as_array()) {
            for tc in tool_calls {
                let tc_index = tc.get("index").and_then(|i| i.as_i64()).unwrap_or(0);
                let func = tc.get("function");
                let name = func.and_then(|f| f.get("name")).and_then(|n| n.as_str());
                let args = func
                    .and_then(|f| f.get("arguments"))
                    .and_then(|a| a.as_str())
                    .unwrap_or("");
                let id = tc.get("id").and_then(|i| i.as_str());

                let accum = tool_blocks.entry(tc_index).or_insert_with(|| ToolAccum {
                    anthropic_index: None,
                    started: false,
                    name: String::new(),
                    id: None,
                    pending_args: String::new(),
                });
                if let Some(n) = name {
                    if !n.is_empty() {
                        accum.name = n.to_string();
                    }
                }
                if let Some(i) = id {
                    if !i.is_empty() && accum.id.is_none() {
                        accum.id = Some(i.to_string());
                    }
                }

                // Once we know the tool name we can open the Anthropic block and
                // flush any argument fragments buffered before now.
                if !accum.started && !accum.name.is_empty() {
                    if text_open {
                        emit!(
                            "content_block_stop",
                            json!({ "type": "content_block_stop", "index": text_index })
                        );
                        text_open = false;
                    }
                    let block_index = next_index;
                    next_index += 1;
                    accum.anthropic_index = Some(block_index);
                    accum.started = true;
                    let tool_id = accum
                        .id
                        .clone()
                        .unwrap_or_else(|| format!("tool_{}", tc_index));
                    let tool_name = accum.name.clone();
                    let buffered = std::mem::take(&mut accum.pending_args);
                    emit!(
                        "content_block_start",
                        json!({
                            "type": "content_block_start",
                            "index": block_index,
                            "content_block": {
                                "type": "tool_use",
                                "id": tool_id,
                                "name": tool_name,
                                "input": {}
                            }
                        })
                    );
                    if !buffered.is_empty() {
                        emit!(
                            "content_block_delta",
                            json!({
                                "type": "content_block_delta",
                                "index": block_index,
                                "delta": { "type": "input_json_delta", "partial_json": buffered }
                            })
                        );
                    }
                }

                if !args.is_empty() {
                    if accum.started {
                        let block_index = accum.anthropic_index.unwrap_or(0);
                        emit!(
                            "content_block_delta",
                            json!({
                                "type": "content_block_delta",
                                "index": block_index,
                                "delta": { "type": "input_json_delta", "partial_json": args }
                            })
                        );
                    } else {
                        // Name not seen yet — buffer until the block can start.
                        accum.pending_args.push_str(args);
                    }
                }
            }
        }
    }

    // Close any open blocks.
    if text_open {
        emit!(
            "content_block_stop",
            json!({ "type": "content_block_stop", "index": text_index })
        );
    }
    for accum in tool_blocks.values() {
        if let Some(idx) = accum.anthropic_index {
            emit!(
                "content_block_stop",
                json!({ "type": "content_block_stop", "index": idx })
            );
        }
    }

    // Best-effort output token estimate when upstream did not report usage.
    if output_tokens == 0 {
        output_tokens = (text_char_count / 4) as u64 + (tool_blocks.len() as u64 * 8);
    }

    let stop_reason = map_finish_reason(finish_reason.as_deref());
    emit!(
        "message_delta",
        json!({
            "type": "message_delta",
            "delta": { "stop_reason": stop_reason, "stop_sequence": null },
            "usage": {
                "output_tokens": output_tokens,
                "cache_creation_input_tokens": 0,
                "cache_read_input_tokens": 0
            }
        })
    );
    emit!("message_stop", json!({ "type": "message_stop" }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// Run the translator over a literal OpenAI SSE string and collect the
    /// emitted Anthropic events.
    fn collect(sse: &str, echo_model: &str) -> Vec<(String, Value)> {
        let mut events: Vec<(String, Value)> = Vec::new();
        let mut sink = |event: &str, data: &Value| -> bool {
            events.push((event.to_string(), data.clone()));
            true
        };
        run_openai_translation(sse.as_bytes(), echo_model, "msg_test", &mut sink);
        events
    }

    fn first<'a>(events: &'a [(String, Value)], kind: &str) -> &'a Value {
        &events
            .iter()
            .find(|(k, _)| k == kind)
            .unwrap_or_else(|| panic!("no event of kind {kind}"))
            .1
    }

    #[test]
    fn route_parsing_distinguishes_messages_and_count_tokens() {
        assert_eq!(
            parse_channel_route("/ch/groq/v1/messages"),
            Some(("groq".to_string(), ProxyEndpoint::Messages))
        );
        assert_eq!(
            parse_channel_route("/ch/groq/v1/messages/count_tokens"),
            Some(("groq".to_string(), ProxyEndpoint::CountTokens))
        );
        assert_eq!(
            parse_channel_route("/ch/groq/v1/messages/"),
            Some(("groq".to_string(), ProxyEndpoint::Messages))
        );
        assert_eq!(parse_channel_route("/ch//v1/messages"), None);
        assert_eq!(parse_channel_route("/ch/groq/v1/other"), None);
        assert_eq!(parse_channel_route("/health"), None);
    }

    #[test]
    fn finish_reason_mapping() {
        assert_eq!(map_finish_reason(Some("stop")), "end_turn");
        assert_eq!(map_finish_reason(Some("length")), "max_tokens");
        assert_eq!(map_finish_reason(Some("tool_calls")), "tool_use");
        assert_eq!(map_finish_reason(None), "end_turn");
    }

    #[test]
    fn estimate_input_tokens_counts_text() {
        let body = json!({ "messages": [{ "role": "user", "content": "12345678" }] });
        assert_eq!(estimate_input_tokens(&body), 2); // 8 chars / 4
        let empty = json!({ "messages": [] });
        assert_eq!(estimate_input_tokens(&empty), 1); // floored to 1
    }

    #[test]
    fn anthropic_body_translates_to_openai_shape() {
        let body = json!({
            "model": "ignored-by-override",
            "system": "You are helpful",
            "messages": [{ "role": "user", "content": "Hi" }],
            "max_tokens": 100,
            "tools": [{ "name": "foo", "description": "d", "input_schema": { "type": "object" } }],
            "tool_choice": { "type": "auto" }
        });
        let out = anthropic_to_openai_body(&body, "gpt-x");
        assert_eq!(out["model"], "gpt-x");
        assert_eq!(out["stream"], true);
        assert_eq!(out["max_tokens"], 100);
        let msgs = out["messages"].as_array().unwrap();
        assert_eq!(msgs[0]["role"], "system");
        assert_eq!(msgs[0]["content"], "You are helpful");
        assert_eq!(msgs[1]["role"], "user");
        assert_eq!(out["tools"][0]["type"], "function");
        assert_eq!(out["tools"][0]["function"]["name"], "foo");
        assert_eq!(out["tool_choice"], "auto");
    }

    #[test]
    fn text_stream_translates_and_echoes_requested_model() {
        let sse = "data: {\"choices\":[{\"delta\":{\"content\":\"Hello\"},\"finish_reason\":null}]}\n\
                   data: {\"choices\":[{\"delta\":{\"content\":\" world\"},\"finish_reason\":null}]}\n\
                   data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\
                   data: [DONE]\n";
        let events = collect(sse, "claude-sonnet-4-5");
        let kinds: Vec<&str> = events.iter().map(|(k, _)| k.as_str()).collect();
        assert_eq!(
            kinds,
            vec![
                "message_start",
                "content_block_start",
                "content_block_delta",
                "content_block_delta",
                "content_block_stop",
                "message_delta",
                "message_stop",
            ]
        );
        // message_start echoes the REQUESTED model, not the upstream model.
        assert_eq!(first(&events, "message_start")["message"]["model"], "claude-sonnet-4-5");
        assert_eq!(first(&events, "message_delta")["delta"]["stop_reason"], "end_turn");
    }

    #[test]
    fn tool_call_canonical_order_produces_named_block() {
        // OpenAI canonical: id + name in the first delta, arguments stream after.
        let sse = "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_1\",\"function\":{\"name\":\"get_weather\",\"arguments\":\"\"}}]},\"finish_reason\":null}]}\n\
                   data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"{\\\"city\\\"\"}}]}}]}\n\
                   data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\":\\\"SF\\\"}\"}}]}}]}\n\
                   data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"tool_calls\"}]}\n\
                   data: [DONE]\n";
        let events = collect(sse, "claude-x");
        let start = first(&events, "content_block_start");
        assert_eq!(start["content_block"]["type"], "tool_use");
        assert_eq!(start["content_block"]["name"], "get_weather");
        assert_eq!(start["content_block"]["id"], "call_1");
        // Arguments arrive as input_json_delta fragments.
        let joined: String = events
            .iter()
            .filter(|(k, _)| k == "content_block_delta")
            .filter_map(|(_, v)| v["delta"]["partial_json"].as_str())
            .collect();
        assert_eq!(joined, "{\"city\":\"SF\"}");
        assert_eq!(first(&events, "message_delta")["delta"]["stop_reason"], "tool_use");
    }

    #[test]
    fn tool_call_with_arguments_before_name_never_emits_empty_name() {
        // Regression: some OpenAI-compatible providers send arguments (and id)
        // before the tool name. The block must NOT open with an empty name; it
        // must defer until the name arrives and then flush the buffered args.
        let sse = "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_2\",\"function\":{\"arguments\":\"{\\\"x\\\":1}\"}}]},\"finish_reason\":null}]}\n\
                   data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"name\":\"do_thing\"}}]}}]}\n\
                   data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"tool_calls\"}]}\n\
                   data: [DONE]\n";
        let events = collect(sse, "claude-x");
        let start = first(&events, "content_block_start");
        assert_eq!(start["content_block"]["type"], "tool_use");
        assert_eq!(
            start["content_block"]["name"], "do_thing",
            "tool name must be populated, not empty"
        );
        assert_eq!(start["content_block"]["id"], "call_2");
        // The buffered arguments must be flushed after the block opens.
        let joined: String = events
            .iter()
            .filter(|(k, _)| k == "content_block_delta")
            .filter_map(|(_, v)| v["delta"]["partial_json"].as_str())
            .collect();
        assert_eq!(joined, "{\"x\":1}");
    }

    #[test]
    fn message_start_usage_includes_cache_fields() {
        let events = collect("data: [DONE]\n", "claude-x");
        let usage = &first(&events, "message_start")["message"]["usage"];
        assert_eq!(usage["cache_creation_input_tokens"], 0);
        assert_eq!(usage["cache_read_input_tokens"], 0);
    }
}
