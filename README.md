# Grabber

Autonomous Twitter/X bookmark processor with AI-powered triage, enrichment, and Notion sync.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              GRABBER                                         │
│                   Autonomous Bookmark Processing Pipeline                    │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 1: FETCH                                                              │
│  Bird CLI → Bookmarks → Check if processed → Queue for analysis             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 2: TRIAGE (Agent decides autonomously)                               │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Gemini 3.0 Flash → Structured Output                                │   │
│  │  • needsArticleScrape: [{url, reason, priority}]                    │   │
│  │  • needsYoutubeTranscript: [{url, reason}]                          │   │
│  │  • needsImageAnalysis: [{url, expectedContent}]                     │   │
│  │  • needsThreadExpansion: boolean                                    │   │
│  │  • estimatedValue: high | medium | low | skip                       │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 3: ENRICH (Parallel fetching based on triage)                        │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐       │
│  │  Scraper     │ │  YouTube     │ │  Vision AI   │ │  Bird CLI    │       │
│  │ (Readability)│ │  (yt-dlp)    │ │ (Gemini 3)   │ │  (threads)   │       │
│  └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘       │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 4: ANALYZE (Final analysis with full context)                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Gemini 3.0 Flash → Structured Output                                │   │
│  │  • category, summary, tldr, keyInsights[]                           │   │
│  │  • extractedLinks[{url, title, type, description}]                  │   │
│  │  • tags[], relevanceScore (1-10)                                    │   │
│  │  • actionItems[{action, priority, context}]                         │   │
│  │  • quotes[], connections[]                                          │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
┌──────────────────────────────────┐ ┌────────────────────────────────────────┐
│  SQLite (internal)               │ │  Notion (UI/Database)                   │
│  • Deduplication                 │ │  • TL;DR, Summary, Category, Priority  │
│  • Weekly stats                  │ │  • Tags, Relevance Score, Action Items │
│  • Tracking                      │ │  • Key Insights, Quotes, Links         │
└──────────────────────────────────┘ │  • YouTube Transcripts, Article Content│
                                     └────────────────────────────────────────┘
```

## How It Works

1. **Fetch**: Bird CLI fetches Twitter/X bookmarks every 60s
2. **Triage**: AI autonomously decides what enrichment is needed:
   - Should we scrape article content?
   - Should we get YouTube transcript?
   - Should we analyze images with vision AI?
   - Is this worth processing at all?
3. **Enrich**: Based on triage, fetch all context in parallel
4. **Analyze**: With full context, AI produces comprehensive analysis
5. **Sync**: Structured data saved to Notion database
6. **Notify**: Telegram alerts on errors + weekly digest

### Categories
- `review` - Articles/threads to read later
- `try` - Tools/products to try
- `knowledge` - Info for knowledge base
- `podcast` - Audio content
- `video` - Video content
- `article` - Blog posts/long-form
- `tool` - Dev tools/libraries
- `project` - Ideas/inspiration

## Requirements

- Node.js 20+
- [`bird`](https://github.com/steipete/bird) CLI (`brew install steipete/tap/bird` or `npm i -g @steipete/bird`)
- `yt-dlp` (optional, for YouTube transcripts)
- Firecrawl API key (optional, for article scraping)
- Twitter/X account with bookmarks
- Notion integration token
- Telegram bot (for notifications)
- Google Gemini API key

## Installation

```bash
pnpm install
cp .env.example .env
# Edit .env with your credentials
```

## Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TWITTER_AUTH_TOKEN` | Yes | - | Twitter auth_token cookie |
| `TWITTER_CT0` | Yes | - | Twitter ct0 cookie |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Yes | - | Gemini API key |
| `NOTION_TOKEN` | Yes | - | Notion integration secret |
| `NOTION_PARENT_PAGE_ID` | Yes | - | Page ID where DB will be created |
| `TELEGRAM_BOT_TOKEN` | Yes | - | Telegram bot token |
| `TELEGRAM_CHAT_ID` | Yes | - | Chat ID for notifications |
| `FIRECRAWL_API_KEY` | No | - | Firecrawl API key for article scraping |
| `FIRST_RUN_LIMIT` | No | `200` | Bookmarks to fetch on first run |
| `POLL_INTERVAL_SECONDS` | No | `60` | Polling interval in seconds |
| `DB_PATH` | No | `./data/grabber.db` | SQLite database path |
| `DIGEST_CRON` | No | `0 10 * * 0` | Weekly digest schedule (Sunday 10:00) |

