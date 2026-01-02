import type { Command } from 'commander';
import type { CliContext } from '../cli/shared.js';

export function registerDumpCookiesCommand(program: Command, ctx: CliContext): void {
  program
    .command('dump-cookies')
    .description('Export Twitter cookies to stdout or file for docker deployment')
    .option('--env', 'Output as .env format (default)')
    .option('--json', 'Output as JSON')
    .option('-o, --output <file>', 'Write to file instead of stdout')
    .action(async (cmdOpts: { env?: boolean; json?: boolean; output?: string }) => {
      const opts = program.opts();
      const { cookies, warnings } = await ctx.resolveCredentialsFromOptions(opts);

      for (const warning of warnings) {
        console.error(`${ctx.p('warn')}${warning}`);
      }

      if (!cookies.authToken || !cookies.ct0) {
        console.error(`${ctx.p('err')}Missing required credentials`);
        console.error(`${ctx.p('info')}Login to x.com in Safari/Chrome/Firefox first`);
        process.exit(1);
      }

      let output: string;

      if (cmdOpts.json) {
        output = JSON.stringify({
          TWITTER_AUTH_TOKEN: cookies.authToken,
          TWITTER_CT0: cookies.ct0,
        }, null, 2);
      } else {
        // .env format
        output = `# Twitter cookies exported on ${new Date().toISOString()}
# Use with: docker run --env-file <file> grabber
TWITTER_AUTH_TOKEN=${cookies.authToken}
TWITTER_CT0=${cookies.ct0}
`;
      }

      if (cmdOpts.output) {
        const fs = await import('node:fs');
        fs.writeFileSync(cmdOpts.output, output);
        console.error(`${ctx.p('ok')}Cookies exported to ${cmdOpts.output}`);
        console.error(`${ctx.p('info')}auth_token: ${cookies.authToken.substring(0, 10)}... (${cookies.authToken.length} chars)`);
        console.error(`${ctx.p('info')}ct0: ${cookies.ct0.substring(0, 10)}... (${cookies.ct0.length} chars)`);
      } else {
        process.stdout.write(output);
      }
    });
}
