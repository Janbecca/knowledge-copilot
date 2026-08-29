import { describe, expect, it } from "vitest";
import type { ExtractionContext, KnowledgeExtractor } from "../../packages/knowledge-engine/types.js";
import { KnowledgeService } from "../../packages/knowledge-engine/service.js";
import { KnowledgeStore } from "../../packages/storage/index.js";

class CountingExtractor implements KnowledgeExtractor {
  readonly name = "counting";
  calls = 0;
  fail = false;

  async extract(_context: ExtractionContext) {
    this.calls += 1;
    if (this.fail) throw new Error("provider unavailable");
    return { events: [] };
  }
}

describe("dual extraction modes", () => {
  it("defaults to host structured input without calling the server extractor", async () => {
    const store = new KnowledgeStore(":memory:");
    const extractor = new CountingExtractor();
    const service = new KnowledgeService(store, extractor);
    const session = service.start();
    expect(session.extraction_mode).toBe("host_structured");
    await expect(service.capture({ session_id: session.session_id, user_message: "问题", assistant_message: "答案" }))
      .rejects.toThrow(/requires knowledge_items/);
    const result = await service.capture({
      session_id: session.session_id,
      user_message: "什么是缓存穿透？",
      assistant_message: "不存在的键会持续访问数据库。",
      knowledge_items: [{ type: "concept", title: "缓存穿透", summary: "无效键绕过缓存并访问数据库。" }],
    });
    expect(result.new_cards).toHaveLength(1);
    expect(extractor.calls).toBe(0);
    store.close();
  });

  it("uses the configured extractor in server mode and ignores host items", async () => {
    const store = new KnowledgeStore(":memory:");
    const extractor = new CountingExtractor();
    const service = new KnowledgeService(store, extractor);
    const session = service.start({ extraction_mode: "server_llm" });
    await service.capture({
      session_id: session.session_id,
      user_message: "问题",
      assistant_message: "答案",
      knowledge_items: [{ type: "concept", title: "不应直接保存", summary: "服务器模式忽略这一项。" }],
    });
    expect(extractor.calls).toBe(1);
    expect(store.listCards(session.session_id)).toHaveLength(0);
    store.close();
  });

  it("does not consume a turn or cursor when server extraction fails", async () => {
    const store = new KnowledgeStore(":memory:");
    const extractor = new CountingExtractor();
    extractor.fail = true;
    const service = new KnowledgeService(store, extractor);
    const session = service.start({ extraction_mode: "server_llm" });
    const input = { session_id: session.session_id, user_message: "问题", assistant_message: "答案", source_reference: "retryable-turn" };
    await expect(service.capture(input)).rejects.toThrow("provider unavailable");
    expect(store.listTurns(session.session_id)).toHaveLength(0);
    expect(store.getSession(session.session_id)?.last_captured_turn).toBe(0);
    extractor.fail = false;
    const retried = await service.capture(input);
    expect(retried).toMatchObject({ cursor: 1, idempotent_replay: false });
    store.close();
  });

  it("persists mode changes on the session", () => {
    const store = new KnowledgeStore(":memory:");
    const service = new KnowledgeService(store, new CountingExtractor());
    const session = service.start();
    expect(service.changeExtractionMode({ session_id: session.session_id, extraction_mode: "server_llm" }))
      .toMatchObject({ previous_extraction_mode: "host_structured", session: { extraction_mode: "server_llm" }, server_extractor: "counting" });
    expect(store.getSession(session.session_id)?.extraction_mode).toBe("server_llm");
    store.close();
  });
});
