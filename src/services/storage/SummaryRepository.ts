import { DB } from '@op-engineering/op-sqlite';
import { Summary } from '../../types';

export class SummaryRepository {
  constructor(private db: DB) {}

  async save(sessionId: number, summaryText: string): Promise<void> {
    await this.db.execute(
      'INSERT OR REPLACE INTO summaries (session_id, summary_text, generated_at) VALUES (?, ?, ?)',
      [sessionId, summaryText, Date.now()],
    );
  }

  async getForSession(sessionId: number): Promise<Summary | null> {
    const result = await this.db.execute(
      'SELECT * FROM summaries WHERE session_id = ?',
      [sessionId],
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0] as Record<string, any>;
    return {
      id: row.id as number,
      sessionId: row.session_id as number,
      summaryText: row.summary_text as string,
      generatedAt: row.generated_at as number,
    };
  }
}
