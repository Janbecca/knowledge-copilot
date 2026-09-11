fn main() {
    let first_argument = std::env::args().nth(1);
    if first_argument.as_deref() == Some("--knowledge-copilot-hook") { knowledge_copilot_companion_lib::run_hook_bridge(); }
    else if first_argument.is_some_and(|argument| argument.starts_with("chrome-extension://")) { knowledge_copilot_companion_lib::run_native_messaging(); }
    else { knowledge_copilot_companion_lib::run(); }
}
