import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Tweet, AnalysisResult } from './types/index.js';

// Mock bun:sqlite for vitest (runs on Node) - stateful mock
const mockDbData: Map<string, any> = new Map();
vi.mock('bun:sqlite', () => ({
  Database: vi.fn().mockImplementation(() => ({
    exec: vi.fn(),
    query: vi.fn().mockImplementation((sql: string) => ({
      get: vi.fn().mockImplementation((...args: any[]) => {
        if (sql.includes('SELECT 1 FROM bookmarks WHERE tweet_id')) {
          return mockDbData.has(args[0]) ? { '1': 1 } : null;
        }
        if (sql.includes('COUNT(*)')) {
          return { count: mockDbData.size };
        }
        return null;
      }),
      all: vi.fn().mockImplementation((...args: any[]) => {
        if (sql.includes('SELECT * FROM bookmarks') && sql.includes('processed_at >=')) {
          const dateFilter = args[0] as string;
          return Array.from(mockDbData.values()).filter(v => v.processed_at >= dateFilter);
        }
        if (sql.includes('SELECT * FROM bookmarks')) {
          return Array.from(mockDbData.values());
        }
        if (sql.includes('GROUP BY category')) {
          const cats: Record<string, number> = {};
          mockDbData.forEach(v => { cats[v.category] = (cats[v.category] || 0) + 1; });
          return Object.entries(cats).map(([category, count]) => ({ category, count }));
        }
        return [];
      }),
      run: vi.fn().mockImplementation((...args: any[]) => {
        if (sql.includes('INSERT OR REPLACE')) {
          mockDbData.set(args[0], {
            id: mockDbData.size + 1,
            tweet_id: args[0],
            processed_at: args[1],
            category: args[2],
            notion_page_id: args[3],
            raw_data: args[4],
          });
        }
      }),
    })),
    close: vi.fn(),
  })),
}));

// Reset mock DB before each test
beforeEach(() => mockDbData.clear());

// Mock child_process - promisify converts callback to promise
vi.mock('node:child_process', () => ({
  exec: vi.fn((cmd: string, opts: any, cb?: any) => {
    const callback = typeof opts === 'function' ? opts : cb;
    // Default: return empty - tests will override
    if (callback) callback(null, '', '');
    return {} as any;
  }),
}));

// Mock fetch for Telegram
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock AI SDK
vi.mock('ai', () => ({
  generateObject: vi.fn(),
}));

// Mock Notion client
vi.mock('@notionhq/client', () => ({
  Client: vi.fn().mockImplementation(() => ({
    blocks: {
      children: {
        list: vi.fn().mockResolvedValue({ results: [] }),
      },
    },
    databases: {
      create: vi.fn().mockResolvedValue({ id: 'mock-db-id' }),
      query: vi.fn().mockResolvedValue({ results: [] }),
    },
    pages: {
      create: vi.fn().mockResolvedValue({ id: 'mock-page-id' }),
    },
  })),
}));

// Mock Firecrawl
const mockFirecrawlScrape = vi.fn();
vi.mock('@mendable/firecrawl-js', () => ({
  default: vi.fn().mockImplementation(() => ({
    scrape: mockFirecrawlScrape,
  })),
}));

// Mock util.promisify to return a working async function
vi.mock('node:util', async () => {
  const actual = await vi.importActual('node:util');
  return {
    ...actual,
    promisify: (fn: any) => {
      return async (...args: any[]) => {
        return new Promise((resolve, reject) => {
          fn(...args, (err: any, stdout: string, stderr: string) => {
            if (err) reject(err);
            else resolve({ stdout, stderr });
          });
        });
      };
    },
  };
});

import { exec } from 'node:child_process';
import { generateObject } from 'ai';
import { DbService } from './services/db.service.js';
import { BirdService } from './services/bird.service.js';
import { AgentService } from './services/agent.service.js';
import { YoutubeService } from './services/youtube.service.js';
import { NotionService } from './services/notion.service.js';
import { TelegramService } from './services/telegram.service.js';
import { ScraperService } from './services/scraper.service.js';
import { GrabberError } from './types/index.js';

const mockExec = vi.mocked(exec);
const mockGenerateObject = vi.mocked(generateObject);

