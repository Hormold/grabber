import { z } from 'zod';

const ConfigSchema = z.object({
  // Twitter/Bird
  twitterCookiesPath: z.string().default('./cookies.txt'),

  // Gemini
  googleApiKey: z.string().min(1, 'GOOGLE_GENERATIVE_AI_API_KEY is required'),

  // Firecrawl
  firecrawlApiKey: z.string().optional(),

  // Notion
  notionToken: z.string().min(1, 'NOTION_TOKEN is required'),
  notionParentPageId: z.string().min(1, 'NOTION_PARENT_PAGE_ID is required'),

  // Telegram
  telegramBotToken: z.string().min(1, 'TELEGRAM_BOT_TOKEN is required'),
  telegramChatId: z.string().min(1, 'TELEGRAM_CHAT_ID is required'),

  // Settings
  firstRunLimit: z.coerce.number().default(200),
  pollIntervalSeconds: z.coerce.number().default(60),
  dbPath: z.string().default('./data/grabber.db'),
  digestCron: z.string().default('0 10 * * 0'), // Sunday 10:00
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(): Config {
  const result = ConfigSchema.safeParse({
    twitterCookiesPath: process.env.TWITTER_COOKIES_PATH,
    googleApiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    firecrawlApiKey: process.env.FIRECRAWL_API_KEY,
    notionToken: process.env.NOTION_TOKEN,
    notionParentPageId: process.env.NOTION_PARENT_PAGE_ID,
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
    telegramChatId: process.env.TELEGRAM_CHAT_ID,
    firstRunLimit: process.env.FIRST_RUN_LIMIT,
    pollIntervalSeconds: process.env.POLL_INTERVAL_SECONDS,
    dbPath: process.env.DB_PATH,
    digestCron: process.env.DIGEST_CRON,
  });

  if (!result.success) {
    const errors = result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
    throw new Error(`Configuration error:\n${errors.join('\n')}`);
  }

  return result.data;
}

// For testing - create config with overrides
export function createTestConfig(overrides: Partial<Config> = {}): Config {
  return {
    twitterCookiesPath: './cookies.txt',
    googleApiKey: 'test-api-key',
    firecrawlApiKey: 'test-firecrawl-key',
    notionToken: 'test-notion-token',
    notionParentPageId: 'test-page-id',
    telegramBotToken: 'test-bot-token',
    telegramChatId: 'test-chat-id',
    firstRunLimit: 200,
    pollIntervalSeconds: 60,
    dbPath: ':memory:',
    digestCron: '0 10 * * 0',
    ...overrides,
  };
}
