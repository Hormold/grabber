import { z } from 'zod';

export const CategorySchema = z.enum([
  'review',
  'try',
  'knowledge',
  'podcast',
  'video',
  'article',
  'tool',
  'project',
]);

export type Category = z.infer<typeof CategorySchema>;

export const TweetSchema = z.object({
  id: z.string(),
  text: z.string(),
  authorUsername: z.string(),
  authorName: z.string(),
  createdAt: z.string(),
  urls: z.array(z.string()).default([]),
  images: z.array(z.string()).default([]),
  isThread: z.boolean().default(false),
  threadTweets: z.array(z.object({
    id: z.string(),
    text: z.string(),
  })).default([]),
});

export type Tweet = z.infer<typeof TweetSchema>;

export const AnalysisResultSchema = z.object({
  category: CategorySchema,
  topic: z.string().describe('Short scannable title - noun phrase'),
  summary: z.string(),
  tldr: z.string().describe('Tweet-length summary'),
  forYou: z.string().describe('Why this matters to YOU specifically'),
  topAction: z.string().optional().describe('Single most important action'),
  primaryLink: z.string().url().optional().describe('Main actionable URL'),
  hasArticle: z.boolean().default(false),
  hasVideo: z.boolean().default(false),
  hasThread: z.boolean().default(false),
  keyInsights: z.array(z.string()).default([]),
  quotes: z.array(z.string()).default([]),
  extractedLinks: z.array(z.object({
    url: z.string(),
    title: z.string(),
    type: z.enum(['article', 'tool', 'repo', 'video', 'docs', 'other']).default('other'),
    description: z.string(),
  })).default([]),
  youtubeTranscript: z.string().optional(),
  articleContent: z.string().optional(),
  imageAnalysis: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  relevanceScore: z.number().min(1).max(10),
  actionItems: z.array(z.object({
    action: z.string(),
    priority: z.enum(['now', 'this-week', 'someday']),
    context: z.string().optional(),
  })).default([]),
  connections: z.array(z.string()).optional(),
});

export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;

export const BookmarkRecordSchema = z.object({
  id: z.number().optional(),
  tweetId: z.string(),
  processedAt: z.string(),
  category: CategorySchema,
  notionPageId: z.string().nullable(),
  rawData: z.string(), // JSON stringified Tweet + AnalysisResult
});

export type BookmarkRecord = z.infer<typeof BookmarkRecordSchema>;

export const WeeklyStatsSchema = z.object({
  totalProcessed: z.number(),
  byCategory: z.record(CategorySchema, z.number()),
  topTags: z.array(z.object({ tag: z.string(), count: z.number() })),
  highlights: z.array(z.object({
    tweetId: z.string(),
    summary: z.string(),
    category: CategorySchema,
  })),
});

export type WeeklyStats = z.infer<typeof WeeklyStatsSchema>;

export class GrabberError extends Error {
  constructor(
    message: string,
    public code: 'AUTH_EXPIRED' | 'RATE_LIMIT' | 'NETWORK' | 'PARSE' | 'NOTION' | 'TELEGRAM' | 'UNKNOWN',
    public retryable: boolean = false,
  ) {
    super(message);
    this.name = 'GrabberError';
  }
}
