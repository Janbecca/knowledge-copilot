export const migrations = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(
        session_id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL,
        capture_scope TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        last_captured_turn INTEGER NOT NULL DEFAULT 0, source_host TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS turns(
        turn_id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(session_id),
        user_message TEXT NOT NULL, assistant_message TEXT NOT NULL, tool_observations TEXT NOT NULL,
        created_at TEXT NOT NULL, source_reference TEXT, idempotency_key TEXT NOT NULL,
        cursor INTEGER NOT NULL, UNIQUE(session_id, idempotency_key), UNIQUE(session_id, cursor)
      );
      CREATE TABLE IF NOT EXISTS cards(
        card_id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(session_id),
        revision INTEGER NOT NULL, type TEXT NOT NULL, title TEXT NOT NULL, lifecycle TEXT NOT NULL,
        learning_status TEXT NOT NULL, updated_cursor INTEGER NOT NULL, payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS card_revisions(
        card_id TEXT NOT NULL, revision INTEGER NOT NULL, session_id TEXT NOT NULL,
        event_type TEXT NOT NULL, reason TEXT NOT NULL, at_turn TEXT NOT NULL,
        payload TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(card_id, revision)
      );
      CREATE TABLE IF NOT EXISTS card_events(
        event_id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, cursor INTEGER NOT NULL,
        event_type TEXT NOT NULL, card_id TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS exports(
        export_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, format TEXT NOT NULL,
        source_cursor INTEGER NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_cards_session ON cards(session_id, updated_cursor);
      CREATE INDEX IF NOT EXISTS idx_events_session ON card_events(session_id, cursor, event_id);
    `
  },
  {
    version: 2,
    sql: `CREATE INDEX IF NOT EXISTS idx_sessions_source_host ON sessions(source_host, updated_at);`
  },
  {
    version: 3,
    sql: `ALTER TABLE sessions ADD COLUMN extraction_mode TEXT NOT NULL DEFAULT 'host_structured' CHECK(extraction_mode IN ('host_structured','server_llm'));`
  }
];
