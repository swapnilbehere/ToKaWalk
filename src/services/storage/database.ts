import SQLite from 'react-native-sqlite-storage';

SQLite.enablePromise(true);

let db: SQLite.SQLiteDatabase | null = null;

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;
  db = await SQLite.openDatabase({ name: 'tokawalk.db', location: 'default' });
  await runMigrations(db);
  return db;
}

async function runMigrations(database: SQLite.SQLiteDatabase): Promise<void> {
  await database.executeSql(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mode TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      duration_secs INTEGER,
      model_used TEXT NOT NULL
    )
  `);
  await database.executeSql(`
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
  await database.executeSql(`
    CREATE TABLE IF NOT EXISTS summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL UNIQUE,
      summary_text TEXT NOT NULL,
      generated_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    )
  `);
  await database.executeSql(`
    CREATE TABLE IF NOT EXISTS preferences (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
}
