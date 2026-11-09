use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{BufRead, BufReader, Write};

pub const MAX_FRAME_BYTES: usize = 16 * 1024 * 1024; // 16 MiB per SOURCE_PLUGIN_PROTOCOL.md

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RpcError {
    pub code: i32,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RpcMessage {
    pub jsonrpc: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub method: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<RpcError>,
}

/// Encodes a JSON-RPC 2.0 message into `Content-Length: N\r\n\r\n<body>` byte framing.
pub fn encode_frame(msg: &RpcMessage) -> Result<Vec<u8>, String> {
    let body = serde_json::to_vec(msg).map_err(|e| e.to_string())?;
    if body.len() > MAX_FRAME_BYTES {
        return Err("frame exceeds 16 MiB maximum".into());
    }
    let header = format!("Content-Length: {}\r\n\r\n", body.len());
    let mut out = Vec::with_capacity(header.len() + body.len());
    out.extend_from_slice(header.as_bytes());
    out.extend_from_slice(&body);
    Ok(out)
}

pub fn write_frame<W: Write>(writer: &mut W, msg: &RpcMessage) -> Result<(), String> {
    let frame = encode_frame(msg)?;
    writer.write_all(&frame).map_err(|e| e.to_string())?;
    writer.flush().map_err(|e| e.to_string())
}

/// Reads a single `Content-Length: N\r\n\r\n<body>` JSON-RPC 2.0 frame from any buffered reader.
/// Handles partial reads, multiple frames in a single buffer, and case-insensitive `Content-Length`.
pub fn read_frame<R: BufRead>(reader: &mut R) -> Result<Option<RpcMessage>, String> {
    let mut content_length: Option<usize> = None;
    let mut line = String::new();

    loop {
        line.clear();
        let n = reader.read_line(&mut line).map_err(|e| e.to_string())?;
        if n == 0 {
            if content_length.is_none() {
                return Ok(None); // Clean EOF
            }
            return Err("unexpected EOF while reading frame headers".into());
        }
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            break;
        }
        let Some((name, val)) = trimmed.split_once(':') else {
            return Err("malformed header in plugin frame".into());
        };
        if name.trim().eq_ignore_ascii_case("content-length") {
            let parsed: usize = val
                .trim()
                .parse()
                .map_err(|_| "invalid Content-Length value")?;
            if parsed > MAX_FRAME_BYTES {
                return Err("frame exceeds 16 MiB maximum".into());
            }
            content_length = Some(parsed);
        }
    }

    let len = content_length.ok_or_else(|| "missing Content-Length header".to_string())?;
    if len == 0 {
        return Err("empty JSON-RPC frame body".into());
    }

    let mut body = vec![0u8; len];
    reader.read_exact(&mut body).map_err(|e| e.to_string())?;

    let msg: RpcMessage =
        serde_json::from_slice(&body).map_err(|e| format!("invalid JSON-RPC payload: {e}"))?;
    if msg.jsonrpc != "2.0" {
        return Err("unsupported JSON-RPC version".into());
    }
    Ok(Some(msg))
}

/// Builds the host `initialize` handshake request for an external source plugin (`h:1`).
pub fn build_initialize_request(assigned_id: &str) -> RpcMessage {
    RpcMessage {
        jsonrpc: "2.0".into(),
        id: Some(serde_json::json!("h:1")),
        method: Some("initialize".into()),
        params: Some(serde_json::json!({
            "assignedId": assigned_id,
            "protocolVersion": { "min": 1, "max": 1 },
            "hostServices": ["session", "webview", "log"],
            "limits": {
                "sessionValueBytes": 1_048_576,
                "sessionTotalBytes": 8_388_608,
                "sessionKeys": 64
            },
            "hostVersion": "1.0"
        })),
        result: None,
        error: None,
    }
}

pub fn decode_frames_from_slice(raw: &[u8]) -> Result<Vec<RpcMessage>, String> {
    let mut reader = BufReader::new(raw);
    let mut out = Vec::new();
    while let Some(msg) = read_frame(&mut reader)? {
        out.push(msg);
    }
    Ok(out)
}