### Getting Twitter Cookies

1. Log into X/Twitter in Chrome
2. Open DevTools → Application → Cookies
3. Copy `auth_token` and `ct0` values

### Setting Up Notion

1. Create a [Notion integration](https://www.notion.so/my-integrations)
2. Create a page where the database will live
3. Share the page with your integration
4. Copy the page ID from the URL

## Usage

```bash
# Development (watch mode)
pnpm dev

# Production
pnpm build
pnpm start

# Docker
docker-compose up -d
```

## Services

### BirdService (`src/services/bird.service.ts`)
Wraps the `bird` CLI for Twitter API access:
- `getBookmarks(limit)` - Fetch bookmarks
- `readTweet(id)` - Read single tweet
- `getThread(id)` - Fetch full thread
- `checkAuth()` - Validate credentials

### AgentService (`src/services/agent.service.ts`)
AI analysis using Gemini 2.0 Flash:
- `analyzeTweet(tweet, options)` - Categorize and extract insights
- `analyzeImage(url)` - Vision analysis for images
- `generateDigest(stats, highlights)` - Weekly summary

### YoutubeService (`src/services/youtube.service.ts`)
YouTube transcript extraction via `yt-dlp`:
- `getTranscript(url)` - Extract video transcript
- `getVideoInfo(url)` - Get video metadata

### NotionService (`src/services/notion.service.ts`)
Notion database management:
- Auto-creates "Grabber Bookmarks" database
- Creates structured pages with:
  - Category, author, relevance score
  - Tags (multi-select)
  - Original tweet, summary, quotes
  - Extracted links, YouTube transcripts

### TelegramService (`src/services/telegram.service.ts`)
Notifications:
- `notifyError(error)` - Error alerts with retry status
- `notifyAuthExpired()` - Cookie expiration warning
- `sendDigest(markdown)` - Weekly summary

### DbService (`src/services/db.service.ts`)
SQLite persistence (WAL mode):
- Deduplication via tweet ID
- Weekly stats aggregation
- Top tags and highlights extraction

## Data Flow

```
Bird CLI → Bookmarks → [YouTube?] → Gemini Analysis → Notion Page
                ↓                         ↓
            SQLite DB              Telegram (errors)
                ↓
        Weekly Digest → Telegram
```

## Error Handling

| Error Code | Meaning | Auto-Retry |
|------------|---------|------------|
| `AUTH_EXPIRED` | Twitter cookies expired | No |
| `RATE_LIMIT` | Twitter rate limit hit | Yes |
| `NETWORK` | Network/timeout error | Yes |
| `NOTION` | Notion API error | Yes |
| `TELEGRAM` | Telegram send failed | Yes |

## Testing

```bash
pnpm test        # Watch mode
pnpm test:run    # Single run
```

## Scripts

| Script | Description |
|--------|-------------|
| `pnpm dev` | Development with hot reload |
| `pnpm build` | Compile TypeScript |
| `pnpm start` | Run compiled code |
| `pnpm typecheck` | Type checking only |
| `pnpm test` | Run tests (watch) |
| `pnpm test:run` | Run tests (once) |

## Docker

```yaml
# docker-compose.yml
services:
  grabber:
    build: .
    env_file: .env
    volumes:
      - ./data:/app/data
    restart: unless-stopped
```

## License

MIT
