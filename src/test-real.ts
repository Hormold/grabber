import { BirdService } from './services/bird.service.js';
import { AgentService } from './services/agent.service.js';
import { YoutubeService } from './services/youtube.service.js';
import { ScraperService } from './services/scraper.service.js';
import type { TriageResult, EnrichedContext } from './services/agent.service.js';
import type { Tweet } from './types/index.js';

async function main() {
  console.log('🚀 Testing with real data...\n');

  const bird = new BirdService({
    authToken: process.env.TWITTER_AUTH_TOKEN,
    ct0: process.env.TWITTER_CT0,
  });

  const agent = new AgentService();
  const youtube = new YoutubeService();
  const scraper = new ScraperService(process.env.FIRECRAWL_API_KEY);

  // Check auth
  console.log('📋 Checking auth...');
  const authOk = await bird.checkAuth();
  if (!authOk) {
    console.error('❌ Auth failed - check your cookies');
    process.exit(1);
  }
  console.log('✅ Auth OK\n');

  // Fetch bookmarks
  console.log('📚 Fetching bookmarks (limit: 10)...');
  const tweets = await bird.getBookmarks(10);
  console.log(`✅ Got ${tweets.length} bookmarks\n`);

  let processed = 0;
  let skipped = 0;
  const startTime = Date.now();

  for (let i = 0; i < tweets.length; i++) {
    const tweet = tweets[i];
    console.log('\n' + '═'.repeat(80));
    console.log(`\n[${i + 1}/${tweets.length}] 📌 Tweet by @${tweet.authorUsername} (${tweet.authorName}):`);
    console.log(`   ID: ${tweet.id}`);
    console.log(`   Created: ${tweet.createdAt}`);
    console.log('   ─'.repeat(35));
    console.log(`   TEXT:\n   ${tweet.text.replace(/\n/g, '\n   ')}`);
    console.log('   ─'.repeat(35));
    console.log(`   URLs (${tweet.urls.length}): ${tweet.urls.length > 0 ? '\n      ' + tweet.urls.join('\n      ') : 'none'}`);
    console.log(`   Images: ${tweet.images.length}`);
    console.log(`   Is Thread: ${tweet.isThread}`);

    // Phase 1: Triage
    console.log('\n🔍 Phase 1: TRIAGE (AI decides what enrichment needed)...');
    const triageStart = Date.now();
    const triage = await agent.triage(tweet);
    console.log(`   ⏱️  Triage took: ${Date.now() - triageStart}ms`);
    console.log(`   Content type: ${triage.contentType}`);
    console.log(`   Estimated value: ${triage.estimatedValue}`);
    if (triage.needsArticleScrape.length > 0) {
      console.log(`   📄 Articles to scrape:`);
      triage.needsArticleScrape.forEach(a => console.log(`      - ${a.url} (${a.priority}) - ${a.reason}`));
    }
    if (triage.needsYoutubeTranscript.length > 0) {
      console.log(`   🎬 YouTube transcripts needed:`);
      triage.needsYoutubeTranscript.forEach(y => console.log(`      - ${y.url} - ${y.reason}`));
    }
    if (triage.needsImageAnalysis.length > 0) {
      console.log(`   🖼️  Images to analyze:`);
      triage.needsImageAnalysis.forEach(img => console.log(`      - ${img.url} - expects: ${img.expectedContent}`));
    }
    console.log(`   Thread expansion: ${triage.needsThreadExpansion ? 'yes' : 'no'}`);

    if (triage.estimatedValue === 'skip') {
      console.log(`   ⏭️  Skipping: ${triage.skipReason}`);
      skipped++;
      continue;
    }

    processed++;

    // Phase 2: Enrich
    console.log('\n📥 Phase 2: Enrichment...');
    const context = await fetchEnrichment(tweet, triage, scraper, youtube);
    console.log(`   Articles scraped: ${context.articles.length}`);
    console.log(`   Transcripts: ${context.transcripts.length}`);
    console.log(`   Images analyzed: ${context.imageDescriptions.length}`);

    // Log scraped article content preview
    for (const article of context.articles) {
      console.log(`\n   📄 Article: ${article.title}`);
      console.log(`      ${article.content.slice(0, 300)}...`);
    }

    // Phase 3: Analyze
    console.log('\n🧠 Phase 3: ANALYSIS (AI produces final structured output)...');
    const analysisStart = Date.now();
    const analysis = await agent.analyze(tweet, triage, context);
    console.log(`   ⏱️  Analysis took: ${Date.now() - analysisStart}ms`);
    const scoreVisual = analysis.relevanceScore >= 9 ? '🔥🔥🔥' : analysis.relevanceScore >= 7 ? '🔥🔥' : analysis.relevanceScore >= 4 ? '🔥' : '';
    console.log('   ─'.repeat(35));
    console.log(`   ${scoreVisual} ${analysis.relevanceScore}/10 | ${analysis.category} | ${analysis.hasArticle ? '📄' : ''}${analysis.hasVideo ? '🎬' : ''}${analysis.hasThread ? '🧵' : ''}`);
    console.log(`   📌 Topic: ${analysis.topic}`);
    console.log(`   🏷️  Tags: ${analysis.tags.join(', ')}`);
    console.log('   ─'.repeat(35));
    console.log(`   💡 FOR YOU: ${analysis.forYou}`);
    if (analysis.topAction) console.log(`   ✅ TOP ACTION: ${analysis.topAction}`);
    if (analysis.primaryLink) console.log(`   🔗 PRIMARY LINK: ${analysis.primaryLink}`);
    console.log('   ─'.repeat(35));
    console.log(`   📝 TL;DR:\n      ${analysis.tldr}`);
    console.log(`   📖 Summary:\n      ${analysis.summary}`);
    if (analysis.keyInsights && analysis.keyInsights.length > 0) {
      console.log(`   💡 Key Insights (${analysis.keyInsights.length}):`);
      analysis.keyInsights.forEach((insight, idx) => console.log(`      ${idx + 1}. ${insight}`));
    }
    if (analysis.quotes && analysis.quotes.length > 0) {
      console.log(`   💬 Quotes (${analysis.quotes.length}):`);
      analysis.quotes.forEach(q => console.log(`      "${q}"`));
    }
    if (analysis.extractedLinks && analysis.extractedLinks.length > 0) {
      console.log(`   🔗 Extracted Links (${analysis.extractedLinks.length}):`);
      analysis.extractedLinks.forEach(l => console.log(`      [${l.type}] ${l.title}: ${l.url}`));
    }
    if (analysis.actionItems && analysis.actionItems.length > 0) {
      console.log(`   ✅ Action Items (${analysis.actionItems.length}):`);
      analysis.actionItems.forEach(a => console.log(`      [${a.priority}] ${a.action}${a.context ? ` (${a.context})` : ''}`));
    }
    if (analysis.connections && analysis.connections.length > 0) {
      console.log(`   🔄 Connections: ${analysis.connections.join(', ')}`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n' + '═'.repeat(80));
  console.log(`\n📊 SUMMARY:`);
  console.log(`   Total tweets: ${tweets.length}`);
  console.log(`   Processed: ${processed}`);
  console.log(`   Skipped: ${skipped}`);
  console.log(`   Time: ${elapsed}s`);
  console.log('✅ Done!');
}

async function fetchEnrichment(
  tweet: Tweet,
  triage: TriageResult,
  scraper: ScraperService,
  youtube: YoutubeService
): Promise<EnrichedContext> {
  const context: EnrichedContext = {
    articles: [],
    transcripts: [],
    imageDescriptions: [],
    threadTweets: [],
  };

  // Scrape articles
  for (const req of triage.needsArticleScrape) {
    if (scraper.isScrapableUrl(req.url)) {
      console.log(`      Scraping: ${req.url}`);
      const article = await scraper.scrapeArticle(req.url);
      if (article) {
        context.articles.push({
          url: article.url,
          title: article.title,
          content: article.content,
        });
      }
    }
  }

  // Get YouTube transcripts
  for (const req of triage.needsYoutubeTranscript) {
    const videoId = youtube.extractVideoId(req.url);
    if (videoId) {
      console.log(`      Getting transcript for: ${req.url}`);
      const transcript = await youtube.getTranscript(videoId);
      if (transcript) {
        context.transcripts.push({ url: req.url, transcript });
      }
    }
  }

  return context;
}

main().catch(console.error);