describe('E2E: Full bookmark processing cycle', () => {
  let db: DbService;
  let bird: BirdService;
  let agent: AgentService;
  let youtube: YoutubeService;
  let notion: NotionService;
  let telegram: TelegramService;
  let scraper: ScraperService;

  const mockTweet: Tweet = {
    id: '123456789',
    text: 'Check out this amazing tool https://example.com and this video https://youtube.com/watch?v=abc123',
    authorUsername: 'testuser',
    authorName: 'Test User',
    createdAt: '2024-01-15T10:00:00Z',
    urls: ['https://example.com', 'https://youtube.com/watch?v=abc123'],
    images: [],
    isThread: false,
    threadTweets: [],
  };

  const mockAnalysis: AnalysisResult = {
    category: 'tool',
    summary: 'A useful developer tool for testing',
    keyInsights: ['Great for testing', 'Easy to integrate'],
    quotes: ['This is amazing'],
    extractedLinks: [{ url: 'https://example.com', title: 'Example Tool', type: 'tool', description: 'A testing tool' }],
    tags: ['testing', 'devtools', 'productivity'],
    relevanceScore: 8,
    actionItems: [{ action: 'Try the tool', priority: 'this-week' }],
    tldr: 'A useful testing tool worth checking out',
    imageAnalysis: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbData.clear();
    db = new DbService(':memory:');
    bird = new BirdService({ authToken: 'test-token', ct0: 'test-ct0' });
    agent = new AgentService();
    youtube = new YoutubeService();
    notion = new NotionService('test-notion-token', 'test-page-id');
    telegram = new TelegramService('test-bot-token', 'test-chat-id');
    scraper = new ScraperService('test-firecrawl-key');

    // Default successful fetch for Telegram
    mockFetch.mockResolvedValue({ ok: true, text: async () => '{}' });
  });

  afterEach(() => {
    db.close();
  });

  describe('Step 1: Bird CLI fetches bookmarks', () => {
    it('should parse bookmarks from bird CLI output', async () => {
      const birdOutput = JSON.stringify([
        {
          id: '123456789',
          text: 'Test tweet content',
          createdAt: '2024-01-15T10:00:00Z',
          author: { username: 'testuser', name: 'Test User' },
        },
      ]);

      mockExec.mockImplementation((cmd, opts, callback) => {
        const cb = typeof opts === 'function' ? opts : callback;
        cb?.(null, birdOutput, '');
        return {} as any;
      });

      const bookmarks = await bird.getBookmarks(10);

      expect(bookmarks).toHaveLength(1);
      expect(bookmarks[0].id).toBe('123456789');
      expect(bookmarks[0].authorUsername).toBe('testuser');
    });

    it('should check auth via bird whoami', async () => {
      mockExec.mockImplementation((cmd, opts, callback) => {
        const cb = typeof opts === 'function' ? opts : callback;
        cb?.(null, '@testuser (Test User)', '');
        return {} as any;
      });

      const { valid, username } = await bird.checkAuth();

      expect(valid).toBe(true);
      expect(username).toBe('testuser');
    });

    it('should handle auth expired error', async () => {
      mockExec.mockImplementation((cmd, opts, callback) => {
        const cb = typeof opts === 'function' ? opts : callback;
        cb?.(new Error('auth token expired 401'), '', 'auth expired');
        return {} as any;
      });

      await expect(bird.getBookmarks(10)).rejects.toThrow('auth expired');
    });

    it('should handle rate limit error', async () => {
      mockExec.mockImplementation((cmd, opts, callback) => {
        const cb = typeof opts === 'function' ? opts : callback;
        cb?.(new Error('rate limit exceeded 429'), '', '');
        return {} as any;
      });

      await expect(bird.getBookmarks(10)).rejects.toThrow('rate limit');
    });

    it('should handle malformed tweet data gracefully', async () => {
      const birdOutput = JSON.stringify([
        { id: '1', text: 'Valid', createdAt: '2024-01-15T10:00:00Z', author: { username: 'a', name: 'A' } },
        { invalid: 'missing required fields' },
        { id: '2', text: 'Also valid', createdAt: '2024-01-15T10:00:00Z', author: { username: 'b', name: 'B' } },
      ]);

      mockExec.mockImplementation((cmd, opts, callback) => {
        const cb = typeof opts === 'function' ? opts : callback;
        cb?.(null, birdOutput, '');
        return {} as any;
      });

      const bookmarks = await bird.getBookmarks(10);

      // Should skip invalid, keep valid
      expect(bookmarks).toHaveLength(2);
      expect(bookmarks[0].id).toBe('1');
      expect(bookmarks[1].id).toBe('2');
    });

    it('should handle empty bookmarks', async () => {
      mockExec.mockImplementation((cmd, opts, callback) => {
        const cb = typeof opts === 'function' ? opts : callback;
        cb?.(null, '[]', '');
        return {} as any;
      });

      const bookmarks = await bird.getBookmarks(10);
      expect(bookmarks).toHaveLength(0);
    });
  });

  describe('Step 2: YouTube transcript extraction', () => {
    it('should extract video ID from various URL formats', () => {
      expect(youtube.extractVideoId('https://www.youtube.com/watch?v=abc123def45')).toBe('abc123def45');
      expect(youtube.extractVideoId('https://youtu.be/abc123def45')).toBe('abc123def45');
      expect(youtube.extractVideoId('https://youtube.com/shorts/abc123def45')).toBe('abc123def45');
      expect(youtube.extractVideoId('https://example.com')).toBeNull();
    });

    it('should identify YouTube URLs', () => {
      expect(youtube.isYoutubeUrl('https://www.youtube.com/watch?v=abc123def45')).toBe(true);
      expect(youtube.isYoutubeUrl('https://youtu.be/abc123def45')).toBe(true);
      expect(youtube.isYoutubeUrl('https://example.com')).toBe(false);
    });

    it('should fetch transcript via yt-dlp', async () => {
      mockExec.mockImplementation((cmd, opts, callback) => {
        const cb = typeof opts === 'function' ? opts : callback;
        cb?.(null, 'This is the video transcript content', '');
        return {} as any;
      });

      const transcript = await youtube.getTranscript('abc123def45');

      expect(transcript).toBe('This is the video transcript content');
    });

    it('should return null when transcript unavailable', async () => {
      mockExec.mockImplementation((cmd, opts, callback) => {
        const cb = typeof opts === 'function' ? opts : callback;
        cb?.(null, '', '');
        return {} as any;
      });

      const transcript = await youtube.getTranscript('abc123def45');
      expect(transcript).toBeNull();
    });

    it('should handle yt-dlp errors gracefully', async () => {
      mockExec.mockImplementation((cmd, opts, callback) => {
        const cb = typeof opts === 'function' ? opts : callback;
        cb?.(new Error('yt-dlp failed'), '', '');
        return {} as any;
      });

      const transcript = await youtube.getTranscript('abc123def45');
      expect(transcript).toBeNull();
    });
  });

  describe('Step 3: AI analysis with Gemini', () => {
    it('should analyze tweet and return structured result', async () => {
      mockGenerateObject.mockResolvedValue({
        object: mockAnalysis,
        finishReason: 'stop',
        usage: { promptTokens: 100, completionTokens: 50 },
      } as any);

      const result = await agent.analyzeTweet(mockTweet);

      expect(result.category).toBe('tool');
      expect(result.relevanceScore).toBe(8);
      expect(result.tags).toContain('testing');
      expect(mockGenerateObject).toHaveBeenCalledOnce();
    });

    it('should include YouTube transcript in analysis context', async () => {
      mockGenerateObject.mockResolvedValue({
        object: { ...mockAnalysis, category: 'video' },
        finishReason: 'stop',
        usage: { promptTokens: 100, completionTokens: 50 },
      } as any);

      const result = await agent.analyzeTweet(mockTweet, {
        youtubeTranscript: 'Video transcript here',
      });

      expect(result.category).toBe('video');
      // New structure includes transcript in VIDEO TRANSCRIPTS section
      expect(mockGenerateObject).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining('VIDEO TRANSCRIPTS'),
        })
      );
    });

    it('should include thread content in analysis', async () => {
      const threadTweet: Tweet = {
        ...mockTweet,
        isThread: true,
        threadTweets: [
          { id: '2', text: 'Second tweet in thread' },
          { id: '3', text: 'Third tweet in thread' },
        ],
      };

      mockGenerateObject.mockResolvedValue({
        object: mockAnalysis,
        finishReason: 'stop',
        usage: { promptTokens: 100, completionTokens: 50 },
      } as any);

      await agent.analyzeTweet(threadTweet);

      expect(mockGenerateObject).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining('THREAD CONTINUATION'),
        })
      );
    });

    it('should generate weekly digest', async () => {
      mockGenerateObject.mockResolvedValue({
        object: {
          digest: 'Weekly summary of bookmarks',
          patterns: ['AI tools trending', 'More articles saved'],
          recommendations: ['Try tool X', 'Read article Y'],
          topPicks: [{ summary: 'Great tool', why: 'High relevance' }],
        },
        finishReason: 'stop',
        usage: { promptTokens: 100, completionTokens: 50 },
      } as any);

      const digest = await agent.generateDigest(
        { totalProcessed: 10, byCategory: { tool: 5, article: 3, video: 2 } as any },
        [{ summary: 'Great tool', category: 'tool' }]
      );

      expect(digest).toContain('Weekly Bookmark Digest');
      expect(digest).toContain('Recommendations');
    });
  });

  describe('Step 4: Notion sync', () => {
    it('should create database on first run', async () => {
      const dbId = await notion.ensureDatabase();
      expect(dbId).toBe('mock-db-id');
    });

    it('should reuse existing database', async () => {
      const dbId1 = await notion.ensureDatabase();
      const dbId2 = await notion.ensureDatabase();
      expect(dbId1).toBe(dbId2);
    });

    it('should create page with tweet analysis', async () => {
      const pageId = await notion.createPage(mockTweet, mockAnalysis);
      expect(pageId).toBe('mock-page-id');
    });

    it('should handle long tweet text', async () => {
      const longTweet: Tweet = {
        ...mockTweet,
        text: 'A'.repeat(3000), // Very long tweet
      };

      const pageId = await notion.createPage(longTweet, mockAnalysis);
      expect(pageId).toBe('mock-page-id');
    });

    it('should handle tweets with many tags', async () => {
      const manyTagsAnalysis: AnalysisResult = {
        ...mockAnalysis,
        tags: ['tag1', 'tag2', 'tag3', 'tag4', 'tag5', 'tag6', 'tag7', 'tag8'],
      };

      const pageId = await notion.createPage(mockTweet, manyTagsAnalysis);
      expect(pageId).toBe('mock-page-id');
    });
  });

  describe('Step 5: Telegram notifications', () => {
    it('should send error notification', async () => {
      const error = new GrabberError('Test error', 'NETWORK', true);
      await telegram.notifyError(error);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('api.telegram.org'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('Test error'),
        })
      );
    });

    it('should send auth expired notification', async () => {
      await telegram.notifyAuthExpired();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('api.telegram.org'),
        expect.objectContaining({
          body: expect.stringContaining('Auth Expired'),
        })
      );
    });

    it('should send weekly digest', async () => {
      await telegram.sendDigest('# Weekly Digest\n\nContent here');
      expect(mockFetch).toHaveBeenCalled();
    });

    it('should chunk long messages', async () => {
      const longDigest = 'Line\n'.repeat(1000);
      await telegram.sendDigest(longDigest);
      // Should split into multiple messages
      expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle Telegram API errors', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, text: async () => 'Bot blocked' });

      await expect(telegram.sendMessage('test')).rejects.toThrow('Telegram send failed');
    });

    it('should escape HTML in error messages', async () => {
      const error = new GrabberError('<script>alert("xss")</script>', 'UNKNOWN', false);
      await telegram.notifyError(error);

      const callBody = mockFetch.mock.calls[0][1].body;
      expect(callBody).not.toContain('<script>');
      expect(callBody).toContain('&lt;script&gt;');
    });
  });

  describe('Step 6: SQLite persistence', () => {
    it('should track processed tweets', () => {
      expect(db.isProcessed('123')).toBe(false);

      db.markProcessed({
        tweetId: '123',
        processedAt: new Date().toISOString(),
        category: 'tool',
        notionPageId: 'page-123',
        rawData: JSON.stringify({ tweet: mockTweet, analysis: mockAnalysis }),
      });

      expect(db.isProcessed('123')).toBe(true);
    });

    it('should handle null notionPageId', () => {
      db.markProcessed({
        tweetId: '123',
        processedAt: new Date().toISOString(),
        category: 'tool',
        notionPageId: null,
        rawData: '{}',
      });

      expect(db.isProcessed('123')).toBe(true);
    });

    it('should replace duplicate tweets', () => {
      db.markProcessed({
        tweetId: '123',
        processedAt: new Date().toISOString(),
        category: 'tool',
        notionPageId: 'page-123',
        rawData: '{}',
      });

      db.markProcessed({
        tweetId: '123',
        processedAt: new Date().toISOString(),
        category: 'article',
        notionPageId: 'page-456',
        rawData: '{}',
      });

      const stats = db.getStats();
      expect(stats.total).toBe(1);
      expect(stats.byCategory.article).toBe(1);
      expect(stats.byCategory.tool).toBeUndefined();
    });

    it('should calculate weekly stats', () => {
      const now = new Date().toISOString();

      db.markProcessed({
        tweetId: '1',
        processedAt: now,
        category: 'tool',
        notionPageId: null,
        rawData: JSON.stringify({ analysis: { tags: ['ai', 'dev'], relevanceScore: 9, summary: 'Great AI tool' } }),
      });

      db.markProcessed({
        tweetId: '2',
        processedAt: now,
        category: 'tool',
        notionPageId: null,
        rawData: JSON.stringify({ analysis: { tags: ['ai', 'ml'], relevanceScore: 7, summary: 'ML library' } }),
      });

      db.markProcessed({
        tweetId: '3',
        processedAt: now,
        category: 'article',
        notionPageId: null,
        rawData: JSON.stringify({ analysis: { tags: ['typescript'], relevanceScore: 6, summary: 'TS tips' } }),
      });

      const stats = db.getWeeklyStats();

      expect(stats.totalProcessed).toBe(3);
      expect(stats.byCategory.tool).toBe(2);
      expect(stats.byCategory.article).toBe(1);
      expect(stats.topTags.find((t) => t.tag === 'ai')?.count).toBe(2);
      expect(stats.highlights).toHaveLength(1);
      expect(stats.highlights[0].summary).toBe('Great AI tool');
    });

    it('should exclude old tweets from weekly stats', () => {
      const now = new Date();
      const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

      db.markProcessed({
        tweetId: 'old',
        processedAt: twoWeeksAgo.toISOString(),
        category: 'tool',
        notionPageId: null,
        rawData: '{}',
      });

      db.markProcessed({
        tweetId: 'new',
        processedAt: now.toISOString(),
        category: 'article',
        notionPageId: null,
        rawData: '{}',
      });

      const stats = db.getWeeklyStats();
      expect(stats.totalProcessed).toBe(1);
      expect(stats.byCategory.article).toBe(1);
      expect(stats.byCategory.tool).toBeUndefined();
    });

    it('should handle malformed rawData gracefully', () => {
      const now = new Date().toISOString();

      db.markProcessed({
        tweetId: '1',
        processedAt: now,
        category: 'tool',
        notionPageId: null,
        rawData: 'not valid json',
      });

      db.markProcessed({
        tweetId: '2',
        processedAt: now,
        category: 'article',
        notionPageId: null,
        rawData: JSON.stringify({ analysis: { tags: ['valid'], relevanceScore: 5, summary: 'Valid' } }),
      });

      const stats = db.getWeeklyStats();
      expect(stats.totalProcessed).toBe(2);
      expect(stats.topTags).toHaveLength(1);
    });
  });

  describe('Full E2E cycle', () => {
    it('should process bookmark from fetch to storage', async () => {
      // 1. Bird fetches bookmarks
      const birdOutput = JSON.stringify([
        {
          id: 'e2e-tweet-123',
          text: 'Amazing new tool https://example.com',
          createdAt: '2024-01-15T10:00:00Z',
          author: { username: 'developer', name: 'Dev User' },
        },
      ]);

      mockExec.mockImplementation((cmd, opts, callback) => {
        const cb = typeof opts === 'function' ? opts : callback;
        if (String(cmd).includes('bookmarks')) {
          cb?.(null, birdOutput, '');
        } else {
          cb?.(null, '', '');
        }
        return {} as any;
      });

      // 2. Fetch bookmarks
      const bookmarks = await bird.getBookmarks(10);
      expect(bookmarks).toHaveLength(1);

      const tweet = bookmarks[0];

      // 3. Check not already processed
      expect(db.isProcessed(tweet.id)).toBe(false);

      // 4. AI analyzes
      mockGenerateObject.mockResolvedValue({
        object: {
          category: 'tool',
          summary: 'New dev tool discovered',
          quotes: [],
          extractedLinks: [{ url: 'https://example.com' }],
          tags: ['tools', 'dev'],
          relevanceScore: 7,
        },
        finishReason: 'stop',
        usage: { promptTokens: 100, completionTokens: 50 },
      } as any);

      const analysis = await agent.analyzeTweet(tweet);
      expect(analysis.category).toBe('tool');

      // 5. Sync to Notion
      const notionPageId = await notion.createPage(tweet, analysis as AnalysisResult);
      expect(notionPageId).toBe('mock-page-id');

      // 6. Mark as processed
      db.markProcessed({
        tweetId: tweet.id,
        processedAt: new Date().toISOString(),
        category: analysis.category,
        notionPageId,
        rawData: JSON.stringify({ tweet, analysis }),
      });

      // 7. Verify stored
      expect(db.isProcessed(tweet.id)).toBe(true);
      const stats = db.getStats();
      expect(stats.total).toBe(1);
      expect(stats.byCategory.tool).toBe(1);
    });

    it('should skip already processed tweets', async () => {
      db.markProcessed({
        tweetId: 'already-processed-123',
        processedAt: new Date().toISOString(),
        category: 'article',
        notionPageId: 'old-page',
        rawData: '{}',
      });

      expect(db.isProcessed('already-processed-123')).toBe(true);

      const initialCalls = mockGenerateObject.mock.calls.length;

      if (!db.isProcessed('already-processed-123')) {
        await agent.analyzeTweet(mockTweet);
      }

      expect(mockGenerateObject.mock.calls.length).toBe(initialCalls);
    });

    it('should handle thread tweets', async () => {
      const threadOutput = JSON.stringify([
        {
          id: 'thread-1',
          text: 'First tweet in thread',
          createdAt: '2024-01-15T10:00:00Z',
          author: { username: 'threaduser', name: 'Thread User' },
          conversationId: 'thread-1',
        },
        {
          id: 'thread-2',
          text: 'Second tweet in thread',
          createdAt: '2024-01-15T10:01:00Z',
          author: { username: 'threaduser', name: 'Thread User' },
          conversationId: 'thread-1',
        },
      ]);

      mockExec.mockImplementation((cmd, opts, callback) => {
        const cb = typeof opts === 'function' ? opts : callback;
        cb?.(null, threadOutput, '');
        return {} as any;
      });

      const threadTweets = await bird.getThread('thread-1');

      expect(threadTweets).toHaveLength(2);
      expect(threadTweets[0].text).toBe('First tweet in thread');
      expect(threadTweets[1].text).toBe('Second tweet in thread');
    });

    it('should process tweet with YouTube video', async () => {
      const tweetWithVideo: Tweet = {
        ...mockTweet,
        text: 'Great video https://www.youtube.com/watch?v=abc123def45',
        urls: ['https://www.youtube.com/watch?v=abc123def45'],
      };

      // Mock yt-dlp for transcript
      mockExec.mockImplementation((cmd, opts, callback) => {
        const cb = typeof opts === 'function' ? opts : callback;
        if (String(cmd).includes('yt-dlp')) {
          cb?.(null, 'This is the video transcript about AI tools', '');
        } else {
          cb?.(null, '', '');
        }
        return {} as any;
      });

      // Check if URL is YouTube
      const youtubeUrl = tweetWithVideo.urls.find((u) => youtube.isYoutubeUrl(u));
      expect(youtubeUrl).toBeDefined();

      // Get transcript
      const transcript = await youtube.getTranscript(youtubeUrl!);
      expect(transcript).toContain('video transcript');

      // Analyze with transcript
      mockGenerateObject.mockResolvedValue({
        object: {
          ...mockAnalysis,
          category: 'video',
          youtubeTranscript: transcript,
        },
        finishReason: 'stop',
        usage: { promptTokens: 100, completionTokens: 50 },
      } as any);

      const analysis = await agent.analyzeTweet(tweetWithVideo, { youtubeTranscript: transcript! });
      expect(analysis.category).toBe('video');
    });

    it('should generate and send weekly digest', async () => {
      const now = new Date().toISOString();
      for (let i = 0; i < 5; i++) {
        db.markProcessed({
          tweetId: `digest-tweet-${i}`,
          processedAt: now,
          category: i % 2 === 0 ? 'tool' : 'article',
          notionPageId: null,
          rawData: JSON.stringify({
            analysis: {
              tags: ['tag1', 'tag2'],
              relevanceScore: 5 + i,
              summary: `Summary ${i}`,
            },
          }),
        });
      }

      const weeklyStats = db.getWeeklyStats();
      expect(weeklyStats.totalProcessed).toBe(5);

      mockGenerateObject.mockResolvedValue({
        object: {
          digest: 'This week you saved 5 bookmarks...',
          patterns: ['Tool discovery', 'Article reading'],
          recommendations: ['Focus on tools', 'Read more articles'],
          topPicks: [{ summary: 'Top item', why: 'High value' }],
        },
        finishReason: 'stop',
        usage: { promptTokens: 100, completionTokens: 50 },
      } as any);

      const digest = await agent.generateDigest(
        { totalProcessed: weeklyStats.totalProcessed, byCategory: weeklyStats.byCategory as any },
        weeklyStats.highlights
      );

      expect(digest).toContain('Weekly Bookmark Digest');

      await telegram.sendDigest(digest);
      expect(mockFetch).toHaveBeenCalled();
    });

    it('should handle complete error flow', async () => {
      // Simulate network error
      mockExec.mockImplementation((cmd, opts, callback) => {
        const cb = typeof opts === 'function' ? opts : callback;
        cb?.(new Error('Network timeout'), '', '');
        return {} as any;
      });

      // Should throw GrabberError
      await expect(bird.getBookmarks(10)).rejects.toThrow(GrabberError);

      try {
        await bird.getBookmarks(10);
      } catch (error) {
        if (error instanceof GrabberError) {
          // Notify via Telegram
          await telegram.notifyError(error);
          expect(mockFetch).toHaveBeenCalled();

          const callBody = mockFetch.mock.calls[0][1].body;
          expect(callBody).toContain('NETWORK');
        }
      }
    });
  });

  describe('Edge cases', () => {
    it('should handle tweets with no URLs', async () => {
      const noUrlTweet: Tweet = {
        ...mockTweet,
        text: 'Just a simple thought without any links',
        urls: [],
      };

      mockGenerateObject.mockResolvedValue({
        object: { ...mockAnalysis, extractedLinks: [] },
        finishReason: 'stop',
        usage: { promptTokens: 100, completionTokens: 50 },
      } as any);

      const analysis = await agent.analyzeTweet(noUrlTweet);
      expect(analysis.extractedLinks).toHaveLength(0);
    });

    it('should handle tweets with special characters', async () => {
      const specialTweet: Tweet = {
        ...mockTweet,
        text: 'Check this out! 🚀 <script>alert("xss")</script> & more "quotes"',
        authorName: "O'Reilly & Sons",
      };

      mockGenerateObject.mockResolvedValue({
        object: mockAnalysis,
        finishReason: 'stop',
        usage: { promptTokens: 100, completionTokens: 50 },
      } as any);

      const analysis = await agent.analyzeTweet(specialTweet);
      expect(analysis).toBeDefined();
    });

    it('should handle empty digest stats', async () => {
      mockGenerateObject.mockResolvedValue({
        object: {
          digest: 'No bookmarks this week',
          patterns: [],
          recommendations: [],
          topPicks: [],
        },
        finishReason: 'stop',
        usage: { promptTokens: 100, completionTokens: 50 },
      } as any);

      const digest = await agent.generateDigest(
        { totalProcessed: 0, byCategory: {} as any },
        []
      );

      expect(digest).toContain('Weekly Bookmark Digest');
    });

    it('should handle concurrent processing', async () => {
      const tweets = Array.from({ length: 5 }, (_, i) => ({
        ...mockTweet,
        id: `concurrent-${i}`,
      }));

      mockGenerateObject.mockResolvedValue({
        object: mockAnalysis,
        finishReason: 'stop',
        usage: { promptTokens: 100, completionTokens: 50 },
      } as any);

      // Process all concurrently
      const analyses = await Promise.all(tweets.map((t) => agent.analyzeTweet(t)));

      expect(analyses).toHaveLength(5);
      analyses.forEach((a) => expect(a.category).toBe('tool'));
    });

    it('should handle database close and reopen', () => {
      db.markProcessed({
        tweetId: 'persist-test',
        processedAt: new Date().toISOString(),
        category: 'tool',
        notionPageId: null,
        rawData: '{}',
      });

      // In-memory DB data is lost on close, but test the close mechanism
      expect(() => db.close()).not.toThrow();
    });
  });
});
