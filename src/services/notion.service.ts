import { Client } from '@notionhq/client';
import type { Tweet, AnalysisResult } from '../types/index.js';
import { GrabberError } from '../types/index.js';

export class NotionService {
  private client: Client;
  private parentPageId: string;
  private databaseId: string | null = null;

  constructor(token: string, parentPageId: string) {
    this.client = new Client({ auth: token });
    this.parentPageId = parentPageId;
  }

  async ensureDatabase(): Promise<string> {
    if (this.databaseId) return this.databaseId;

    const existing = await this.findExistingDatabase();
    if (existing) {
      this.databaseId = existing;
      return existing;
    }

    this.databaseId = await this.createDatabase();
    return this.databaseId;
  }

  private async findExistingDatabase(): Promise<string | null> {
    try {
      const response = await this.client.blocks.children.list({
        block_id: this.parentPageId,
        page_size: 100,
      });

      for (const block of response.results) {
        if ('type' in block && block.type === 'child_database') {
          const db = block as { id: string; child_database?: { title: string } };
          if (db.child_database?.title === 'Grabber Bookmarks') {
            return block.id;
          }
        }
      }
    } catch {
      return null;
    }
    return null;
  }

  private async createDatabase(): Promise<string> {
    try {
      const response = await this.client.databases.create({
        parent: { type: 'page_id', page_id: this.parentPageId },
        title: [{ type: 'text', text: { content: 'Grabber Bookmarks' } }],
        properties: {
          Topic: { title: {} },
          Score: { number: {} },
          'Score Visual': {
            formula: {
              expression: 'if(prop("Score") >= 9, "🔥🔥🔥", if(prop("Score") >= 7, "🔥🔥", if(prop("Score") >= 4, "🔥", "")))',
            },
          },
          Author: { rich_text: {} },
          Category: {
            select: {
              options: [
                { name: 'review', color: 'blue' },
                { name: 'try', color: 'green' },
                { name: 'knowledge', color: 'yellow' },
                { name: 'podcast', color: 'purple' },
                { name: 'video', color: 'red' },
                { name: 'article', color: 'orange' },
                { name: 'tool', color: 'pink' },
                { name: 'project', color: 'gray' },
                { name: 'fun', color: 'brown' },
              ],
            },
          },
          'For You': { rich_text: {} },
          Priority: {
            select: {
              options: [
                { name: 'now', color: 'red' },
                { name: 'this-week', color: 'yellow' },
                { name: 'someday', color: 'gray' },
              ],
            },
          },
          'Top Action': { rich_text: {} },
          'Primary Link': { url: {} },
          'Has Article': { checkbox: {} },
          'Has Video': { checkbox: {} },
          'Has Thread': { checkbox: {} },
          'TL;DR': { rich_text: {} },
          Summary: { rich_text: {} },
          Tags: { multi_select: { options: [] } },
          'Tweet URL': { url: {} },
          'Created At': { date: {} },
          'Processed At': { date: {} },
        },
      });

      return response.id;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new GrabberError(`Failed to create Notion database: ${msg}`, 'NOTION', false);
    }
  }

  async createPage(
    tweet: Tweet,
    analysis: AnalysisResult,
  ): Promise<string> {
    const dbId = await this.ensureDatabase();

    const topPriority = analysis.actionItems?.[0]?.priority || 'someday';

    try {
      const response = await this.client.pages.create({
        parent: { database_id: dbId },
        properties: {
          Topic: {
            title: [{ text: { content: this.truncate(analysis.topic || analysis.tldr || analysis.summary, 50) } }],
          },
          Score: { number: analysis.relevanceScore },
          Author: {
            rich_text: [{ text: { content: `@${tweet.authorUsername}` } }],
          },
          Category: { select: { name: analysis.category } },
          'For You': {
            rich_text: [{ text: { content: this.truncate(analysis.forYou || '', 250) } }],
          },
          Priority: { select: { name: topPriority } },
          'Top Action': {
            rich_text: [{ text: { content: this.truncate(analysis.topAction || '', 100) } }],
          },
          'Primary Link': analysis.primaryLink ? { url: analysis.primaryLink } : { url: null },
          'Has Article': { checkbox: analysis.hasArticle || false },
          'Has Video': { checkbox: analysis.hasVideo || false },
          'Has Thread': { checkbox: analysis.hasThread || false },
          'TL;DR': {
            rich_text: [{ text: { content: this.truncate(analysis.tldr || '', 280) } }],
          },
          Summary: {
            rich_text: [{ text: { content: this.truncate(analysis.summary, 2000) } }],
          },
          Tags: {
            multi_select: analysis.tags.slice(0, 7).map((tag) => ({ name: tag })),
          },
          'Tweet URL': { url: `https://x.com/${tweet.authorUsername}/status/${tweet.id}` },
          'Created At': { date: { start: new Date(tweet.createdAt).toISOString() } },
          'Processed At': { date: { start: new Date().toISOString() } },
        },
        children: this.buildPageContent(tweet, analysis),
      });

      return response.id;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new GrabberError(`Failed to create Notion page: ${msg}`, 'NOTION', true);
    }
  }

