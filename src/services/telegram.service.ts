import { GrabberError } from '../types/index.js';

export class TelegramService {
  private botToken: string;
  private chatId: string;
  private lastSentAt = 0;
  private minIntervalMs = 1000;

  constructor(botToken: string, chatId: string) {
    this.botToken = botToken;
    this.chatId = chatId;
  }

  async sendMessage(text: string, parseMode: 'HTML' | 'Markdown' = 'HTML'): Promise<void> {
    await this.rateLimitWait();

    const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: this.chatId,
        text: text.slice(0, 4096),
        parse_mode: parseMode,
        disable_web_page_preview: true,
      }),
    });

    this.lastSentAt = Date.now();

    if (!response.ok) {
      const error = await response.text();
      throw new GrabberError(`Telegram send failed: ${error}`, 'TELEGRAM', true);
    }
  }

  async notifyError(error: GrabberError): Promise<void> {
    const emoji = this.getErrorEmoji(error.code);
    const retryable = error.retryable ? '(will retry)' : '(manual action needed)';

    await this.sendMessage(
      `${emoji} <b>Grabber Error</b>\n\n` +
      `<b>Type:</b> ${error.code}\n` +
      `<b>Message:</b> ${this.escapeHtml(error.message)}\n` +
      `<b>Status:</b> ${retryable}`
    );
  }

  async notifyAuthExpired(): Promise<void> {
    await this.sendMessage(
      `🔑 <b>Twitter Auth Expired</b>\n\n` +
      `Cookies have expired. Please update them:\n` +
      `1. Log into X in Chrome\n` +
      `2. Restart the grabber container\n\n` +
      `Processing paused until auth is restored.`
    );
  }

  async sendDigest(digest: string): Promise<void> {
    const chunks = this.chunkMessage(digest, 4000);
    for (const chunk of chunks) {
      await this.sendMessage(chunk, 'Markdown');
    }
  }

  async sendStats(stats: { total: number; today: number; errors: number }): Promise<void> {
    await this.sendMessage(
      `📊 <b>Grabber Stats</b>\n\n` +
      `Total processed: ${stats.total}\n` +
      `Today: ${stats.today}\n` +
      `Errors: ${stats.errors}`
    );
  }

  private async rateLimitWait(): Promise<void> {
    const elapsed = Date.now() - this.lastSentAt;
    if (elapsed < this.minIntervalMs) {
      await new Promise((r) => setTimeout(r, this.minIntervalMs - elapsed));
    }
  }

  private getErrorEmoji(code: string): string {
    switch (code) {
      case 'AUTH_EXPIRED': return '🔑';
      case 'RATE_LIMIT': return '⏱️';
      case 'NETWORK': return '🌐';
      case 'PARSE': return '⚠️';
      case 'NOTION': return '📝';
      case 'TELEGRAM': return '💬';
      default: return '❌';
    }
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  private chunkMessage(text: string, maxLength: number): string[] {
    const chunks: string[] = [];
    let current = '';

    for (const line of text.split('\n')) {
      if (current.length + line.length + 1 > maxLength) {
        chunks.push(current);
        current = line;
      } else {
        current += (current ? '\n' : '') + line;
      }
    }

    if (current) chunks.push(current);
    return chunks;
  }
}
