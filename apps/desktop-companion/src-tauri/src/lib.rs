use keyring::Entry;
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use tauri::Manager;

const CREDENTIAL_SERVICE: &str = "xyz.knowledge-copilot.companion";
const CREDENTIAL_USER: &str = "paired-device";
const ROUTING_USER: &str = "active-capture-route";
const API_ORIGIN: &str = "https://knowledge-copilot.xyz";

#[derive(Serialize, Deserialize)]
struct WakeIntent {
    session_id: Option<String>,
    source_host: String,
    user_id: String,
    extraction_mode: Option<String>,
}

#[derive(Deserialize)]
struct NativeMessage {
    #[serde(rename = "type")]
    message_type: String,
    source_host: Option<String>,
    conversation_ref: Option<String>,
    user_message: Option<String>,
    assistant_message: Option<String>,
    idempotency_key: Option<String>,
}

fn credential_entry() -> Result<Entry, String> {
    Entry::new(CREDENTIAL_SERVICE, CREDENTIAL_USER).map_err(|error| error.to_string())
}

fn valid_token(value: &str, prefix: &str) -> bool {
    value.starts_with(prefix)
        && value.len() >= prefix.len() + 32
        && value.len() <= 160
        && value.chars().all(|character| character.is_ascii_alphanumeric() || character == '_' || character == '-')
}

#[tauri::command]
fn save_device_credential(device_token: String) -> Result<(), String> {
    if !valid_token(&device_token, "kc_device_") { return Err("设备令牌格式不正确".into()); }
    credential_entry()?.set_password(&device_token).map_err(|error| error.to_string())
}

#[tauri::command]
fn device_is_paired() -> bool {
    credential_entry().and_then(|entry| entry.get_password().map_err(|error| error.to_string())).is_ok()
}

