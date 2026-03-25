import { open, DB } from '@op-engineering/op-sqlite';

let db: DB | null = null;

export function getDatabase(): DB {
  if (db) return db;
  db = open({ name: 'tokawalk.db' });
  return db;
}

export async function initDatabase(): Promise<void> {
  const database = getDatabase();
  await runMigrations(database);
}

async function runMigrations(database: DB): Promise<void> {
  await database.execute(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mode TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      duration_secs INTEGER,
      model_used TEXT NOT NULL
    )
  `);
  await database.execute(`
    CREATE TABLE IF NOT EXISTS turns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      speaker TEXT NOT NULL,
      text TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'completed',
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    )
  `);
  await database.execute(`
    CREATE TABLE IF NOT EXISTS summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL UNIQUE,
      summary_text TEXT NOT NULL,
      generated_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    )
  `);
  await database.execute(`
    CREATE TABLE IF NOT EXISTS preferences (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
}
