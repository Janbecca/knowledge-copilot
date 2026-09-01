fn main() {
    println!("cargo:rerun-if-env-changed=KNOWLEDGE_COPILOT_EXTENSION_ID");
    tauri_build::build()
}