#[tauri::command]
fn clear_device_credential() -> Result<(), String> {
    match credential_entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
async fn consume_wake_token(wake_token: String) -> Result<WakeIntent, String> {
    if !valid_token(&wake_token, "kc_wake_") { return Err("唤醒令牌格式不正确".into()); }
    let device_token = credential_entry()?.get_password().map_err(|_| "桌面端尚未配对，请先在设置中保存设备令牌".to_string())?;
    let response = reqwest::Client::new()
        .post(format!("{API_ORIGIN}/api/wake-tokens/consume"))
        .bearer_auth(device_token)
        .json(&serde_json::json!({ "wake_token": wake_token }))
        .send().await.map_err(|error| format!("无法连接知识服务：{error}"))?;
    if !response.status().is_success() {
        let status = response.status();
        return Err(format!("唤醒请求已失效或无权使用（{status}）"));
    }
    let intent = response.json::<WakeIntent>().await.map_err(|error| format!("唤醒响应无效：{error}"))?;
    if intent.session_id.is_some() {
        let route = serde_json::to_string(&intent).map_err(|error| error.to_string())?;
        Entry::new(CREDENTIAL_SERVICE, ROUTING_USER).map_err(|error| error.to_string())?.set_password(&route).map_err(|error| error.to_string())?;
    }
    Ok(intent)
}

fn native_response(value: serde_json::Value) -> Result<(), String> {
    let bytes = serde_json::to_vec(&value).map_err(|error| error.to_string())?;
    if bytes.len() > 1_048_576 { return Err("native response too large".into()); }
    let mut output = std::io::stdout().lock();
    output.write_all(&(bytes.len() as u32).to_le_bytes()).map_err(|error| error.to_string())?;
    output.write_all(&bytes).map_err(|error| error.to_string())?;
    output.flush().map_err(|error| error.to_string())
}

fn device_post(path: &str, payload: serde_json::Value) -> Result<serde_json::Value, String> {
    let token = credential_entry()?.get_password().map_err(|_| "desktop device is not paired".to_string())?;
    let response = reqwest::blocking::Client::new().post(format!("{API_ORIGIN}{path}")).bearer_auth(token).json(&payload).send().map_err(|error| error.to_string())?;
    let status = response.status();
    let value = response.json::<serde_json::Value>().unwrap_or_else(|_| serde_json::json!({ "error": format!("HTTP {status}") }));
    if !status.is_success() { return Err(value.get("error").and_then(|item| item.as_str()).unwrap_or("request failed").to_string()); }
    Ok(value)
}

fn handle_native_message(message: NativeMessage) -> Result<serde_json::Value, String> {
    let source_host = message.source_host.as_deref().unwrap_or("chatgpt");
    let conversation_ref = message.conversation_ref.as_deref().ok_or_else(|| "conversation_ref is required".to_string())?;
    match message.message_type.as_str() {
        "wake" => { open::that("knowledge-copilot://open").map_err(|error| error.to_string())?; Ok(serde_json::json!({ "ok": true })) }
        "grant_consent" => {
            device_post("/api/device/consents", serde_json::json!({ "source_host": source_host, "conversation_ref": conversation_ref, "scope": "conversation-text" }))?;
            Ok(serde_json::json!({ "ok": true }))
        }
        "revoke_consent" => {
            device_post("/api/device/consents/revoke", serde_json::json!({ "source_host": source_host, "conversation_ref": conversation_ref }))?;
            Ok(serde_json::json!({ "ok": true }))
        }
        "capture_turn" => {
            let route_raw = Entry::new(CREDENTIAL_SERVICE, ROUTING_USER).map_err(|error| error.to_string())?.get_password().map_err(|_| "no active desktop learning session; invoke Knowledge Copilot first".to_string())?;
            let route: WakeIntent = serde_json::from_str(&route_raw).map_err(|_| "active desktop route is invalid".to_string())?;
            if route.extraction_mode.as_deref() == Some("host_structured") {
                return Err("当前会话选择了“当前 AI 直接整理”；该模式必须由 ChatGPT 的 MCP 工具提交结构化知识点，浏览器扩展不会改用服务器 LLM".into());
            }
            let session_id = route.session_id.ok_or_else(|| "no active session".to_string())?;
            device_post(&format!("/api/sessions/{session_id}/capture"), serde_json::json!({
                "source_host": source_host,
                "conversation_ref": conversation_ref,
                "user_message": message.user_message.ok_or_else(|| "user_message is required".to_string())?,
                "assistant_message": message.assistant_message.ok_or_else(|| "assistant_message is required".to_string())?,
                "idempotency_key": message.idempotency_key.ok_or_else(|| "idempotency_key is required".to_string())?
            }))?;
            Ok(serde_json::json!({ "ok": true }))
        }
        _ => Err("unsupported native message type".into()),
    }
}

pub fn run_native_messaging() {
    loop {
        let mut length = [0u8; 4];
        match std::io::stdin().lock().read_exact(&mut length) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(_) => break,
        }
        let length = u32::from_le_bytes(length) as usize;
        if length == 0 || length > 1_048_576 { let _ = native_response(serde_json::json!({ "ok": false, "error": "native message size rejected" })); break; }
        let mut bytes = vec![0u8; length];
        if std::io::stdin().lock().read_exact(&mut bytes).is_err() { break; }
        let response = serde_json::from_slice::<NativeMessage>(&bytes).map_err(|error| error.to_string()).and_then(handle_native_message)
            .unwrap_or_else(|error| serde_json::json!({ "ok": false, "error": error }));
        if native_response(response).is_err() { break; }
    }
}

pub fn run_hook_bridge() {
    let mut input = String::new();
    if std::io::stdin().read_to_string(&mut input).is_err() { return; }
    let response = serde_json::from_str::<NativeMessage>(&input).map_err(|error| error.to_string()).and_then(handle_native_message)
        .unwrap_or_else(|error| serde_json::json!({ "ok": false, "error": error }));
    let _ = serde_json::to_writer(std::io::stdout(), &response);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }));
    }
    builder
        .plugin(tauri_plugin_deep_link::init())
        .setup(|_app| {
            #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                _app.deep_link().register_all()?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![save_device_credential, device_is_paired, clear_device_credential, consume_wake_token])
        .run(tauri::generate_context!())
        .expect("error while running Knowledge Copilot Companion");
}
