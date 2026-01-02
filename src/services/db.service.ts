import { Database } from 'bun:sqlite';
import type { Category, BookmarkRecord, WeeklyStats, ProcessingStatus } from '../types/index.js';

export class DbService {
  private db: Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS bookmarks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tweet_id TEXT UNIQUE NOT NULL,
        processed_at TEXT NOT NULL,
        category TEXT NOT NULL,
        notion_page_id TEXT,
        raw_data TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'completed'
      );
      
      CREATE INDEX IF NOT EXISTS idx_bookmarks_tweet_id ON bookmarks(tweet_id);
      CREATE INDEX IF NOT EXISTS idx_bookmarks_processed_at ON bookmarks(processed_at);
      CREATE INDEX IF NOT EXISTS idx_bookmarks_category ON bookmarks(category);
      CREATE INDEX IF NOT EXISTS idx_bookmarks_status ON bookmarks(status);
    `);
    
    this.migrateAddStatusColumn();
  }

  private migrateAddStatusColumn(): void {
    const hasStatus = this.db.query(`PRAGMA table_info(bookmarks)`).all()
      .some((col: { name: string }) => col.name === 'status');
    
    if (!hasStatus) {
      this.db.exec(`ALTER TABLE bookmarks ADD COLUMN status TEXT NOT NULL DEFAULT 'completed'`);
    }
  }

  isProcessed(tweetId: string): boolean {
    const row = this.db.query('SELECT status FROM bookmarks WHERE tweet_id = ?').get(tweetId) as { status: string | null } | null;
    if (!row) return false;
    return row.status === 'completed' || row.status === null;
  }

  isLocked(tweetId: string): boolean {
    const row = this.db.query('SELECT status FROM bookmarks WHERE tweet_id = ?').get(tweetId) as { status: string | null } | null;
    return row?.status === 'processing';
  }

  tryLock(tweetId: string): boolean {
    const existing = this.db.query('SELECT status FROM bookmarks WHERE tweet_id = ?').get(tweetId) as { status: string | null } | null;
    
    if (existing) {
      const status = existing.status;
      if (status === 'completed' || status === 'processing' || status === null) {
        return false;
      }
    }
    
    this.db.query(`
      INSERT OR REPLACE INTO bookmarks (tweet_id, processed_at, category, notion_page_id, raw_data, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(tweetId, new Date().toISOString(), 'review', null, '{}', 'processing');
    
    return true;
  }

  releaseLock(tweetId: string, status: ProcessingStatus = 'failed'): void {
    this.db.query(`UPDATE bookmarks SET status = ? WHERE tweet_id = ?`).run(status, tweetId);
  }

  markProcessed(record: Omit<BookmarkRecord, 'id'>): void {
    this.db.query(`
      INSERT OR REPLACE INTO bookmarks (tweet_id, processed_at, category, notion_page_id, raw_data, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      record.tweetId,
      record.processedAt,
      record.category,
      record.notionPageId,
      record.rawData,
      record.status ?? 'completed',
    );
  }

  getStats(): { total: number; byCategory: Record<Category, number> } {
    const total = this.db.query('SELECT COUNT(*) as count FROM bookmarks').get() as { count: number };

    const categories = this.db.query(`
      SELECT category, COUNT(*) as count FROM bookmarks GROUP BY category
    `).all() as Array<{ category: Category; count: number }>;

    const byCategory = categories.reduce((acc, row) => {
      acc[row.category] = row.count;
      return acc;
    }, {} as Record<Category, number>);

    return { total: total.count, byCategory };
  }

  getWeeklyStats(): WeeklyStats {
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekAgoStr = weekAgo.toISOString();

    const rows = this.db.query(`
      SELECT * FROM bookmarks WHERE processed_at >= ? ORDER BY processed_at DESC
    `).all(weekAgoStr) as Array<{
      id: number;
      tweet_id: string;
      processed_at: string;
      category: Category;
      notion_page_id: string | null;
      raw_data: string;
    }>;

    const byCategory = {} as Record<Category, number>;
    const tagCounts = new Map<string, number>();
    const highlights: Array<{ tweetId: string; summary: string; category: Category }> = [];

    for (const row of rows) {
      byCategory[row.category] = (byCategory[row.category] || 0) + 1;

      try {
        const data = JSON.parse(row.raw_data);
        const analysis = data.analysis;
        
        if (analysis?.tags) {
          for (const tag of analysis.tags) {
            tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
          }
        }

        if (analysis?.relevanceScore >= 8 && highlights.length < 10) {
          highlights.push({
            tweetId: row.tweet_id,
            summary: analysis.summary || '',
            category: row.category,
          });
        }
      } catch {
        // Skip malformed data
      }
    }

    const topTags = Array.from(tagCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tag, count]) => ({ tag, count }));

    return {
      totalProcessed: rows.length,
      byCategory,
      topTags,
      highlights,
    };
  }

  getUnprocessedCount(): number {
    // This would need external info about total bookmarks
    // For now, return total processed as a proxy
    const result = this.db.query('SELECT COUNT(*) as count FROM bookmarks').get() as { count: number };
    return result.count;
  }

  close(): void {
    this.db.close();
  }
}
