//! CORS-free HTTP for the live backends.
//!
//! The webview enforces same-origin policy and Immich and Nextcloud send no
//! permissive headers, so every request in live mode is issued from here
//! instead. In the browser this path does not exist and `nativeFetch` falls
//! back to the global `fetch` — which is why live mode only works properly
//! inside the shell.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpRequest {
    url: String,
    method: String,
    headers: HashMap<String, String>,
    body: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpResponse {
    status: u16,
    status_text: String,
    /// Raw response bytes. The JS side converts this `number[]` to `Uint8Array`.
    body_bytes: Vec<u8>,
    content_type: Option<String>,
}

/// Issues an HTTP request from Rust, bypassing the webview's CORS enforcement.
///
/// Called by `nativeFetch` in `native/bridge.ts`. WebDAV needs verbs the
/// browser will not send at all (PROPFIND, MKCOL, MOVE), which is the second
/// reason this exists.
#[tauri::command]
pub async fn http_request(req: HttpRequest) -> Result<HttpResponse, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let method = reqwest::Method::from_bytes(req.method.as_bytes())
        .map_err(|e| format!("Invalid HTTP method '{}': {e}", req.method))?;

    let mut builder = client.request(method, &req.url);
    for (k, v) in &req.headers {
        builder = builder.header(k.as_str(), v.as_str());
    }
    if let Some(body) = req.body {
        builder = builder.body(body);
    }

    let resp = builder
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {e}"))?;

    let status = resp.status().as_u16();
    let status_text = resp.status().canonical_reason().unwrap_or("").to_string();
    let content_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.split(';').next().unwrap_or(s).trim().to_string());

    let body_bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("Failed to read response body: {e}"))?
        .to_vec();

    Ok(HttpResponse {
        status,
        status_text,
        body_bytes,
        content_type,
    })
}
