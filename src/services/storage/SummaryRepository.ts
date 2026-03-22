import { SQLiteDatabase } from 'react-native-sqlite-storage';
import { Summary } from '../../types';

export class SummaryRepository {
  constructor(private db: SQLiteDatabase) {}

  async save(sessionId: number, summaryText: string): Promise<void> {
    await this.db.executeSql(
      'INSERT OR REPLACE INTO summaries (session_id, summary_text, generated_at) VALUES (?, ?, ?)',
      [sessionId, summaryText, Date.now()],
    );
  }

  async getForSession(sessionId: number): Promise<Summary | null> {
    const [result] = await this.db.executeSql(
      'SELECT * FROM summaries WHERE session_id = ?',
      [sessionId],
    );
    if (result.rows.length === 0) return null;
    const row = result.rows.item(0);
    return {
      id: row.id,
      sessionId: row.session_id,
      summaryText: row.summary_text,
      generatedAt: row.generated_at,
    };
  }
}
