# Grabber - Development Instructions

## Bird CLI (Local Fork with Media Support)

This project uses a **patched version** of bird CLI that extracts media (images/videos) from tweets.
The official bird CLI does not include media extraction.

### Using Local Binary

Pre-built binary with media support is in `./bin/bird`:
```bash
./bin/bird bookmarks -n 5 --json --plain
```

### Rebuilding from Patch

To rebuild the patched bird binary:
```bash
# Clone fresh and apply patch
cd /tmp && rm -rf bird-test
git clone --depth 1 https://github.com/steipete/bird.git bird-test
cd bird-test
patch -p1 < /Users/hormold/dev/grabber/patches/bird-media-support.patch
bun install
pnpm run build

# Copy new binary
cp bird /Users/hormold/dev/grabber/bin/bird
```

### Media Output Format

With the patch, tweets now include a `media` array:
```json
{
  "id": "123",
  "text": "...",
  "media": [
    {
      "type": "photo",
      "url": "https://pbs.twimg.com/media/xxx.jpg",
      "width": 1920,
      "height": 1080,
      "previewUrl": "https://pbs.twimg.com/media/xxx.jpg:small"
    },
    {
      "type": "video",
      "url": "https://pbs.twimg.com/media/xxx.jpg",
      "videoUrl": "https://video.twimg.com/xxx.mp4",
      "durationMs": 15000
    }
  ]
}
```

### Debug Mode

To see raw Twitter API response structure:
```bash
BIRD_DEBUG_MEDIA=1 ./bin/bird bookmarks -n 1 --json --plain 2>&1
```

## Environment Variables

Required in `.env`:
```
NOTION_TOKEN=your_notion_token
NOTION_PARENT_PAGE_ID=your_page_id
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
GOOGLE_GENERATIVE_AI_API_KEY=your_gemini_key
FIRECRAWL_API_KEY=your_firecrawl_key  # optional
```

Twitter auth is handled via browser cookies (Safari/Chrome/Firefox).

## Running

```bash
# Development
bun run src/index.ts

# Test with real data (logs only, no Notion)
bun run src/test-real.ts

# Run tests
pnpm test:run
```

## Cookie Dumper

To extract Twitter cookies from Chrome and save to file:
```bash
./bin/dump-cookies.sh
```

This creates `cookies.txt` with auth_token and ct0 values.
