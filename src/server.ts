// Entrypoint: open the counter store and listen. All request handling lives in app.ts (createApp);
// this file binds a socket in a main guard and is excluded from coverage in vitest.config.ts.
import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createApp } from './app.js';
import { sqliteStore } from './store.js';
import { setProvider } from './flags.js';
import { fileConfigProvider } from './live-provider.js';
import { ConfigError, allowedHostsFrom } from './config.js';

// Start only when run directly (not when imported by a test).
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  // Flag provider selection at boot. Default = the env floor (restart-to-toggle). Setting FLAG_FILE opts
  // the running server into the file-config live provider (src/live-provider.ts).
  const flagFile = process.env.FLAG_FILE;
  if (flagFile) setProvider(fileConfigProvider(flagFile));

  // Host allowlist (COLD-7): loopback + TALLY_ALLOWED_HOSTS + a specific TALLY_HOST. A malformed list
  // stops the server here, before anything is opened, rather than allowing the wrong hosts.
  let allowedHosts: string[];
  try {
    allowedHosts = allowedHostsFrom(process.env);
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    console.error(`tally: ${err.message}`);
    process.exit(2);
  }

  // Counter storage (ADR-000: SQLite). TALLY_DB_PATH names the file; its directory is created if missing.
  // `||`, not `??`: an EMPTY value would open SQLite's temporary database and lose every counter on restart.
  const dbPath = process.env.TALLY_DB_PATH || './data/tally.db';
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  const store = sqliteStore(dbPath);

  const port = Number(process.env.PORT ?? 3000);
  // Loopback by default: POST /counters is an unauthenticated write (auth is out of scope by charter),
  // so listening beyond this machine is an explicit opt-in (TALLY_HOST=0.0.0.0, for example in a container).
  // Not `HOST`: csh/tcsh and some CI images export HOST as the machine's hostname.
  const host = process.env.TALLY_HOST || '127.0.0.1';
  const server = createServer(createApp(store, { allowedHosts }));
  server.listen(port, host, () => console.log(`listening on ${host}:${port}`));
  const shutdown = () => server.close(() => { store.close(); process.exit(0); });
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
