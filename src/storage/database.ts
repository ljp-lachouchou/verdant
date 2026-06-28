import Database from 'better-sqlite3'
import type { Database as DatabaseType, Statement } from 'better-sqlite3'
import { join } from 'path'
import { app } from 'electron'
import { mkdirSync } from 'fs'

const SCHEMA_BASE = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT 'New Session',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  parent_id TEXT,
  metadata TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  tool_calls TEXT,
  is_summary INTEGER DEFAULT 0,
  metadata TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS prompt_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  template_text TEXT NOT NULL,
  created_at INTEGER DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS app_metadata (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);
`

const MIGRATIONS = [
  {
    id: '001_add_message_type',
    check: "SELECT COUNT(*) as c FROM pragma_table_info('messages') WHERE name='message_type'",
    sql: "ALTER TABLE messages ADD COLUMN message_type TEXT NOT NULL DEFAULT 'text'"
  },
  {
    id: '002_add_is_compacted',
    check: "SELECT COUNT(*) as c FROM pragma_table_info('messages') WHERE name='is_compacted'",
    sql: "ALTER TABLE messages ADD COLUMN is_compacted INTEGER DEFAULT 0"
  },
  {
    id: '003_add_parent_message_id',
    check: "SELECT COUNT(*) as c FROM pragma_table_info('messages') WHERE name='parent_message_id'",
    sql: "ALTER TABLE messages ADD COLUMN parent_message_id TEXT"
  },
  {
    id: '004_add_token_count',
    check: "SELECT COUNT(*) as c FROM pragma_table_info('messages') WHERE name='token_count'",
    sql: "ALTER TABLE messages ADD COLUMN token_count INTEGER DEFAULT 0"
  }
]

const POST_MIGRATION_SQL = `
CREATE INDEX IF NOT EXISTS idx_messages_active ON messages(session_id, is_compacted) WHERE is_compacted = 0;
`

export class DatabaseManager {
  private db: DatabaseType

  constructor(dbPath?: string) {
    const path = dbPath || this.getDefaultPath()
    mkdirSync(join(path, '..'), { recursive: true })
    this.db = new Database(path)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.db.exec(SCHEMA_BASE)
    this.runMigrations()
    this.db.exec(POST_MIGRATION_SQL)
  }

  private runMigrations(): void {
    for (const migration of MIGRATIONS) {
      try {
        const result = this.db.prepare(migration.check).get() as { c: number }
        if (result.c === 0) {
          this.db.exec(migration.sql)
        }
      } catch {
        // column might already exist or table not created yet
      }
    }
  }

  private getDefaultPath(): string {
    const userDataPath = app?.getPath?.('userData') || join(process.cwd(), 'data')
    return join(userDataPath, 'agent.db')
  }

  getDb(): DatabaseType {
    return this.db
  }

  prepare(sql: string): Statement {
    return this.db.prepare(sql)
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)()
  }

  async backup(targetPath: string): Promise<void> {
    await this.db.backup(targetPath)
  }

  close(): void {
    this.db.close()
  }
}
