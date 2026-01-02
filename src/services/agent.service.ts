import { generateObject } from 'ai';
import { google } from '@ai-sdk/google';
import { z } from 'zod';
import type { Tweet, AnalysisResult, Category } from '../types/index.js';

// Phase 1: Agent decides what enrichment is needed
const TriageSchema = z.object({
  needsArticleScrape: z.array(z.object({
    url: z.string(),
    reason: z.string().describe('Why this article should be fetched'),
    priority: z.enum(['high', 'medium', 'low']),
  })).describe('URLs that should be scraped for full article content'),

  needsYoutubeTranscript: z.array(z.object({
    url: z.string(),
    reason: z.string(),
  })).describe('YouTube URLs that need transcript extraction'),

  needsImageAnalysis: z.array(z.object({
    url: z.string(),
    expectedContent: z.string().describe('What the image likely contains based on context'),
  })).describe('Image URLs that need AI vision analysis'),

  needsThreadExpansion: z.boolean().describe('Whether this looks like a thread that should be expanded'),

  contentType: z.enum(['tweet', 'thread', 'article_share', 'video_share', 'image_post', 'tool_announcement', 'discussion'])
    .describe('Initial classification of what this content is'),

  estimatedValue: z.enum(['high', 'medium', 'low', 'skip'])
    .describe('How valuable this bookmark appears to be'),

  skipReason: z.string().optional()
    .describe('If estimatedValue is skip, why should we skip processing'),
});

// User context for personalized "For You" scoring
const USER_CONTEXT = `
You are scoring content for a senior TypeScript/React/Node.js engineer with these interests:
- AI/LLM integrations, coding agents (Claude Code, OpenCode plugins)
- Type safety everywhere (Zod, TypeScript strict mode)
- Developer experience tools (Vite, Bun, Turbopack)
- Performance optimization, architecture-first approach
- SOLID principles, clean code, refactoring patterns
- React + Tailwind + shadcn/ui stack
- NestJS-like backend patterns, PostgreSQL + Prisma
- Mobile development with Expo/React Native

HIGH relevance: AI tools, coding agents, TypeScript tooling, React patterns, performance tips, new dev tools
MEDIUM relevance: General programming wisdom, interesting tech, case studies
LOW relevance: Non-technical, marketing fluff, generic advice, languages other than TS/JS
`;

// Phase 2: Final analysis with enriched context
const AnalysisSchema = z.object({
  category: z.enum(['review', 'try', 'knowledge', 'podcast', 'video', 'article', 'tool', 'project', 'fun']),

  topic: z.string()
    .describe('Short scannable title - noun phrase, ~50 chars. Examples: "Claude Code Review Plugin", "React 19 Suspense Patterns"'),

  summary: z.string()
    .describe('2-3 sentence summary focusing on WHY this matters, not just WHAT it is'),

  tldr: z.string()
    .describe('Tweet-length summary for quick scanning'),

  forYou: z.string()
    .describe('Why this matters to YOU specifically. Be specific: "Applicable to your opencode plugin" not "useful for developers"'),

  topAction: z.string()
    .optional()
    .describe('Single most important action. Verb phrase: "Try the parallel agent pattern", "Read the architecture section"'),

  primaryLink: z.string()
    .optional()
    .describe('Main actionable URL - the most important link to click'),

  hasArticle: z.boolean()
    .describe('True if this links to a substantial article/blog post'),

  hasVideo: z.boolean()
    .describe('True if this contains video content (YouTube, etc)'),

  hasThread: z.boolean()
    .describe('True if this is a Twitter thread with multiple tweets'),

  keyInsights: z.array(z.string())
    .describe('Most important takeaways (up to 5) - things you\'d tell a colleague'),

  quotes: z.array(z.string())
    .describe('Notable quotes worth saving verbatim'),

  extractedLinks: z.array(z.object({
    url: z.string(),
    title: z.string(),
    type: z.enum(['article', 'tool', 'repo', 'video', 'docs', 'other']),
    description: z.string(),
  })).describe('Links found with full context about what each contains'),

  tags: z.array(z.string())
    .describe('Specific, useful tags for filtering (up to 7), e.g., "react", "performance", "ai-tools"'),

  relevanceScore: z.number().min(1).max(10)
    .describe('1-10 score based on USER CONTEXT: 1-3 low value, 4-6 interesting, 7-8 valuable, 9-10 must-act-now'),

  actionItems: z.array(z.object({
    action: z.string(),
    priority: z.enum(['now', 'this-week', 'someday']),
    context: z.string().optional(),
  })).describe('Specific things to do based on this content'),

  connections: z.array(z.string())
    .optional()
    .describe('How this connects to other knowledge areas or projects'),
});

