#!/usr/bin/env bun
/**
 * Standalone Twitter cookie dumper using sweet-cookie
 * Usage: bun run bin/dump-twitter-cookies.ts [-o output.env]
 */

import { getCookies } from '@steipete/sweet-cookie';
import { writeFileSync } from 'fs';

const TWITTER_URL = 'https://x.com/';
const TWITTER_ORIGINS = ['https://x.com/', 'https://twitter.com/'];
const COOKIE_NAMES = ['auth_token', 'ct0'] as const;

async function main() {
  const outputFile = process.argv.includes('-o')
    ? process.argv[process.argv.indexOf('-o') + 1]
    : null;

  console.error('Extracting Twitter cookies from browsers...');

  for (const browser of ['safari', 'chrome', 'firefox'] as const) {
    try {
      const { cookies, warnings } = await getCookies({
        url: TWITTER_URL,
        origins: TWITTER_ORIGINS,
        names: [...COOKIE_NAMES],
        browsers: [browser],
        mode: 'merge',
        timeoutMs: 30000,
      });

      for (const w of warnings) {
        console.error(`[warn] ${w}`);
      }

      const authToken = cookies.find(c => c.name === 'auth_token')?.value;
      const ct0 = cookies.find(c => c.name === 'ct0')?.value;

      if (authToken && ct0) {
        const output = `# Twitter cookies from ${browser} - ${new Date().toISOString()}
TWITTER_AUTH_TOKEN=${authToken}
TWITTER_CT0=${ct0}
`;
        if (outputFile) {
          writeFileSync(outputFile, output);
          console.error(`[ok] Cookies exported to ${outputFile}`);
          console.error(`[info] auth_token: ${authToken.substring(0, 10)}... (${authToken.length} chars)`);
          console.error(`[info] ct0: ${ct0.substring(0, 10)}... (${ct0.length} chars)`);
        } else {
          process.stdout.write(output);
        }
        process.exit(0);
      }
    } catch (e) {
      console.error(`[warn] ${browser}: ${(e as Error).message}`);
    }
  }

  console.error('[err] No Twitter cookies found in any browser');
  process.exit(1);
}

main();
