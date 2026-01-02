import type { Command } from 'commander';
import type { CliContext } from '../cli/shared.js';
import { runtimeQueryIds } from '../lib/runtime-query-ids.js';

export function registerQueryIdsCommand(program: Command, ctx: CliContext): void {
  program
    .command('query-ids')
    .description('Show or refresh cached Twitter GraphQL query IDs')
    .option('--json', 'Output as JSON')
    .option('--fresh', 'Force refresh (downloads X client bundles)', false)
    .action(async (cmdOpts: { json?: boolean; fresh?: boolean }) => {
      const operations = [
        'CreateTweet',
        'CreateRetweet',
        'FavoriteTweet',
        'TweetDetail',
        'SearchTimeline',
        'UserArticlesTweets',
        'Bookmarks',
        'Following',
        'Followers',
        'Likes',
      ];

      if (cmdOpts.fresh) {
        console.error(`${ctx.p('info')}Refreshing GraphQL query IDs…`);
        await runtimeQueryIds.refresh(operations, { force: true });
      }

      const info = await runtimeQueryIds.getSnapshotInfo();
      if (!info) {
        if (cmdOpts.json) {
          console.log(JSON.stringify({ cached: false, cachePath: runtimeQueryIds.cachePath }, null, 2));
          return;
        }
        console.log(`${ctx.p('warn')}No cached query IDs yet.`);
        console.log(`${ctx.p('info')}Run: bird query-ids --fresh`);
        return;
      }

      if (cmdOpts.json) {
        console.log(
          JSON.stringify(
            {
              cached: true,
              cachePath: info.cachePath,
              fetchedAt: info.snapshot.fetchedAt,
              isFresh: info.isFresh,
              ageMs: info.ageMs,
              ids: info.snapshot.ids,
              discovery: info.snapshot.discovery,
            },
            null,
            2,
          ),
        );
        return;
      }

      console.log(`${ctx.p('ok')}GraphQL query IDs cached`);
      console.log(`path: ${info.cachePath}`);
      console.log(`fetched_at: ${info.snapshot.fetchedAt}`);
      console.log(`fresh: ${info.isFresh ? 'yes' : 'no'}`);
      console.log(`ops: ${Object.keys(info.snapshot.ids).length}`);
    });
}