export type TriageResult = z.infer<typeof TriageSchema>;
export type EnrichedContext = {
  articles: Array<{ url: string; content: string; title?: string }>;
  transcripts: Array<{ url: string; transcript: string }>;
  imageDescriptions: Array<{ url: string; description: string }>;
  threadTweets: Array<{ id: string; text: string }>;
};

export class AgentService {
  private model = google('gemini-3-flash-preview');
  private visionModel = google('gemini-3-flash-preview'); // Also supports vision

  /**
   * Phase 1: Triage - Agent autonomously decides what enrichment is needed
   */
  async triage(tweet: Tweet): Promise<TriageResult> {
    const { object } = await generateObject({
      model: this.model,
      schema: TriageSchema,
      prompt: `You are a smart bookmark triage agent. Analyze this tweet and decide what additional context we need to fetch to properly understand and categorize it.

TWEET by @${tweet.authorUsername} (${tweet.authorName}):
${tweet.text}

${tweet.urls.length > 0 ? `LINKS FOUND:\n${tweet.urls.map((u, i) => `${i + 1}. ${u}`).join('\n')}` : 'No links found.'}

${tweet.images.length > 0 ? `IMAGES: ${tweet.images.length} image(s) attached` : ''}

${tweet.isThread ? 'NOTE: This appears to be part of a thread.' : ''}

DECIDE:
1. Which URLs need full article scraping? (blogs, articles, documentation)
2. Which YouTube URLs need transcript extraction?
3. Which images need AI vision analysis to understand context?
4. Should we expand the full thread?
5. What type of content is this?
6. Is this valuable enough to process, or should we skip?

Be strategic - don't fetch everything, only what adds real value.
Skip low-effort retweets, memes without substance, or spam.`,
    });

    return object;
  }

  /**
   * Phase 2: Analyze - With all enriched context, produce final analysis
   */
  async analyze(tweet: Tweet, triage: TriageResult, context: EnrichedContext): Promise<AnalysisResult> {
    const enrichedPrompt = this.buildEnrichedPrompt(tweet, triage, context);

    const { object } = await generateObject({
      model: this.model,
      schema: AnalysisSchema,
      prompt: enrichedPrompt,
    });

    return {
      ...object,
      hasThread: object.hasThread || context.threadTweets.length > 0,
      hasVideo: object.hasVideo || context.transcripts.length > 0,
      hasArticle: object.hasArticle || context.articles.length > 0,
      youtubeTranscript: context.transcripts[0]?.transcript,
      articleContent: context.articles[0]?.content,
      imageAnalysis: context.imageDescriptions.map((d) => d.description),
    };
  }

  /**
   * Convenience method: Full autonomous pipeline
   * Triage → Enrich (caller provides) → Analyze
   */
  async processTweet(
    tweet: Tweet,
    enrichmentFetcher: (triage: TriageResult) => Promise<EnrichedContext>
  ): Promise<{ triage: TriageResult; analysis: AnalysisResult | null }> {
    // Phase 1: Triage
    const triage = await this.triage(tweet);

    // Skip if agent decides it's not worth processing
    if (triage.estimatedValue === 'skip') {
      console.log(`[Agent] Skipping: ${triage.skipReason}`);
      return { triage, analysis: null };
    }

    // Phase 2: Fetch enrichment (caller handles actual fetching)
    const context = await enrichmentFetcher(triage);

    // Phase 3: Final analysis
    const analysis = await this.analyze(tweet, triage, context);

    return { triage, analysis };
  }

