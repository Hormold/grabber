#!/usr/bin/env bun
// Extract Twitter cookies from Chrome for docker deployment

import { Database } from "bun:sqlite";
import { homedir } from "os";
import { existsSync, writeFileSync } from "fs";
import { join } from "path";

const CHROME_COOKIES_PATH = join(
  homedir(),
  "Library/Application Support/Google/Chrome/Default/Cookies"
);

if (!existsSync(CHROME_COOKIES_PATH)) {
  console.error("Chrome cookies database not found at:", CHROME_COOKIES_PATH);
  process.exit(1);
}

try {
  const db = new Database(CHROME_COOKIES_PATH, { readonly: true });

  const query = db.query(`
    SELECT name, value, encrypted_value
    FROM cookies
    WHERE host_key LIKE '%twitter.com' OR host_key LIKE '%x.com'
  `);

  const cookies = query.all() as { name: string; value: string; encrypted_value: Uint8Array }[];

  let authToken = "";
  let ct0 = "";

  for (const cookie of cookies) {
    if (cookie.name === "auth_token" && cookie.value) {
      authToken = cookie.value;
    }
    if (cookie.name === "ct0" && cookie.value) {
      ct0 = cookie.value;
    }
  }

  if (!authToken || !ct0) {
    console.error("Could not find auth_token or ct0 cookies.");
    console.error("Found cookies:", cookies.map(c => c.name));
    console.error("\nNote: Chrome may encrypt cookies. Try using bird CLI directly.");
    process.exit(1);
  }

  const outputPath = join(process.cwd(), "docker-cookies.env");
  const content = `# Twitter cookies extracted on ${new Date().toISOString()}
TWITTER_AUTH_TOKEN=${authToken}
TWITTER_CT0=${ct0}
`;

  writeFileSync(outputPath, content);
  console.log(`Cookies exported to: ${outputPath}`);
  console.log(`Auth token: ${authToken.substring(0, 10)}... (${authToken.length} chars)`);
  console.log(`CT0: ${ct0.substring(0, 10)}... (${ct0.length} chars)`);

  db.close();
} catch (error) {
  console.error("Error reading cookies:", error);
  console.error("\nChrome may encrypt cookies with OS keychain.");
  console.error("Alternative: Get cookies manually from Chrome DevTools:");
  console.error("  1. Go to x.com");
  console.error("  2. Open DevTools (F12) -> Application -> Cookies");
  console.error("  3. Copy auth_token and ct0 values");
  process.exit(1);
}
