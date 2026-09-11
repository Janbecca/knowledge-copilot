import { describe, expect, it } from "vitest";
import { LLMKnowledgeExtractor } from "../../packages/knowledge-engine/llm-extractor.js";
import type { ExtractionContext } from "../../packages/knowledge-engine/types.js";

function context(): ExtractionContext {
  return {
    session: { session_id: "session_test", title: "Test", status: "active", capture_scope: { mode: "all", topic: null }, created_at: "2026-08-29T00:00:00.000Z", updated_at: "2026-08-29T00:00:00.000Z", last_captured_turn: 0, source_host: "test", extraction_mode: "server_llm" },
    turn: { turn_id: "turn_test", session_id: "session_test", user_message: "Why idempotency?", assistant_message: "Stable keys prevent duplicate commits.", tool_observations: [], created_at: "2026-08-29T00:00:00.000Z", source_reference: null, idempotency_key: "turn-key", cursor: 1 },
    activeCards: [],
  };
}

function completion(content: unknown, status = 200): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }] }), { status, headers: { "content-type": "application/json" } });
}

describe("LLM knowledge extractor", () => {
  it("requests the compact knowledge-item contract and maps it to canonical events", async () => {
    const requests: Array<{ url: string; body: any }> = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return completion({ knowledge_items: [{ type: "concept", title: "Idempotent retry", summary: "Stable keys and atomic commits prevent duplicate writes.", tags: ["reliability"], confidence: "high" }] });
    }) as typeof fetch;
    const extractor = new LLMKnowledgeExtractor({ baseUrl: "https://provider.test/", apiKey: "test-secret", model: "test-model", fetchImpl });
    const result = await extractor.extract(context());
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({ event: "add", card: { title: "Idempotent retry", confidence: "high" } });
    expect(requests[0]).toMatchObject({ url: "https://provider.test/chat/completions", body: { model: "test-model", max_tokens: 1600, response_format: { type: "json_object" } } });
    expect(requests[0]!.body.messages[0].content).toContain('{"knowledge_items": [...]}');
    expect(requests[0]!.body.messages[0].content).toContain("Do not create IDs");
  });

  it("uses schema feedback for one bounded repair", async () => {
    const requests: any[] = [];
    const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)));
      return requests.length === 1 ? completion({ events: [] }) : completion({ knowledge_items: [] });
    }) as typeof fetch;
    const extractor = new LLMKnowledgeExtractor({ baseUrl: "https://provider.test", apiKey: "test-secret", model: "test-model", maxRepairs: 1, fetchImpl });
    await expect(extractor.extract(context())).resolves.toEqual({ events: [] });
    expect(requests).toHaveLength(2);
    expect(JSON.parse(requests[1].messages[1].content).validation_feedback).toMatch(/knowledge_items/);
  });

  it("does not expose response bodies or credentials in HTTP errors", async () => {
    const fetchImpl = (async () => new Response("sensitive-provider-body", { status: 401 })) as typeof fetch;
    const extractor = new LLMKnowledgeExtractor({ baseUrl: "https://provider.test", apiKey: "test-secret", model: "test-model", fetchImpl });
    await expect(extractor.extract(context())).rejects.toThrow("LLM extractor HTTP 401");
  });
});