  /**
   * Legacy method for backward compatibility
   */
  async analyzeTweet(
    tweet: Tweet,
    options?: {
      articleContent?: string;
      youtubeTranscript?: string;
      imageDescriptions?: string[];
    }
  ): Promise<AnalysisResult> {
    // Convert legacy options to new context format
    const context: EnrichedContext = {
      articles: options?.articleContent ? [{ url: '', content: options.articleContent }] : [],
      transcripts: options?.youtubeTranscript ? [{ url: '', transcript: options.youtubeTranscript }] : [],
      imageDescriptions: options?.imageDescriptions?.map((d) => ({ url: '', description: d })) || [],
      threadTweets: tweet.threadTweets || [],
    };

    // Create a basic triage (skip the triage phase for legacy calls)
    const triage: TriageResult = {
      needsArticleScrape: [],
      needsYoutubeTranscript: [],
      needsImageAnalysis: [],
      needsThreadExpansion: false,
      contentType: 'tweet',
      estimatedValue: 'medium',
    };

    return this.analyze(tweet, triage, context);
  }

  /**
   * Analyze image using vision model
   */
  async analyzeImage(imageUrl: string): Promise<string> {
    try {
      const { object } = await generateObject({
        model: this.visionModel,
        schema: z.object({
          description: z.string().describe('Detailed description of image content'),
          hasText: z.boolean().describe('Whether image contains readable text'),
          extractedText: z.string().optional().describe('Any text visible in the image'),
          contentType: z.enum(['screenshot', 'diagram', 'photo', 'meme', 'chart', 'code', 'other']),
          keyElements: z.array(z.string()).describe('Key visual elements'),
          relevance: z.string().describe('Why this image is relevant to the tweet'),
        }),
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Analyze this image thoroughly. Extract all text, describe diagrams, identify key information.',
              },
              { type: 'image', image: new URL(imageUrl) },
            ],
          },
        ],
      });

      const parts = [object.description];
      if (object.extractedText) {
        parts.push(`\n📝 Text: ${object.extractedText}`);
      }
      if (object.keyElements.length > 0) {
        parts.push(`\n🔑 Key elements: ${object.keyElements.join(', ')}`);
      }
      return parts.join('');
    } catch (error) {
      console.warn('[Agent] Image analysis failed:', imageUrl, error);
      return '';
    }
  }

  /**
   * Generate weekly digest
   */
  async generateDigest(
    stats: { totalProcessed: number; byCategory: Record<Category, number> },
    highlights: Array<{ summary: string; category: Category }>
  ): Promise<string> {
    const { object } = await generateObject({
      model: this.model,
      schema: z.object({
        digest: z.string().describe('Weekly digest in markdown'),
        patterns: z.array(z.string()).describe('Patterns noticed in saved content'),
        recommendations: z.array(z.string()).describe('Actionable recommendations'),
        topPicks: z.array(z.object({
          summary: z.string(),
          why: z.string(),
        })).max(3).describe('Top 3 items to prioritize'),
      }),
      prompt: `Generate a weekly digest for bookmarked content.

STATS:
- Total processed: ${stats.totalProcessed}
- By category: ${JSON.stringify(stats.byCategory, null, 2)}

TOP HIGHLIGHTS:
${highlights.map((h) => `- [${h.category}] ${h.summary}`).join('\n')}

Create an actionable weekly summary. Focus on:
1. What themes emerged this week?
2. What should be prioritized?
3. Any patterns in interests?
4. Specific next actions.`,
    });

    const topPicks = object.topPicks || [];
    const patterns = object.patterns || [];
    const recommendations = object.recommendations || [];

    let result = `# 📚 Weekly Bookmark Digest\n\n${object.digest}`;

    if (topPicks.length > 0) {
      result += `\n\n## 🎯 Top Picks This Week\n${topPicks.map((p) => `- **${p.summary}**\n  _${p.why}_`).join('\n')}`;
    }

    if (patterns.length > 0) {
      result += `\n\n## 📊 Patterns Noticed\n${patterns.map((p) => `- ${p}`).join('\n')}`;
    }

    if (recommendations.length > 0) {
      result += `\n\n## 💡 Recommendations\n${recommendations.map((r) => `- ${r}`).join('\n')}`;
    }

    return result;
  }

  private buildEnrichedPrompt(tweet: Tweet, triage: TriageResult, context: EnrichedContext): string {
    const sections: string[] = [];

    sections.push(`## USER CONTEXT (for personalized scoring)
${USER_CONTEXT}`);

    sections.push(`## ORIGINAL TWEET
**@${tweet.authorUsername}** (${tweet.authorName})

${tweet.text}

_Content type identified: ${triage.contentType}_
_Estimated value: ${triage.estimatedValue}_`);

    // Thread content
    if (context.threadTweets.length > 0) {
      sections.push(`## THREAD CONTINUATION (${context.threadTweets.length} more tweets)
${context.threadTweets.map((t, i) => `[${i + 2}] ${t.text}`).join('\n\n')}`);
    }

    // Scraped articles
    if (context.articles.length > 0) {
      sections.push(`## ARTICLE CONTENT
${context.articles.map((a) => `### ${a.title || a.url}
${a.content.slice(0, 8000)}${a.content.length > 8000 ? '\n\n[...truncated]' : ''}`).join('\n\n---\n\n')}`);
    }

    // YouTube transcripts
    if (context.transcripts.length > 0) {
      sections.push(`## VIDEO TRANSCRIPTS
${context.transcripts.map((t) => `### ${t.url}
${t.transcript.slice(0, 6000)}${t.transcript.length > 6000 ? '\n\n[...truncated]' : ''}`).join('\n\n---\n\n')}`);
    }

    // Image descriptions
    if (context.imageDescriptions.length > 0) {
      sections.push(`## IMAGE ANALYSIS
${context.imageDescriptions.map((d, i) => `### Image ${i + 1}
${d.description}`).join('\n\n')}`);
    }

    sections.push(`## YOUR TASK
Analyze all the above content and produce a comprehensive analysis.

You have the FULL context now - the original tweet plus all enriched content.

CRITICAL - Use the USER CONTEXT above to:
1. Score **relevanceScore** based on how useful this is to THIS SPECIFIC USER
2. Write **forYou** explaining why THIS USER should care (be specific, reference their stack/interests)
3. Suggest **topAction** that makes sense for THIS USER's work

General guidelines:
- **topic**: Short noun phrase ≤50 chars. "Claude Code Review Plugin" not "A new plugin for Claude Code that reviews..."
- **forYou**: Be specific. "Applicable to your opencode plugin work" not "useful for developers"
- **topAction**: Verb phrase. "Try the parallel agent pattern" not "This could be tried"
- **primaryLink**: Pick the MOST actionable URL (repo > docs > article > video)
- **hasArticle/hasVideo/hasThread**: Set content type flags based on what's present
- **relevanceScore**: BE CRITICAL. 9-10 = must act now, 7-8 = very valuable, 4-6 = interesting, 1-3 = low value

Categories:
- review: Read/review later (articles, threads)
- try: Tools/products to try
- knowledge: Info for knowledge base
- podcast: Audio content
- video: Video content
- article: Long-form articles
- tool: Dev tools, libraries, repos
- project: Ideas, inspiration, case studies
- fun: Memes, random photos, entertainment, non-technical content, jokes, personal posts NOT relevant to dev work`);

    return sections.join('\n\n---\n\n');
  }
}
