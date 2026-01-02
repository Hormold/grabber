# Grabber

Twitter bookmark processor with AI analysis and Notion export.

## Setup

```bash
pnpm install
cd vendor/bird && bun install && cd ../..
```

## Environment Variables

Create `.env`:
```bash
# Twitter (from cookie dumper)
TWITTER_AUTH_TOKEN=xxx
TWITTER_CT0=xxx

# Required
GOOGLE_GENERATIVE_AI_API_KEY=xxx
NOTION_TOKEN=xxx
NOTION_PARENT_PAGE_ID=xxx
TELEGRAM_BOT_TOKEN=xxx
TELEGRAM_CHAT_ID=xxx

# Optional
FIRECRAWL_API_KEY=xxx
FIRST_RUN_LIMIT=200
POLL_INTERVAL_SECONDS=60
```

## Running

```bash
# Dump Twitter cookies first
bun run bin/dump-twitter-cookies.ts -o .env.twitter
cat .env.twitter >> .env

# Run
bun run src/index.ts
```

## Docker

```bash
# Build
docker build -t grabber .

# Dump cookies for Docker
bun run bin/dump-twitter-cookies.ts -o docker-cookies.env

# Run (merge all env vars)
docker run --rm \
  --env-file docker-cookies.env \
  -e GOOGLE_GENERATIVE_AI_API_KEY=xxx \
  -e NOTION_TOKEN=xxx \
  -e NOTION_PARENT_PAGE_ID=xxx \
  -e TELEGRAM_BOT_TOKEN=xxx \
  -e TELEGRAM_CHAT_ID=xxx \
  grabber
```

## Bird CLI

Local fork in `vendor/bird/` with media extraction (original doesn't have it).

```bash
./bin/bird check                    # verify auth
./bin/bird bookmarks -n 20 --json   # get bookmarks
```

Max ~30 bookmarks per request (Twitter API limit, no pagination yet).

## Testing

```bash
# Test real data (logs only, no Notion writes)
bun run src/test-real.ts

# Unit tests
pnpm test:run
```
