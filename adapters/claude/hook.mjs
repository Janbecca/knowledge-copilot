import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const INVOKE = /(?:@\s*knowledge\s*copilot|@\s*知识(?:副驾驶|驾驶舱)|开启知识沉淀|打开知识驾驶舱)/i;
const PAUSE = /(?:暂停知识沉淀|暂停知识驾驶舱)/i;
const STOP = /(?:停止知识沉淀|关闭知识驾驶舱|结束知识会话)/i;
const input = JSON.parse(await readStdin());
const sessionId = String(input.session_id ?? "");
const conversationRef = `claude-code:${sessionId}`;
const stateRoot = join(tmpdir(), "knowledge-copilot-claude-hooks");
const statePath = join(stateRoot, `${createHash("sha256").update(sessionId).digest("hex")}.json`);
const executable = process.env.KNOWLEDGE_COPILOT_DESKTOP_EXE;

if (!sessionId || !executable) process.exit(0);
await mkdir(stateRoot, { recursive: true });
await chmod(stateRoot, 0o700).catch(() => undefined);
let state = await readState();

if (input.hook_event_name === "UserPromptSubmit") {
  const prompt = String(input.prompt ?? "");
  if (INVOKE.test(prompt)) {
    const granted = bridge({ type: "grant_consent", source_host: "claude-code", conversation_ref: conversationRef });
    if (granted.ok) { state = { active: true, prompt, updated_at: new Date().toISOString() }; bridge({ type: "wake", source_host: "claude-code", conversation_ref: conversationRef }); }
  } else if (STOP.test(prompt)) {
    bridge({ type: "revoke_consent", source_host: "claude-code", conversation_ref: conversationRef }); state = { active: false, prompt: "", updated_at: new Date().toISOString() };
  } else if (PAUSE.test(prompt)) state = { ...state, active: false, prompt, updated_at: new Date().toISOString() };
  else state = { ...state, prompt, updated_at: new Date().toISOString() };
  await saveState(state); process.exit(0);
}

if (input.hook_event_name === "Stop" && state.active && !input.stop_hook_active) {
  const result = bridge({ type: "capture_turn", source_host: "claude-code", conversation_ref: conversationRef, user_message: state.prompt, assistant_message: String(input.last_assistant_message ?? ""), idempotency_key: `claude-code:${sessionId}:${String(input.prompt_id ?? createHash("sha256").update(`${state.prompt}:${input.last_assistant_message ?? ""}`).digest("hex"))}` });
  if (!result.ok && String(result.error ?? "").includes("当前会话选择了")) {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "Stop", additionalContext: "Knowledge Copilot 当前处于 host_structured 模式。请立即调用 knowledge-copilot MCP 的 capture_active_learning_turn，使用刚才的用户问题、完整回答和你整理的 knowledge_items 保存本轮；完成后即可结束，不要再次解释这条 hook 提示。" } }));
  }
  process.exit(0);
}

if (input.hook_event_name === "SessionEnd") {
  if (state.active) bridge({ type: "revoke_consent", source_host: "claude-code", conversation_ref: conversationRef });
  await rm(statePath, { force: true });
}

function bridge(payload) {
  const result = spawnSync(executable, ["--knowledge-copilot-hook"], { input: JSON.stringify(payload), encoding: "utf8", windowsHide: true, timeout: 20_000 });
  if (result.error || result.status !== 0) return { ok: false, error: result.error?.message ?? result.stderr ?? "desktop bridge failed" };
  try { return JSON.parse(result.stdout || "{}"); } catch { return { ok: false, error: "desktop bridge returned invalid JSON" }; }
}

async function readState() {
  try { return JSON.parse(await readFile(statePath, "utf8")); } catch { return { active: false, prompt: "", updated_at: new Date().toISOString() }; }
}
async function saveState(value) { await writeFile(statePath, JSON.stringify(value), { encoding: "utf8", mode: 0o600 }); }
async function readStdin() { const chunks = []; for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk)); return Buffer.concat(chunks).toString("utf8"); }
