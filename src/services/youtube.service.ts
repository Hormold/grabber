import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

const YOUTUBE_REGEX = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/;

export class YoutubeService {
  extractVideoId(url: string): string | null {
    const match = url.match(YOUTUBE_REGEX);
    return match ? match[1] : null;
  }

  isYoutubeUrl(url: string): boolean {
    return YOUTUBE_REGEX.test(url);
  }

  async getTranscript(videoIdOrUrl: string): Promise<string | null> {
    const videoId = this.extractVideoId(videoIdOrUrl) || videoIdOrUrl;
    const tmpPath = `/tmp/yt-${videoId}-${Date.now()}`;

    try {
      await execAsync(
        `yt-dlp --write-sub --write-auto-sub --sub-lang en --skip-download -o "${tmpPath}" "https://www.youtube.com/watch?v=${videoId}" 2>/dev/null`,
        { timeout: 90000 }
      );

      const { stdout } = await execAsync(
        `cat "${tmpPath}".en.vtt 2>/dev/null || cat "${tmpPath}".en.*.vtt 2>/dev/null || echo ""`,
        { timeout: 5000 }
      );

      await execAsync(`rm -f "${tmpPath}"* 2>/dev/null || true`);

      if (!stdout.trim()) return null;
      return this.cleanVttTranscript(stdout);
    } catch {
      await execAsync(`rm -f "${tmpPath}"* 2>/dev/null || true`).catch(() => {});
      return null;
    }
  }

  private cleanVttTranscript(vtt: string): string {
    const lines = vtt.split('\n');
    const textLines: string[] = [];
    let lastLine = '';

    for (const line of lines) {
      if (line.startsWith('WEBVTT') || line.startsWith('Kind:') || line.startsWith('Language:')) continue;
      if (/^\d{2}:\d{2}/.test(line)) continue;
      if (/^[\d:.,\s-]+$/.test(line)) continue;
      if (!line.trim()) continue;

      const cleanLine = line.replace(/<[^>]+>/g, '').trim();
      if (cleanLine && cleanLine !== lastLine) {
        textLines.push(cleanLine);
        lastLine = cleanLine;
      }
    }

    return textLines.join(' ').replace(/\s+/g, ' ').trim();
  }

  async getVideoInfo(videoIdOrUrl: string): Promise<{ title: string; description: string; duration: number } | null> {
    const videoId = this.extractVideoId(videoIdOrUrl) || videoIdOrUrl;

    try {
      const { stdout } = await execAsync(
        `yt-dlp --print "%(title)s|||%(description)s|||%(duration)s" "https://www.youtube.com/watch?v=${videoId}" 2>/dev/null`,
        { timeout: 30000 }
      );

      const [title, description, durationStr] = stdout.trim().split('|||');
      return {
        title: title || '',
        description: description || '',
        duration: parseInt(durationStr) || 0,
      };
    } catch {
      return null;
    }
  }
}
