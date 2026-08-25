import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { CardEvent, KnowledgeCard } from "../card-protocol/index.js";
import type { Session, Turn } from "../shared/index.js";
import { migrations } from "./migrations.js";

export class KnowledgeStore {
  readonly db: DatabaseSync;
  constructor(public readonly filename = process.env.KNOWLEDGE_COPILOT_DB ?? "./data/knowledge-copilot.sqlite") {
    if (filename !== ":memory:") mkdirSync(dirname(resolve(filename)), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;");
    this.migrate();
  }
  migrate(): void {
    this.db.exec("CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
    for (const migration of migrations) {
      const row = this.db.prepare("SELECT version FROM schema_migrations WHERE version=?").get(migration.version);
      if (!row) {
        this.db.exec("BEGIN");
        try { this.db.exec(migration.sql); this.db.prepare("INSERT INTO schema_migrations VALUES(?,?)").run(migration.version, new Date().toISOString()); this.db.exec("COMMIT"); }
        catch (error) { this.db.exec("ROLLBACK"); throw error; }
      }
    }
  }
  close(): void { this.db.close(); }
  createSession(session: Session): Session {
    this.db.prepare("INSERT INTO sessions VALUES(?,?,?,?,?,?,?,?)").run(session.session_id, session.title, session.status, JSON.stringify(session.capture_scope), session.created_at, session.updated_at, session.last_captured_turn, session.source_host);
    return session;
  }
  getSession(id: string): Session | null {
    const r = this.db.prepare("SELECT * FROM sessions WHERE session_id=?").get(id) as Record<string, unknown> | undefined;
    return r ? { ...r, capture_scope: JSON.parse(String(r.capture_scope)) } as Session : null;
  }
  updateSession(session: Session): void {
    this.db.prepare("UPDATE sessions SET title=?,status=?,capture_scope=?,updated_at=?,last_captured_turn=?,source_host=? WHERE session_id=?")
      .run(session.title, session.status, JSON.stringify(session.capture_scope), session.updated_at, session.last_captured_turn, session.source_host, session.session_id);
  }
  findTurnByKey(sessionId: string, key: string): Turn | null {
    const r = this.db.prepare("SELECT * FROM turns WHERE session_id=? AND idempotency_key=?").get(sessionId, key) as Record<string, unknown> | undefined;
    return r ? this.mapTurn(r) : null;
  }
  insertTurn(turn: Turn): void {
    this.db.prepare("INSERT INTO turns VALUES(?,?,?,?,?,?,?,?,?)").run(turn.turn_id, turn.session_id, turn.user_message, turn.assistant_message, JSON.stringify(turn.tool_observations), turn.created_at, turn.source_reference, turn.idempotency_key, turn.cursor);
  }
  listTurns(sessionId: string): Turn[] {
    return (this.db.prepare("SELECT * FROM turns WHERE session_id=? ORDER BY cursor").all(sessionId) as Record<string, unknown>[]).map(r => this.mapTurn(r));
  }
  private mapTurn(r: Record<string, unknown>): Turn { return { ...r, tool_observations: JSON.parse(String(r.tool_observations)) } as Turn; }
  getCard(cardId: string): KnowledgeCard | null {
    const r = this.db.prepare("SELECT payload FROM cards WHERE card_id=?").get(cardId) as {payload:string}|undefined;
    return r ? JSON.parse(r.payload) : null;
  }
  listCards(sessionId: string, options: { sinceCursor?: number; includeInactive?: boolean; type?: string } = {}): KnowledgeCard[] {
    let sql = "SELECT payload FROM cards WHERE session_id=?"; const args: (string|number)[] = [sessionId];
    if (!options.includeInactive) sql += " AND lifecycle='active'";
    if (options.sinceCursor !== undefined) { sql += " AND updated_cursor>?"; args.push(options.sinceCursor); }
    if (options.type) { sql += " AND type=?"; args.push(options.type); }
    sql += " ORDER BY updated_cursor DESC, title";
    return (this.db.prepare(sql).all(...args) as {payload:string}[]).map(r => JSON.parse(r.payload));
  }
  saveEvent(sessionId: string, cursor: number, event: CardEvent, card: KnowledgeCard): void {
    const at = new Date().toISOString();
    this.db.prepare(`INSERT INTO cards(card_id,session_id,revision,type,title,lifecycle,learning_status,updated_cursor,payload)
      VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(card_id) DO UPDATE SET revision=excluded.revision,type=excluded.type,title=excluded.title,lifecycle=excluded.lifecycle,learning_status=excluded.learning_status,updated_cursor=excluded.updated_cursor,payload=excluded.payload`)
      .run(card.card_id, sessionId, card.revision, card.type, card.title, card.lifecycle, card.learning_status, cursor, JSON.stringify(card));
    this.db.prepare("INSERT OR REPLACE INTO card_revisions VALUES(?,?,?,?,?,?,?,?)")
      .run(card.card_id, card.revision, sessionId, event.event, event.reason, event.at_turn, JSON.stringify(card), at);
    this.db.prepare("INSERT INTO card_events(session_id,cursor,event_type,card_id,payload,created_at) VALUES(?,?,?,?,?,?)")
      .run(sessionId, cursor, event.event, card.card_id, JSON.stringify(event), at);
  }
  listEvents(sessionId: string, cursor: number): CardEvent[] {
    return (this.db.prepare("SELECT payload FROM card_events WHERE session_id=? AND cursor=? ORDER BY event_id").all(sessionId, cursor) as {payload:string}[]).map(r => JSON.parse(r.payload));
  }
  listRevisions(cardId: string): Array<{revision:number;event_type:string;reason:string;at_turn:string;payload:KnowledgeCard;created_at:string}> {
    return (this.db.prepare("SELECT * FROM card_revisions WHERE card_id=? ORDER BY revision DESC").all(cardId) as Array<Record<string,unknown>>).map(r => ({...r,payload:JSON.parse(String(r.payload))}) as never);
  }
  saveExport(exportId:string, sessionId:string, format:string, cursor:number, content:string):void {
    this.db.prepare("INSERT INTO exports VALUES(?,?,?,?,?,?)").run(exportId,sessionId,format,cursor,content,new Date().toISOString());
  }
}
