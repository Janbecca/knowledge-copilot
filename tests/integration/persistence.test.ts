import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { KnowledgeStore } from "../../packages/storage/index.js";
import { KnowledgeService } from "../../packages/knowledge-engine/service.js";
import { MockKnowledgeExtractor } from "../../packages/knowledge-engine/mock-extractor.js";
import { migrations } from "../../packages/storage/migrations.js";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("SQLite persistence", () => {
  it("survives database restart without an API key", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kc-"));
    dirs.push(dir);
    const file = join(dir, "db.sqlite");
    let store = new KnowledgeStore(file);
    let service = new KnowledgeService(store, new MockKnowledgeExtractor());
    const session = service.start({ extraction_mode: "server_llm" });
    await service.capture({ session_id: session.session_id, user_message: "esptool read-flash", assistant_message: "backup" });
    store.close();
    store = new KnowledgeStore(file);
    service = new KnowledgeService(store, new MockKnowledgeExtractor());
    expect(service.get(session.session_id)).toMatchObject({ session: { extraction_mode: "server_llm" } });
    expect(service.get(session.session_id).cards).toHaveLength(1);
    store.close();
  });

  it("migrates existing sessions to the safe host-structured default", () => {
    const dir = mkdtempSync(join(tmpdir(), "kc-migration-"));
    dirs.push(dir);
    const file = join(dir, "db.sqlite");
    const legacy = new DatabaseSync(file);
    legacy.exec(migrations[0]!.sql);
    legacy.exec(migrations[1]!.sql);
    legacy.prepare("INSERT INTO schema_migrations VALUES(?,?)").run(1, new Date().toISOString());
    legacy.prepare("INSERT INTO schema_migrations VALUES(?,?)").run(2, new Date().toISOString());
    legacy.prepare("INSERT INTO sessions(session_id,title,status,capture_scope,created_at,updated_at,last_captured_turn,source_host) VALUES(?,?,?,?,?,?,?,?)")
      .run("session_legacy", "Legacy", "active", JSON.stringify({ mode: "all", topic: null }), new Date().toISOString(), new Date().toISOString(), 0, "legacy");
    legacy.close();

    const store = new KnowledgeStore(file);
    expect(store.getSession("session_legacy")?.extraction_mode).toBe("host_structured");
    expect(store.db.prepare("SELECT version FROM schema_migrations ORDER BY version").all()).toHaveLength(3);
    store.close();
  });
});
