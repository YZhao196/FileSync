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
    /// The response body, base64-encoded.
    ///
    /// It used to be a `Vec<u8>`, which serde serialises as a JSON array of
    /// numbers — roughly four characters per byte, plus an array element and a
    /// separator for each. That is unnoticeable for a status object and ruinous
    /// for a photograph: a 10 MB original became a ~40 MB JSON array, parsed
    /// number by number on the JS thread. base64 is one string at four thirds
    /// of the payload, and the decoder on the other side is four lines.
    ///
    /// `tauri::ipc::Response` would be better still — raw bytes, no encoding at
    /// all — but it carries no envelope, so the status and content type would
    /// have to travel by another route. Not worth the redesign for a factor of
    /// 1.33.
    body_base64: String,
    content_type: Option<String>,
}

/// Issues an HTTP request from Rust, bypassing the webview's CORS enforcement.
///
/// Called by `nativeFetch` in `native/bridge.ts`. WebDAV needs verbs the
/// browser will not send at all (PROPFIND, MKCOL, MOVE), which is the second
/// reason this exists.
#[tauri::command]
pub async fn http_request(req: HttpRequest) -> Result<HttpResponse, String> {
    // Two timeouts, not one, and the distinction matters.
    //
    // `reqwest`'s `timeout` covers the whole exchange including the body, so a
    // single ten-second value meant a full-resolution photo — or any file worth
    // downloading — was abandoned partway through. It failed in ten seconds
    // whether the server was unreachable or merely slow, which reads as a
    // network fault either way.
    //
    // Connecting is the part worth failing fast on: an unreachable server
    // should say so immediately rather than hold a screen open. Receiving a
    // body is the part that legitimately takes as long as it takes.
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(300))
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

    let body = resp
        .bytes()
        .await
        .map_err(|e| format!("Failed to read response body: {e}"))?;

    Ok(HttpResponse {
        status,
        status_text,
        body_base64: base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &body),
        content_type,
    })
}

#[cfg(test)]
mod tests {
    /// The encoding the JS side has to undo, checked against the values that
    /// catch a wrong alphabet or missing padding.
    #[test]
    fn encodes_a_body_the_way_the_decoder_expects() {
        let encode = |bytes: &[u8]| {
            base64::Engine::encode(&base64::engine::general_purpose::STANDARD, bytes)
        };

        assert_eq!(encode(b""), "");
        // One, two and three bytes are the three padding cases.
        assert_eq!(encode(b"f"), "Zg==");
        assert_eq!(encode(b"fo"), "Zm8=");
        assert_eq!(encode(b"foo"), "Zm9v");
        // The top of the range, which is where a signed/unsigned slip shows up.
        assert_eq!(encode(&[0xff, 0xfe, 0xfd]), "//79");
        assert_eq!(encode(&[0x00, 0x01, 0x02]), "AAEC");
    }
}