  async pageExists(tweetId: string): Promise<boolean> {
    const dbId = await this.ensureDatabase();

    try {
      const response = await this.client.databases.query({
        database_id: dbId,
        filter: {
          property: 'Tweet URL',
          url: { contains: tweetId },
        },
        page_size: 1,
      });

      return response.results.length > 0;
    } catch {
      return false;
    }
  }

  private buildPageContent(tweet: Tweet, analysis: AnalysisResult) {
    const blocks: Parameters<typeof this.client.pages.create>[0]['children'] = [];
    const scoreVisual = analysis.relevanceScore >= 9 ? '🔥🔥🔥' : analysis.relevanceScore >= 7 ? '🔥🔥' : analysis.relevanceScore >= 4 ? '🔥' : '';
    const tweetUrl = `https://x.com/${tweet.authorUsername}/status/${tweet.id}`;

    // Header: score + author + category
    blocks.push({
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [
          { type: 'text', text: { content: `${scoreVisual} ${analysis.relevanceScore}/10 • ` }, annotations: { bold: true } },
          { type: 'text', text: { content: `@${tweet.authorUsername}`, link: { url: tweetUrl } } },
          { type: 'text', text: { content: ` • ${analysis.category}` }, annotations: { color: 'gray' } },
        ],
      },
    });

    // Summary
    blocks.push({
      object: 'block',
      type: 'paragraph',
      paragraph: { rich_text: [{ type: 'text', text: { content: analysis.summary } }] },
    });

    // FOR YOU (compact)
    if (analysis.forYou) {
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [
            { type: 'text', text: { content: '💡 ' } },
            { type: 'text', text: { content: analysis.forYou }, annotations: { italic: true } },
          ],
        },
      });
    }

    blocks.push({ object: 'block', type: 'divider', divider: {} });

    // Original tweet
    blocks.push({
      object: 'block',
      type: 'quote',
      quote: { rich_text: [{ type: 'text', text: { content: this.truncate(tweet.text, 2000) } }] },
    });

    // Images
    for (const imageUrl of tweet.images.slice(0, 4)) {
      blocks.push({
        object: 'block',
        type: 'image',
        image: { type: 'external', external: { url: imageUrl } },
      });
    }

    // Primary Link
    if (analysis.primaryLink) {
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [
            { type: 'text', text: { content: '🔗 ' } },
            { type: 'text', text: { content: analysis.primaryLink, link: { url: analysis.primaryLink } } },
          ],
        },
      });
    }

    // Key Insights (compact)
    const keyInsights = analysis.keyInsights || [];
    if (keyInsights.length > 0) {
      for (const insight of keyInsights.slice(0, 5)) {
        blocks.push({
          object: 'block',
          type: 'bulleted_list_item',
          bulleted_list_item: { rich_text: [{ type: 'text', text: { content: insight } }] },
        });
      }
    }

    // Links (compact, no header)
    if (analysis.extractedLinks.length > 0) {
      for (const link of analysis.extractedLinks.slice(0, 5)) {
        const typeEmoji = link.type === 'tool' ? '🛠️' : link.type === 'repo' ? '📦' : link.type === 'video' ? '🎬' : link.type === 'docs' ? '📚' : '🔗';
        blocks.push({
          object: 'block',
          type: 'bulleted_list_item',
          bulleted_list_item: {
            rich_text: [
              { type: 'text', text: { content: `${typeEmoji} ` } },
              { type: 'text', text: { content: link.title, link: { url: link.url } } },
            ],
          },
        });
      }
    }

    // Collapsible extras
    const extras: Array<{ label: string; content: string }> = [];
    if (analysis.quotes.length > 0) extras.push({ label: '💎 Quotes', content: analysis.quotes.join('\n\n') });
    if (analysis.youtubeTranscript) extras.push({ label: '🎬 Transcript', content: analysis.youtubeTranscript });
    if (analysis.articleContent) extras.push({ label: '📄 Article', content: analysis.articleContent });

    for (const extra of extras) {
      blocks.push({
        object: 'block',
        type: 'toggle',
        toggle: {
          rich_text: [{ type: 'text', text: { content: extra.label } }],
          children: [{
            object: 'block',
            type: 'paragraph',
            paragraph: { rich_text: [{ type: 'text', text: { content: this.truncate(extra.content, 2000) } }] },
          }],
        },
      });
    }

    return blocks;
  }

  private truncate(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength - 3) + '...';
  }
}
