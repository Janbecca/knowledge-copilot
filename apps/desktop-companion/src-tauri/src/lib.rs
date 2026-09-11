use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use keyring::Entry;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;
use url::Url;

const CREDENTIAL_SERVICE: &str = "xyz.knowledge-copilot.companion";
const CREDENTIAL_USER: &str = "paired-device";
const ROUTING_USER: &str = "active-capture-route";
const EXTENSION_USER: &str = "chrome-extension-connected";
const API_ORIGIN: &str = "https://knowledge-copilot.xyz";
const OAUTH_REDIRECT_URI: &str = "knowledge-copilot://auth/callback";
const OAUTH_TTL_SECONDS: u64 = 600;
const EXTENSION_TTL_SECONDS: u64 = 300;
const EXTENSION_ID: Option<&str> = option_env!("KNOWLEDGE_COPILOT_EXTENSION_ID");

static PENDING_OAUTH: OnceLock<Mutex<Option<PendingOAuth>>> = OnceLock::new();

#[derive(Clone)]
struct PendingOAuth {
    state: String,
    verifier: String,
    created_at: u64,
    authority: String,
    client_id: String,
    audience: Option<String>,
}

#[derive(Deserialize)]
struct AuthConfig {
    enabled: bool,
    authority: Option<String>,
    client_id: Option<String>,
    audience: Option<String>,
    scope: Option<String>,
}

#[derive(Deserialize)]
struct OAuthTokenResponse {
    access_token: String,
}

#[derive(Deserialize)]
struct DevicePairResponse {
    device_token: String,
}

#[derive(Serialize)]
struct LoginResult {
    paired: bool,
    device_name: String,
}

#[derive(Serialize, Deserialize)]
struct ExtensionConnection {
    connected: bool,
    status: String,
    version: Option<String>,
    browser: Option<String>,
    last_seen_at: Option<u64>,
}

#[derive(Serialize)]
struct NativeHostRegistration {
    configured: bool,
    extension_id: Option<String>,
    store_url: String,
    message: String,
}

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
    version: Option<serde_json::Value>,
    browser: Option<String>,
    capture_status: Option<String>,
    presence_status: Option<String>,
    title: Option<String>,
}

fn now_seconds() -> Result<u64, String> {
    SystemTime::now().duration_since(UNIX_EPOCH).map_err(|error| error.to_string()).map(|duration| duration.as_secs())
}

fn random_urlsafe(bytes: usize) -> String {
    let mut value = vec![0u8; bytes];
    getrandom::fill(&mut value).expect("operating system secure random generator is unavailable");
    URL_SAFE_NO_PAD.encode(value)
}

async fn fetch_auth_config() -> Result<AuthConfig, String> {
    let response = reqwest::Client::new()
        .get(format!("{API_ORIGIN}/api/auth/config?client=desktop"))
        .send().await.map_err(|error| format!("无法读取登录配置：{error}"))?;
    if !response.status().is_success() { return Err(format!("登录配置不可用（{}）", response.status())); }
    response.json::<AuthConfig>().await.map_err(|error| format!("登录配置无效：{error}"))
}

#[tauri::command]
async fn begin_oauth_login() -> Result<String, String> {
    let config = fetch_auth_config().await?;
    if !config.enabled { return Err("线上账号登录尚未启用".into()); }
    let authority = config.authority.ok_or_else(|| "登录服务缺少 authority".to_string())?;
    let client_id = config.client_id.ok_or_else(|| "登录服务缺少桌面客户端 ID".to_string())?;
    let verifier = random_urlsafe(48);
    let state = random_urlsafe(32);
    let nonce = random_urlsafe(32);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let mut authorize = Url::parse(&authority).map_err(|_| "登录服务 authority 无效".to_string())?
        .join("authorize").map_err(|_| "无法生成登录地址".to_string())?;
    {
        let mut query = authorize.query_pairs_mut();
        query.append_pair("response_type", "code")
            .append_pair("client_id", &client_id)
            .append_pair("redirect_uri", OAUTH_REDIRECT_URI)
            .append_pair("scope", config.scope.as_deref().unwrap_or("openid profile email device:manage"))
            .append_pair("code_challenge", &challenge)
            .append_pair("code_challenge_method", "S256")
            .append_pair("state", &state)
            .append_pair("nonce", &nonce);
        if let Some(audience) = &config.audience { query.append_pair("audience", audience); }
    }
    let pending = PendingOAuth { state, verifier, created_at: now_seconds()?, authority, client_id, audience: config.audience };
    *PENDING_OAUTH.get_or_init(|| Mutex::new(None)).lock().map_err(|_| "登录状态锁不可用".to_string())? = Some(pending);
    open::that(authorize.as_str()).map_err(|error| format!("无法打开系统浏览器：{error}"))?;
    Ok(authorize.into())
}

