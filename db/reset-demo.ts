import { getDb } from '../src/server/db';
import { resetDemo } from '../src/server/seed';

void (async () => {
  if (process.env.STOCKPACT_DEMO !== 'true' || process.env.DATABASE_URL) {
    throw new Error('Set STOCKPACT_DEMO=true and use the local demo database. Stop the app before resetting.');
  }
  await resetDemo();
  await (await getDb()).destroy();
  console.log('StockPact local demo reset.');
})().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Demo reset failed.');
  process.exitCode = 1;
});
