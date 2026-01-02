import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig, createTestConfig } from './config.js';

describe('config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('loadConfig', () => {
    it('should throw when required env vars missing', () => {
      process.env = {};
      expect(() => loadConfig()).toThrow('Configuration error');
    });

    it('should load config with all required vars', () => {
      process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'test-key';
      process.env.NOTION_TOKEN = 'secret_xxx';
      process.env.NOTION_PARENT_PAGE_ID = 'page-id';
      process.env.TELEGRAM_BOT_TOKEN = 'bot-token';
      process.env.TELEGRAM_CHAT_ID = 'chat-id';

      const config = loadConfig();

      expect(config.googleApiKey).toBe('test-key');
      expect(config.notionToken).toBe('secret_xxx');
      expect(config.pollIntervalSeconds).toBe(60); // default
    });

    it('should use custom values when provided', () => {
      process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'test-key';
      process.env.NOTION_TOKEN = 'secret_xxx';
      process.env.NOTION_PARENT_PAGE_ID = 'page-id';
      process.env.TELEGRAM_BOT_TOKEN = 'bot-token';
      process.env.TELEGRAM_CHAT_ID = 'chat-id';
      process.env.POLL_INTERVAL_SECONDS = '30';
      process.env.FIRST_RUN_LIMIT = '100';

      const config = loadConfig();

      expect(config.pollIntervalSeconds).toBe(30);
      expect(config.firstRunLimit).toBe(100);
    });
  });

  describe('createTestConfig', () => {
    it('should create config with defaults', () => {
      const config = createTestConfig();

      expect(config.dbPath).toBe(':memory:');
      expect(config.googleApiKey).toBe('test-api-key');
    });

    it('should allow overrides', () => {
      const config = createTestConfig({ pollIntervalSeconds: 10 });

      expect(config.pollIntervalSeconds).toBe(10);
    });
  });
});
