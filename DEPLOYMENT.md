# Grabber Deployment Guide

This guide documents how to deploy Grabber on a fresh Linux VM (tested on Ubuntu/Debian).

## Requirements

- Linux VM (Ubuntu 22.04+ / Debian 12+)
- **Bun** runtime (Node.js won't work due to `bun:sqlite` dependency)
- Git

## Quick Start

```bash
# 1. Install Bun
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc

# 2. Clone the repo
git clone https://github.com/Hormold/grabber.git
cd grabber

# 3. Install dependencies (main app)
bun install

# 4. Install vendored bird dependencies
cd vendor/bird && bun install && cd ../..

# 5. Create data directory
mkdir -p data

# 6. Configure environment
cp .env.example .env  # or create from scratch
# Edit .env with your credentials (see below)

# 7. Test run
bun run src/index.ts
```

## Environment Variables

Create `.env` in the project root:

```env
# Twitter/Bird CLI
TWITTER_AUTH_TOKEN=your_auth_token_here
TWITTER_CT0=your_ct0_here

# Google Gemini
GOOGLE_GENERATIVE_AI_API_KEY=your_gemini_api_key

# Notion
NOTION_TOKEN=your_notion_integration_token
NOTION_PARENT_PAGE_ID=your_notion_page_id

# Telegram notifications
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_CHAT_ID=your_telegram_chat_id

# Optional: Firecrawl for article scraping
FIRECRAWL_API_KEY=your_firecrawl_api_key

# Settings
FIRST_RUN_LIMIT=200
POLL_INTERVAL_SECONDS=3600  # 1 hour
DB_PATH=./data/grabber.db
DIGEST_CRON=0 10 * * 0
```

### Getting Twitter Cookies

1. Log into X/Twitter in Chrome
2. Open DevTools → Application → Cookies → twitter.com
3. Copy `auth_token` and `ct0` values

## Bird CLI Setup

The `bird` CLI is vendored in `vendor/bird/`. The wrapper script at `bin/bird` must point to the correct bun path.

Update `bin/bird` with your bun installation path:

```bash
#!/bin/bash
exec /home/YOUR_USER/.bun/bin/bun /path/to/grabber/vendor/bird/src/cli.ts "$@"
```

Test it:
```bash
./bin/bird --version
```

## Systemd Service (Production)

Create `/etc/systemd/system/grabber.service`:

```ini
[Unit]
Description=Grabber - Twitter Bookmark Processor
After=network.target

[Service]
Type=simple
User=YOUR_USER
WorkingDirectory=/home/YOUR_USER/grabber
Environment="PATH=/home/YOUR_USER/.bun/bin:/usr/local/bin:/usr/bin:/bin"
EnvironmentFile=/home/YOUR_USER/grabber/.env
ExecStart=/home/YOUR_USER/.bun/bin/bun run src/index.ts
Restart=on-failure
RestartSec=30

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable grabber
sudo systemctl start grabber
```

## Useful Commands

```bash
# Check status
sudo systemctl status grabber

# View logs
sudo journalctl -u grabber -f

# Restart
sudo systemctl restart grabber

# Stop
sudo systemctl stop grabber
```

## Troubleshooting

### "unable to open database file"

Create the data directory:
```bash
mkdir -p data
```

### "Cannot find module 'bun:sqlite'"

You're running with Node.js instead of Bun. Make sure to use `bun run` not `node`.

### "SyntaxError: Unexpected token 'with'"

Node.js version too old for the bird CLI. Use Bun to run bird (see bin/bird wrapper).

### Bird CLI not found

Ensure `bin/bird` exists and has the correct path to bun. Also ensure vendored bird dependencies are installed:
```bash
cd vendor/bird && bun install
```

## Architecture Notes

- **Runtime**: Bun (required for `bun:sqlite`)
- **Database**: SQLite with WAL mode in `./data/grabber.db`
- **Bird CLI**: Vendored in `vendor/bird/`, wrapped by `bin/bird`
- **Cron**: Built-in via `node-cron`, configured by `POLL_INTERVAL_SECONDS`

## Version Info (tested)

- Bun: 1.3.5
- Bird: 0.5.1 (vendored)
- OS: Ubuntu 24.04