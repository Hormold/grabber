import { exec } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { GrabberError, type Tweet } from '../types/index.js';

const execAsync = promisify(exec);

const BirdMediaSchema = z.object({
  type: z.enum(['photo', 'video', 'animated_gif']),
  url: z.string(),
  previewUrl: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  videoUrl: z.string().optional(),
  durationMs: z.number().optional(),
});

const BirdTweetSchema = z.object({
  id: z.string(),
  text: z.string(),
  createdAt: z.string(),
  replyCount: z.number().optional(),
  retweetCount: z.number().optional(),
  likeCount: z.number().optional(),
  conversationId: z.string().optional(),
  inReplyToStatusId: z.string().optional(),
  author: z.object({
    username: z.string(),
    name: z.string(),
  }),
  authorId: z.string().optional(),
  media: z.array(BirdMediaSchema).optional(),
});

type BirdTweet = z.infer<typeof BirdTweetSchema>;

export class BirdService {
  private authToken?: string;
  private ct0?: string;
  private birdCmd: string;

  constructor(config: { authToken?: string; ct0?: string; birdCmd?: string }) {
    this.authToken = config.authToken;
    this.ct0 = config.ct0;
    // Use local patched binary, or custom command, or global bird
    const localBird = path.resolve(process.cwd(), 'bin', 'bird');
    this.birdCmd = config.birdCmd || process.env.BIRD_CMD || localBird;
  }

  private buildAuthArgs(): string {
    const args: string[] = [];
    if (this.authToken) args.push(`--auth-token "${this.authToken}"`);
    if (this.ct0) args.push(`--ct0 "${this.ct0}"`);
    return args.join(' ');
  }

  async getBookmarks(limit: number = 50): Promise<Tweet[]> {
    try {
      const authArgs = this.buildAuthArgs();
      const { stdout, stderr } = await execAsync(
        `${this.birdCmd} bookmarks -n ${limit} --json --plain ${authArgs}`,
        { timeout: 120000, shell: '/bin/bash' }
      );

      if (stderr && stderr.includes('auth') && stderr.includes('expired')) {
        throw new GrabberError('Twitter auth expired', 'AUTH_EXPIRED', false);
      }

      const parsed = JSON.parse(stdout);
      const tweets: Tweet[] = [];

      // Bird returns array of tweets
      const rawTweets = Array.isArray(parsed) ? parsed : [parsed];

      for (const raw of rawTweets) {
        try {
          const birdTweet = BirdTweetSchema.parse(raw);
          tweets.push(this.mapToTweet(birdTweet));
        } catch (e) {
          console.warn('Failed to parse tweet:', raw?.id, e);
        }
      }

      return tweets;
    } catch (error) {
      if (error instanceof GrabberError) throw error;

      const msg = error instanceof Error ? error.message : String(error);

      if (msg.includes('rate limit') || msg.includes('429')) {
        throw new GrabberError('Twitter rate limit hit', 'RATE_LIMIT', true);
      }

      if (msg.includes('unknown command')) {
        throw new GrabberError(
          'bird bookmarks command not available. Update bird: brew upgrade steipete/tap/bird or npm i -g @steipete/bird@latest',
          'UNKNOWN',
          false
        );
      }

      if (msg.includes('auth') || msg.includes('cookie') || msg.includes('401')) {
        throw new GrabberError('Twitter auth expired or invalid', 'AUTH_EXPIRED', false);
      }

      throw new GrabberError(`Bird CLI error: ${msg}`, 'NETWORK', true);
    }
  }

  async readTweet(tweetIdOrUrl: string): Promise<Tweet | null> {
    try {
      const authArgs = this.buildAuthArgs();
      const { stdout } = await execAsync(
        `${this.birdCmd} read "${tweetIdOrUrl}" --json --plain ${authArgs}`,
        { timeout: 30000, shell: '/bin/bash' }
      );

      const parsed = JSON.parse(stdout);
      const birdTweet = BirdTweetSchema.parse(parsed);
      return this.mapToTweet(birdTweet);
    } catch (error) {
      console.warn('Failed to read tweet:', tweetIdOrUrl, error);
      return null;
    }
  }

  async getThread(tweetIdOrUrl: string): Promise<Tweet[]> {
    try {
      const authArgs = this.buildAuthArgs();
      const { stdout } = await execAsync(
        `${this.birdCmd} thread "${tweetIdOrUrl}" --json --plain ${authArgs}`,
        { timeout: 30000, shell: '/bin/bash' }
      );

      const parsed = JSON.parse(stdout);
      const rawTweets = Array.isArray(parsed) ? parsed : [parsed];

      return rawTweets.map((raw) => {
        const birdTweet = BirdTweetSchema.parse(raw);
        return this.mapToTweet(birdTweet);
      });
    } catch (error) {
      console.warn('Failed to get thread:', tweetIdOrUrl, error);
      return [];
    }
  }

  async checkAuth(): Promise<{ valid: boolean; username?: string }> {
    try {
      const authArgs = this.buildAuthArgs();
      const { stdout } = await execAsync(`${this.birdCmd} whoami --plain ${authArgs}`, { timeout: 30000, shell: '/bin/bash' });
      
      // Parse output like "@username (Name)"
      const match = stdout.match(/@(\w+)/);
      return { valid: true, username: match?.[1] };
    } catch {
      return { valid: false };
    }
  }

  private mapToTweet(birdTweet: BirdTweet): Tweet {
    const urlRegex = /https?:\/\/[^\s]+/g;
    const extractedUrls: string[] = birdTweet.text.match(urlRegex) || [];

    // Extract image URLs from media (photos and video thumbnails)
    const images: string[] = [];
    if (birdTweet.media) {
      for (const m of birdTweet.media) {
        if (m.type === 'photo') {
          images.push(m.url);
        } else if (m.type === 'video' || m.type === 'animated_gif') {
          // For videos, use the thumbnail URL and add video URL
          images.push(m.url);
          if (m.videoUrl) {
            extractedUrls.push(m.videoUrl);
          }
        }
      }
    }

    return {
      id: birdTweet.id,
      text: birdTweet.text,
      authorUsername: birdTweet.author.username,
      authorName: birdTweet.author.name,
      createdAt: birdTweet.createdAt,
      urls: extractedUrls,
      images,
      isThread: !!birdTweet.conversationId && birdTweet.conversationId !== birdTweet.id,
      threadTweets: [],
    };
  }
}
