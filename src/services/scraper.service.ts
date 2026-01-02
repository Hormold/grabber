import Firecrawl from '@mendable/firecrawl-js';

export interface ScrapedArticle {
  url: string;
  title: string;
  content: string;
  excerpt?: string;
  byline?: string;
  siteName?: string;
}

export class ScraperService {
  private firecrawl: Firecrawl | null = null;

  constructor(apiKey?: string) {
    if (apiKey) {
      this.firecrawl = new Firecrawl({ apiKey });
    }
  }

  async scrapeArticle(url: string): Promise<ScrapedArticle | null> {
    if (!this.firecrawl) {
      console.warn('[Scraper] Firecrawl API key not configured, skipping scrape');
      return null;
    }

    try {
      const doc = await this.firecrawl.scrape(url, {
        formats: ['markdown'],
      });

      if (!doc.markdown) {
        console.warn(`[Scraper] Firecrawl returned no markdown for ${url}`);
        return null;
      }

      return {
        url,
        title: doc.metadata?.title || this.extractTitleFromUrl(url),
        content: doc.markdown,
        excerpt: doc.metadata?.description,
        siteName: doc.metadata?.ogSiteName || (doc.metadata?.url ? new URL(doc.metadata.url).hostname : undefined),
      };
    } catch (error) {
      console.warn(`[Scraper] Error scraping ${url}:`, error);
      return null;
    }
  }

  async scrapeMultiple(urls: string[]): Promise<ScrapedArticle[]> {
    const results = await Promise.allSettled(
      urls.map((url) => this.scrapeArticle(url))
    );

    return results
      .filter((r): r is PromiseFulfilledResult<ScrapedArticle | null> => r.status === 'fulfilled')
      .map((r) => r.value)
      .filter((a): a is ScrapedArticle => a !== null);
  }

  isScrapableUrl(url: string): boolean {
    try {
      const parsed = new URL(url);

      // Skip known non-article URLs
      const skipPatterns = [
        /youtube\.com/,
        /youtu\.be/,
        /twitter\.com/,
        /x\.com/,
        /github\.com\/.*\/(blob|tree|commit)/,
        /\.(png|jpg|jpeg|gif|webp|svg|mp4|mp3|pdf)$/i,
      ];

      return !skipPatterns.some((p) => p.test(parsed.href));
    } catch {
      return false;
    }
  }

  private extractTitleFromUrl(url: string): string {
    try {
      const parsed = new URL(url);
      const path = parsed.pathname.split('/').filter(Boolean).pop() || '';
      return path.replace(/[-_]/g, ' ').replace(/\.\w+$/, '') || parsed.hostname;
    } catch {
      return url;
    }
  }
}
