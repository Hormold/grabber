import cron from 'node-cron';
import { loadConfig, type Config } from './config.js';
import { DbService } from './services/db.service.js';
import { BirdService } from './services/bird.service.js';
import { AgentService, type TriageResult, type EnrichedContext } from './services/agent.service.js';
import { YoutubeService } from './services/youtube.service.js';
import { NotionService } from './services/notion.service.js';
import { TelegramService } from './services/telegram.service.js';
import { ScraperService } from './services/scraper.service.js';
import { GrabberError, type Tweet, type Category } from './types/index.js';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

class Grabber {
  private config: Config;
  private db: DbService;
  private bird: BirdService;
  private agent: AgentService;
  private youtube: YoutubeService;
  private notion: NotionService;
  private telegram: TelegramService;
  private scraper: ScraperService;
  private isFirstRun = true;
  private isProcessing = false;
  private authValid = true;

  constructor(config: Config) {
    this.config = config;
    this.db = new DbService(config.dbPath);
    this.bird = new BirdService({
      authToken: process.env.TWITTER_AUTH_TOKEN,
      ct0: process.env.TWITTER_CT0,
    });
    this.agent = new AgentService();
    this.youtube = new YoutubeService();
    this.notion = new NotionService(config.notionToken, config.notionParentPageId);
    this.telegram = new TelegramService(config.telegramBotToken, config.telegramChatId);
    this.scraper = new ScraperService(config.firecrawlApiKey);
  }

  async start(): Promise<void> {
    console.log('[Grabber] Starting...');

    await this.ensureDataDir();
    await this.checkAuth();

    if (!this.authValid) {
      console.error('[Grabber] Auth invalid, waiting for valid credentials');
      await this.telegram.notifyAuthExpired();
    }

    await this.processBookmarks();
    this.isFirstRun = false;

    cron.schedule(`*/${this.config.pollIntervalSeconds} * * * * *`, () => {
      this.processBookmarks().catch((e) => console.error('[Grabber] Poll error:', e));
    });

    cron.schedule(this.config.digestCron, () => {
      this.sendWeeklyDigest().catch((e) => console.error('[Grabber] Digest error:', e));
    });

    console.log(`[Grabber] Running. Poll every ${this.config.pollIntervalSeconds}s, digest: ${this.config.digestCron}`);
  }

  private async ensureDataDir(): Promise<void> {
    const dir = dirname(this.config.dbPath);
    if (dir && dir !== '.') {
      await mkdir(dir, { recursive: true });
    }
  }

  private async checkAuth(): Promise<void> {
    const { valid, username } = await this.bird.checkAuth();
    this.authValid = valid;
    if (valid) {
      console.log(`[Grabber] Authenticated as @${username}`);
    }
  }

  private async processBookmarks(): Promise<void> {
    if (this.isProcessing) return;
    if (!this.authValid) {
      await this.checkAuth();
      if (!this.authValid) return;
    }

    this.isProcessing = true;

    try {
      const limit = this.isFirstRun ? this.config.firstRunLimit : 20;
      console.log(`[Grabber] Fetching ${limit} bookmarks...`);

      const tweets = await this.bird.getBookmarks(limit);
      console.log(`[Grabber] Got ${tweets.length} bookmarks`);

      let processed = 0;
      let skipped = 0;

      for (const tweet of tweets) {
        if (this.db.isProcessed(tweet.id)) {
          skipped++;
          continue;
        }

        if (!this.db.tryLock(tweet.id)) {
          skipped++;
          continue;
        }

        try {
          await this.processTweet(tweet);
          processed++;
        } catch (error) {
          this.db.releaseLock(tweet.id, 'failed');
          await this.handleError(error, tweet.id);
        }

        await this.delay(500);
      }

      if (processed > 0 || skipped > 0) {
        console.log(`[Grabber] Processed: ${processed}, Skipped: ${skipped}`);
      }
    } catch (error) {
      await this.handleError(error);
    } finally {
      this.isProcessing = false;
    }
  }

  private async processTweet(tweet: Tweet): Promise<void> {
    console.log(`[Grabber] Processing: ${tweet.id} by @${tweet.authorUsername}`);

    // Phase 1: Agent triages and decides what enrichment is needed
    const { triage, analysis } = await this.agent.processTweet(tweet, async (triage) => {
      return this.fetchEnrichment(tweet, triage);
    });

    // Skip if agent decided it's not worth processing
    if (!analysis) {
      console.log(`[Grabber] Skipped: ${triage.skipReason || 'low value'}`);
      this.db.markProcessed({
        tweetId: tweet.id,
        processedAt: new Date().toISOString(),
        category: 'review',
        notionPageId: null,
        rawData: JSON.stringify({ tweet, triage, skipped: true }),
        status: 'completed',
      });
      return;
    }

    console.log(`[Grabber] Analysis: ${analysis.category} (score: ${analysis.relevanceScore})`);
    if (analysis.tldr) {
      console.log(`[Grabber] TL;DR: ${analysis.tldr}`);
    }

    let notionPageId: string | null = null;
    try {
      const existsInNotion = await this.notion.pageExists(tweet.id);
      if (existsInNotion) {
        console.log(`[Grabber] Skipping: already in Notion`);
        this.db.markProcessed({
          tweetId: tweet.id,
          processedAt: new Date().toISOString(),
          category: analysis.category,
          notionPageId: null,
          rawData: JSON.stringify({ tweet, triage, analysis, alreadyInNotion: true }),
          status: 'completed',
        });
        return;
      }
      
      notionPageId = await this.notion.createPage(tweet, analysis);
      console.log(`[Grabber] Created Notion page: ${notionPageId}`);
    } catch (error) {
      console.error('[Grabber] Notion sync failed:', error);
    }

    this.db.markProcessed({
      tweetId: tweet.id,
      processedAt: new Date().toISOString(),
      category: analysis.category,
      notionPageId,
      rawData: JSON.stringify({ tweet, triage, analysis }),
      status: 'completed',
    });
  }

