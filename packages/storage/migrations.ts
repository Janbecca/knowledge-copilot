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
  },
  {
    version: 4,
    sql: `
      CREATE TABLE IF NOT EXISTS users(
        user_id TEXT PRIMARY KEY, subject TEXT NOT NULL UNIQUE, display_name TEXT, email TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      ALTER TABLE sessions ADD COLUMN owner_user_id TEXT REFERENCES users(user_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_owner ON sessions(owner_user_id, updated_at);
      CREATE TABLE IF NOT EXISTS devices(
        device_id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(user_id), name TEXT NOT NULL,
        platform TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL, revoked_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id, revoked_at);
      CREATE TABLE IF NOT EXISTS consent_grants(
        grant_id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(user_id),
        device_id TEXT REFERENCES devices(device_id), source_host TEXT NOT NULL,
        conversation_ref TEXT, scope TEXT NOT NULL, created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL, revoked_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_consents_user ON consent_grants(user_id, source_host, revoked_at);
      CREATE TABLE IF NOT EXISTS wake_tokens(
        token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(user_id),
        device_id TEXT NOT NULL REFERENCES devices(device_id), session_id TEXT REFERENCES sessions(session_id),
        source_host TEXT NOT NULL, expires_at TEXT NOT NULL, consumed_at TEXT, created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_wake_expiry ON wake_tokens(expires_at, consumed_at);
      CREATE TABLE IF NOT EXISTS security_audit(
        audit_id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, event_type TEXT NOT NULL,
        target_id TEXT, metadata TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_security_audit_user ON security_audit(user_id, created_at);
    `
  }
];