#[tauri::command]
async fn complete_oauth_login(callback_url: String) -> Result<LoginResult, String> {
    let callback = Url::parse(&callback_url).map_err(|_| "登录回调地址无效".to_string())?;
    if callback.scheme() != "knowledge-copilot" || callback.host_str() != Some("auth") || callback.path() != "/callback" {
        return Err("登录回调来源无效".into());
    }
    if let Some(error) = callback.query_pairs().find(|(key, _)| key == "error").map(|(_, value)| value.into_owned()) {
        let description = callback.query_pairs().find(|(key, _)| key == "error_description").map(|(_, value)| value.into_owned()).unwrap_or(error);
        return Err(format!("账号登录失败：{description}"));
    }
    let state = callback.query_pairs().find(|(key, _)| key == "state").map(|(_, value)| value.into_owned()).ok_or_else(|| "登录回调缺少 state".to_string())?;
    let code = callback.query_pairs().find(|(key, _)| key == "code").map(|(_, value)| value.into_owned()).ok_or_else(|| "登录回调缺少授权码".to_string())?;
    let pending = {
        let mut guard = PENDING_OAUTH.get_or_init(|| Mutex::new(None)).lock().map_err(|_| "登录状态锁不可用".to_string())?;
        let current = guard.as_ref().ok_or_else(|| "登录请求已失效，请重新开始".to_string())?;
        if current.state != state { return Err("登录安全校验失败，请重新开始".into()); }
        if now_seconds()?.saturating_sub(current.created_at) > OAUTH_TTL_SECONDS { *guard = None; return Err("登录请求已超时，请重新开始".into()); }
        guard.take().expect("pending OAuth exists")
    };
    let token_url = Url::parse(&pending.authority).map_err(|_| "登录服务 authority 无效".to_string())?
        .join("oauth/token").map_err(|_| "无法生成令牌地址".to_string())?;
    let mut form = vec![
        ("grant_type", "authorization_code".to_string()),
        ("client_id", pending.client_id),
        ("code", code),
        ("code_verifier", pending.verifier),
        ("redirect_uri", OAUTH_REDIRECT_URI.to_string()),
    ];
    if let Some(audience) = pending.audience { form.push(("audience", audience)); }
    let client = reqwest::Client::new();
    let token_response = client.post(token_url).form(&form).send().await.map_err(|error| format!("无法交换登录凭证：{error}"))?;
    let token_status = token_response.status();
    if !token_status.is_success() {
        let detail = token_response.text().await.unwrap_or_default();
        return Err(format!("登录凭证交换失败（{token_status}）：{}", detail.chars().take(180).collect::<String>()));
    }
    let token = token_response.json::<OAuthTokenResponse>().await.map_err(|error| format!("登录凭证响应无效：{error}"))?;
    let computer_name = std::env::var("COMPUTERNAME").unwrap_or_else(|_| "Windows 电脑".to_string());
    let device_name = format!("Knowledge Copilot · {}", computer_name.chars().take(48).collect::<String>());
    let pair_response = client.post(format!("{API_ORIGIN}/api/devices/pair"))
        .bearer_auth(token.access_token)
        .json(&serde_json::json!({ "name": device_name, "platform": "windows" }))
        .send().await.map_err(|error| format!("无法配对桌面设备：{error}"))?;
    let pair_status = pair_response.status();
    if !pair_status.is_success() { return Err(format!("桌面设备配对失败（{pair_status}）")); }
    let paired = pair_response.json::<DevicePairResponse>().await.map_err(|error| format!("设备配对响应无效：{error}"))?;
    if !valid_token(&paired.device_token, "kc_device_") { return Err("服务器返回了无效设备凭证".into()); }
    credential_entry()?.set_password(&paired.device_token).map_err(|error| error.to_string())?;
    Ok(LoginResult { paired: true, device_name })
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
fn extension_is_connected() -> bool {
    extension_connection_status().connected
}

#[tauri::command]
fn extension_connection_status() -> ExtensionConnection {
    let stored = Entry::new(CREDENTIAL_SERVICE, EXTENSION_USER)
        .map_err(|error| error.to_string())
        .and_then(|entry| entry.get_password().map_err(|error| error.to_string()))
        .ok()
        .and_then(|value| serde_json::from_str::<ExtensionConnection>(&value).ok());
    let Some(mut connection) = stored else {
        return ExtensionConnection { connected: false, status: "missing".into(), version: None, browser: None, last_seen_at: None };
    };
    let fresh = connection.last_seen_at.and_then(|seen| now_seconds().ok().map(|now| now.saturating_sub(seen) <= EXTENSION_TTL_SECONDS)).unwrap_or(false);
    connection.connected = fresh;
    connection.status = if fresh { "connected" } else { "stale" }.into();
    connection
}

fn valid_extension_id(value: &str) -> bool {
    value.len() == 32 && value.chars().all(|character| ('a'..='p').contains(&character))
}

fn extension_store_url(extension_id: Option<&str>) -> String {
    extension_id.filter(|value| valid_extension_id(value))
        .map(|value| format!("https://chromewebstore.google.com/detail/{value}"))
        .unwrap_or_else(|| "https://chromewebstore.google.com/".into())
}

#[cfg(windows)]
fn install_native_host_registration() -> Result<NativeHostRegistration, String> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let Some(extension_id) = EXTENSION_ID.filter(|value| valid_extension_id(value)) else {
        return Ok(NativeHostRegistration {
            configured: false,
            extension_id: None,
            store_url: extension_store_url(None),
            message: "当前构建尚未注入 Chrome Web Store 扩展 ID".into(),
        });
    };
    let local_app_data = std::env::var_os("LOCALAPPDATA").ok_or_else(|| "LOCALAPPDATA 不可用".to_string())?;
    let bridge_dir = std::path::PathBuf::from(local_app_data).join("KnowledgeCopilot").join("NativeMessaging");
    std::fs::create_dir_all(&bridge_dir).map_err(|error| format!("无法创建 Native Messaging 目录：{error}"))?;
    let manifest_path = bridge_dir.join("xyz.knowledge_copilot.desktop.json");
    let executable = std::env::current_exe().map_err(|error| format!("无法读取桌面程序路径：{error}"))?;
    let manifest = serde_json::json!({
        "name": "xyz.knowledge_copilot.desktop",
        "description": "Narrow native bridge between ChatGPT Capture and Knowledge Copilot Desktop",
        "path": executable.to_string_lossy(),
        "type": "stdio",
        "allowed_origins": [format!("chrome-extension://{extension_id}/")]
    });
    std::fs::write(&manifest_path, serde_json::to_vec_pretty(&manifest).map_err(|error| error.to_string())?)
        .map_err(|error| format!("无法写入 Native Messaging 清单：{error}"))?;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (key, _) = hkcu.create_subkey("Software\\Google\\Chrome\\NativeMessagingHosts\\xyz.knowledge_copilot.desktop")
        .map_err(|error| format!("无法注册 Native Messaging Host：{error}"))?;
    key.set_value("", &manifest_path.to_string_lossy().to_string()).map_err(|error| format!("无法保存 Native Messaging 注册表项：{error}"))?;
    Ok(NativeHostRegistration {
        configured: true,
        extension_id: Some(extension_id.into()),
        store_url: extension_store_url(Some(extension_id)),
        message: "Native Messaging Host 已为当前用户注册".into(),
    })
}