  /**
   * Fetch all enrichment based on agent's triage decision
   */
  private async fetchEnrichment(tweet: Tweet, triage: TriageResult): Promise<EnrichedContext> {
    const context: EnrichedContext = {
      articles: [],
      transcripts: [],
      imageDescriptions: [],
      threadTweets: [],
    };

    // Fetch articles in parallel
    if (triage.needsArticleScrape.length > 0) {
      const urls = triage.needsArticleScrape
        .filter((a) => this.scraper.isScrapableUrl(a.url))
        .map((a) => a.url);

      if (urls.length > 0) {
        console.log(`[Grabber] Scraping ${urls.length} article(s)...`);
        const articles = await this.scraper.scrapeMultiple(urls);
        context.articles = articles.map((a) => ({
          url: a.url,
          content: a.content,
          title: a.title,
        }));
        console.log(`[Grabber] Scraped ${context.articles.length} article(s)`);
      }
    }

    // Fetch YouTube transcripts
    if (triage.needsYoutubeTranscript.length > 0) {
      console.log(`[Grabber] Fetching ${triage.needsYoutubeTranscript.length} transcript(s)...`);
      const transcriptResults = await Promise.all(
        triage.needsYoutubeTranscript.map(async (yt) => {
          const transcript = await this.youtube.getTranscript(yt.url);
          return transcript ? { url: yt.url, transcript } : null;
        })
      );
      context.transcripts = transcriptResults.filter((t): t is NonNullable<typeof t> => t !== null);
      console.log(`[Grabber] Got ${context.transcripts.length} transcript(s)`);
    }

    // Analyze images
    if (triage.needsImageAnalysis.length > 0) {
      console.log(`[Grabber] Analyzing ${triage.needsImageAnalysis.length} image(s)...`);
      const imageResults = await Promise.all(
        triage.needsImageAnalysis.map(async (img) => {
          const description = await this.agent.analyzeImage(img.url);
          return description ? { url: img.url, description } : null;
        })
      );
      context.imageDescriptions = imageResults.filter((i): i is NonNullable<typeof i> => i !== null);
      console.log(`[Grabber] Analyzed ${context.imageDescriptions.length} image(s)`);
    }

    // Expand thread if needed
    if (triage.needsThreadExpansion || tweet.isThread) {
      console.log('[Grabber] Expanding thread...');
      const threadTweets = await this.bird.getThread(tweet.id);
      context.threadTweets = threadTweets
        .filter((t) => t.id !== tweet.id)
        .map((t) => ({ id: t.id, text: t.text }));
      console.log(`[Grabber] Got ${context.threadTweets.length} thread tweet(s)`);
    }

    return context;
  }

  private async sendWeeklyDigest(): Promise<void> {
    const stats = this.db.getWeeklyStats();
    if (stats.totalProcessed === 0) return;

    const digest = await this.agent.generateDigest(
      { totalProcessed: stats.totalProcessed, byCategory: stats.byCategory as Record<Category, number> },
      stats.highlights,
    );

    await this.telegram.sendDigest(digest);
    console.log('[Grabber] Weekly digest sent');
  }

  private async handleError(error: unknown, tweetId?: string): Promise<void> {
    const grabberError = error instanceof GrabberError
      ? error
      : new GrabberError(
          error instanceof Error ? error.message : String(error),
          'UNKNOWN',
          false,
        );

    console.error(`[Grabber] Error${tweetId ? ` (tweet ${tweetId})` : ''}:`, grabberError.message);

    if (grabberError.code === 'AUTH_EXPIRED') {
      const { valid } = await this.bird.checkAuth();
      if (!valid) {
        this.authValid = false;
        await this.telegram.notifyAuthExpired();
      }
      return;
    }

    try {
      await this.telegram.notifyError(grabberError);
    } catch (telegramError) {
      console.error('[Grabber] Failed to send error to Telegram:', telegramError);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  stop(): void {
    this.db.close();
    console.log('[Grabber] Stopped');
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const grabber = new Grabber(config);

  process.on('SIGINT', () => {
    grabber.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    grabber.stop();
    process.exit(0);
  });

  await grabber.start();
}

main().catch((error) => {
  console.error('[Grabber] Fatal error:', error);
  process.exit(1);
});
