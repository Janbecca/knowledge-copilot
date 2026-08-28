import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { createMcpServer } from "../../mcp-server/server.js";
import { service as createService } from "../helpers.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanup.length) await cleanup.pop()!(); });
function firstText(result: unknown): string {
  return (result as { content: Array<{ text?: string }> }).content[0]?.text ?? "";
}

async function harness() {
  const fixture = createService();
  const server = createMcpServer(fixture.service);
  const client = new Client({ name: "contract-test", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  cleanup.push(async () => { await client.close(); await server.close(); fixture.store.close(); });
  return client;
}

const readTools = new Set([
  "get_learning_session", "list_knowledge_cards", "get_knowledge_card",
  "list_learning_debts", "open_knowledge_panel",
]);
const destructiveTools = new Set([
  "revise_knowledge_card",
  "change_capture_status", "change_card_learning_status",
]);
const idempotentTools = new Set([
  ...readTools, "capture_conversation_turn", "capture_active_learning_turn", "revise_knowledge_card", "rename_learning_session", "launch_knowledge_copilot",
]);

describe("MCP public tool contract", () => {
  it("declares output schemas and conservative risk annotations for every tool", async () => {
    const client = await harness();
    const listed = await client.listTools();
    expect(listed.tools).toHaveLength(14);
    for (const tool of listed.tools) {
      expect(tool.outputSchema).toMatchObject({ type: "object" });
      expect(tool.annotations?.openWorldHint).toBe(false);
      expect(tool.annotations?.readOnlyHint).toBe(readTools.has(tool.name));
      expect(tool.annotations?.destructiveHint).toBe(destructiveTools.has(tool.name));
      expect(tool.annotations?.idempotentHint).toBe(idempotentTools.has(tool.name));
      expect(tool.title).toBeTruthy();
      expect(tool.description).toBeTruthy();
    }
    const launch = listed.tools.find(tool => tool.name === "launch_knowledge_copilot")!;
    expect(launch._meta).toMatchObject({ ui: { resourceUri: "ui://knowledge-copilot/panel-v3.html" }, "openai/outputTemplate": "ui://knowledge-copilot/panel-v3.html" });
  });

  it("binds later captures to the ChatGPT conversation without another mention", async () => {
    const client = await harness();
    const meta = { "openai/session": "chat-contract-1", "openai/subject": "user-contract-1" };
    const launched = await client.callTool({
      name: "launch_knowledge_copilot",
      arguments: { title: "缓存机制" },
      _meta: meta,
    });
    const session = launched.structuredContent as { session: { session_id: string } };

    const captured = await client.callTool({
      name: "capture_active_learning_turn",
      arguments: {
        user_message: "为什么缓存穿透会压垮数据库？",
        assistant_message: "不存在的键无法命中缓存，请求会反复落到数据库；可用空值缓存或布隆过滤器缓解。",
        knowledge_items: [{
          type: "concept",
          title: "缓存穿透的形成机制",
          summary: "不存在的键无法命中缓存，重复请求会持续访问数据库。",
          mechanism: "缓存层没有对应键，每次请求都会继续查询后端存储。",
          transfer: ["可通过空值缓存、布隆过滤器或入口校验减少无效查询。"],
          tags: ["缓存", "数据库"],
          confidence: "high",
        }],
        source_reference: "chat-contract-turn-2",
      },
      _meta: meta,
    });
    expect(captured.structuredContent).toMatchObject({ cursor: 1, session_status: "active" });

    const relaunched = await client.callTool({
      name: "launch_knowledge_copilot",
      arguments: { title: "不应创建新会话" },
      _meta: meta,
    });
    expect(relaunched.structuredContent).toMatchObject({
      session: { session_id: session.session.session_id, title: "缓存机制" },
      cursor: 1,
      capture_policy: "continuous_until_paused",
      next_tool: "capture_active_learning_turn",
    });
  });

  it("returns schema-valid structured results for positive and empty workflows", async () => {
    const client = await harness();
    const started = await client.callTool({ name: "start_learning_session", arguments: { title: "Contract" } });
    const session = started.structuredContent as { session_id: string };
    expect(session.session_id).toMatch(/^session_/);
    expect((await client.callTool({ name: "rename_learning_session", arguments: { session_id: session.session_id, title: "GPT 自主标题" } })).structuredContent).toMatchObject({ title: "GPT 自主标题" });

    const launched = await client.callTool({ name: "launch_knowledge_copilot", arguments: { title: "自动打开的笔记" } });
    expect(launched.structuredContent).toMatchObject({ session: { title: "自动打开的笔记" }, cursor: 0, cards: [] });

    const empty = await client.callTool({ name: "list_knowledge_cards", arguments: { session_id: session.session_id } });
    expect(empty.structuredContent).toMatchObject({ cursor: 0, cards: [] });

    const captured = await client.callTool({ name: "capture_conversation_turn", arguments: {
      session_id: session.session_id,
      user_message: "运行 esptool read-flash 保存固件",
      assistant_message: "读取完成，请验证文件大小和哈希",
      source_reference: "contract-turn-1",
    } });
    expect(captured.structuredContent).toMatchObject({ cursor: 1, idempotent_replay: false, session_status: "active" });
    const capture = captured.structuredContent as { new_cards: Array<{ card_id: string; revision: number }> };
    const card = capture.new_cards[0]!;

    const replay = await client.callTool({ name: "capture_conversation_turn", arguments: {
      session_id: session.session_id,
      user_message: "运行 esptool read-flash 保存固件",
      assistant_message: "读取完成，请验证文件大小和哈希",
      source_reference: "contract-turn-1",
    } });
    expect(replay.structuredContent).toMatchObject({ cursor: 1, idempotent_replay: true });

    expect((await client.callTool({ name: "get_learning_session", arguments: { session_id: session.session_id } })).structuredContent).toMatchObject({ cursor: 1 });
    expect((await client.callTool({ name: "get_knowledge_card", arguments: { card_id: card.card_id } })).structuredContent).toMatchObject({ card: { card_id: card.card_id } });
    const revisionInput = { card_id: card.card_id, expected_revision: card.revision, patch: { summary: "人工修订" }, reason: "contract test" };
    expect((await client.callTool({ name: "revise_knowledge_card", arguments: revisionInput })).structuredContent).toMatchObject({ card_id: card.card_id, revision: 2 });
    const conflict = await client.callTool({ name: "revise_knowledge_card", arguments: revisionInput });
    expect(conflict.isError).toBe(true);
    expect(JSON.parse(firstText(conflict))).toMatchObject({ error: { code: "conflict" } });
    expect((await client.callTool({ name: "change_card_learning_status", arguments: { card_id: card.card_id, status: "review" } })).structuredContent).toMatchObject({ card_id: card.card_id, revision: 3, learning_status: "review" });
    const invalidPatch = await client.callTool({ name: "revise_knowledge_card", arguments: { card_id: card.card_id, expected_revision: 3, patch: { revision: 0 }, reason: "invalid contract fixture" } });
    expect(JSON.parse(firstText(invalidPatch))).toEqual({ error: { code: "internal_error", message: "operation failed" } });
    expect((await client.callTool({ name: "change_capture_status", arguments: { session_id: session.session_id, status: "paused" } })).structuredContent).toMatchObject({ previous_status: "active", resume_from_cursor: null });
    expect((await client.callTool({ name: "list_learning_debts", arguments: { session_id: session.session_id } })).structuredContent).toMatchObject({ cursor: 1, learning_debts: [] });
    expect((await client.callTool({ name: "export_learning_package", arguments: { session_id: session.session_id, format: "markdown" } })).structuredContent).toMatchObject({ format: "markdown", source_cursor: 1 });
    expect((await client.callTool({ name: "open_knowledge_panel", arguments: { session_id: session.session_id } })).structuredContent).toMatchObject({ cursor: 1 });
  });

  it("rejects invalid parameters and returns stable domain errors", async () => {
    const client = await harness();
    const invalid = await client.callTool({ name: "list_knowledge_cards", arguments: {} });
    expect(invalid.isError).toBe(true);
    expect(firstText(invalid)).toMatch(/Invalid arguments.*session_id/i);

    const missing = await client.callTool({ name: "get_learning_session", arguments: { session_id: "session_missing" } });
    expect(missing.isError).toBe(true);
    expect(JSON.parse(firstText(missing))).toEqual({
      error: { code: "not_found", message: "session not found" },
    });
  });
});