#[cfg(not(windows))]
fn install_native_host_registration() -> Result<NativeHostRegistration, String> {
    Ok(NativeHostRegistration { configured: false, extension_id: None, store_url: extension_store_url(None), message: "当前版本仅支持 Windows 自动注册".into() })
}

#[tauri::command]
fn native_host_registration_status() -> Result<NativeHostRegistration, String> {
    install_native_host_registration()
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

#[tauri::command]
async fn get_desktop_session(session_id: String) -> Result<serde_json::Value, String> {
    if !session_id.starts_with("session_")
        || session_id.len() < 24
        || session_id.len() > 88
        || !session_id.chars().all(|character| character.is_ascii_alphanumeric() || character == '-' || character == '_')
    {
        return Err("会话编号格式不正确".into());
    }
    let device_token = credential_entry()?.get_password().map_err(|_| "桌面端尚未配对，请先登录账号".to_string())?;
    let response = reqwest::Client::new()
        .get(format!("{API_ORIGIN}/api/sessions/{session_id}"))
        .bearer_auth(device_token)
        .send().await.map_err(|error| format!("无法连接知识服务：{error}"))?;
    let status = response.status();
    let value = response.json::<serde_json::Value>().await.unwrap_or_else(|_| serde_json::json!({ "error": format!("HTTP {status}") }));
    if !status.is_success() {
        return Err(value.get("error").and_then(|item| item.as_str()).unwrap_or("无法读取当前知识会话").to_string());
    }
    Ok(value)
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
    if message.message_type == "extension_hello" {
        let connection = ExtensionConnection {
            connected: true,
            status: "connected".into(),
            version: message.version.and_then(|value| value.as_str().map(str::to_string).or_else(|| value.as_u64().map(|number| number.to_string()))),
            browser: message.browser,
            last_seen_at: Some(now_seconds()?),
        };
        let stored = serde_json::to_string(&connection).map_err(|error| error.to_string())?;
        Entry::new(CREDENTIAL_SERVICE, EXTENSION_USER).map_err(|error| error.to_string())?.set_password(&stored).map_err(|error| error.to_string())?;
        return Ok(serde_json::json!({ "ok": true, "connected": true, "heartbeat_seconds": 120 }));
    }
    let conversation_ref = message.conversation_ref.as_deref().ok_or_else(|| "conversation_ref is required".to_string())?;
    match message.message_type.as_str() {
        "wake" => {
            let resolved = device_post("/api/conversation-bindings/resolve", serde_json::json!({ "source_host": source_host, "conversation_ref": conversation_ref, "create": false }))?;
            let session_id = resolved.pointer("/binding/session_id").and_then(|value| value.as_str()).ok_or_else(|| "conversation binding not found".to_string())?;
            let mut deep_link = Url::parse("knowledge-copilot://conversation").map_err(|error| error.to_string())?;
            deep_link.query_pairs_mut().append_pair("session", session_id).append_pair("source", source_host);
            open::that(deep_link.as_str()).map_err(|error| error.to_string())?;
            Ok(serde_json::json!({ "ok": true, "session_id": session_id }))
        }
        "grant_consent" => {
            device_post("/api/device/consents", serde_json::json!({ "source_host": source_host, "conversation_ref": conversation_ref, "scope": "conversation-text" }))?;
            let resolved = device_post("/api/conversation-bindings/resolve", serde_json::json!({ "source_host": source_host, "conversation_ref": conversation_ref, "create": true, "title": message.title }))?;
            Ok(serde_json::json!({ "ok": true, "binding": resolved.get("binding"), "session": resolved.get("session") }))
        }
        "get_binding" => {
            let resolved = device_post("/api/conversation-bindings/resolve", serde_json::json!({ "source_host": source_host, "conversation_ref": conversation_ref, "create": false }))?;
            Ok(serde_json::json!({ "ok": true, "binding": resolved.get("binding"), "session": resolved.get("session") }))
        }
        "set_binding_status" => {
            let status = message.capture_status.ok_or_else(|| "capture_status is required".to_string())?;
            let result = device_post("/api/conversation-bindings/status", serde_json::json!({ "source_host": source_host, "conversation_ref": conversation_ref, "status": status }))?;
            Ok(serde_json::json!({ "ok": true, "binding": result.get("binding") }))
        }
        "presence" => {
            let status = message.presence_status.ok_or_else(|| "presence_status is required".to_string())?;
            let result = device_post("/api/conversation-bindings/presence", serde_json::json!({ "source_host": source_host, "conversation_ref": conversation_ref, "status": status }))?;
            if status == "foreground" && result.pointer("/binding/capture_status").and_then(|value| value.as_str()) == Some("active") {
                if let Some(session_id) = result.pointer("/binding/session_id").and_then(|value| value.as_str()) {
                    let mut deep_link = Url::parse("knowledge-copilot://conversation").map_err(|error| error.to_string())?;
                    deep_link.query_pairs_mut().append_pair("session", session_id).append_pair("source", source_host);
                    open::that(deep_link.as_str()).map_err(|error| error.to_string())?;
                }
            } else if status == "background" || status == "closed" {
                open::that("knowledge-copilot://collapse").map_err(|error| error.to_string())?;
            }
            Ok(serde_json::json!({ "ok": true, "binding": result.get("binding") }))
        }
        "revoke_consent" => {
            device_post("/api/device/consents/revoke", serde_json::json!({ "source_host": source_host, "conversation_ref": conversation_ref }))?;
            Ok(serde_json::json!({ "ok": true }))
        }
        "capture_turn" => {
            device_post("/api/conversation-bindings/capture", serde_json::json!({
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
            #[cfg(windows)]
            if let Err(error) = install_native_host_registration() {
                eprintln!("Native Messaging registration skipped: {error}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![begin_oauth_login, complete_oauth_login, save_device_credential, device_is_paired, extension_is_connected, extension_connection_status, native_host_registration_status, clear_device_credential, consume_wake_token, get_desktop_session])
        .run(tauri::generate_context!())
        .expect("error while running Knowledge Copilot Companion");
}
