// Child process for the cross-process lost-update test (test/store.test.ts). Usage:
//   node --import <tsx> test/helpers/bump-many.ts <db-path> <name> <count> <go-file> [mutant]
// Waits until <go-file> exists (so both children start together), then bumps <name> <count> times.
// With `mutant`, it bumps by read-then-write instead of the store's single statement; that variant is
// only for showing, by hand, that the test harness can see lost updates.
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { sqliteStore } from '../../src/store.js';

const [dbPath, name, countArg, goFile, mode] = process.argv.slice(2);
const count = Number(countArg);

const deadline = Date.now() + 10_000;
while (!existsSync(goFile)) {
  if (Date.now() > deadline) process.exit(3);
}

if (mode === 'mutant') {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA busy_timeout = 5000');
  const read = db.prepare('SELECT value FROM counters WHERE name = ?');
  const write = db.prepare('UPDATE counters SET value = ? WHERE name = ?');
  for (let i = 0; i < count; i++) {
    const { value } = read.get(name) as { value: number };
    write.run(value + 1, name);
  }
  db.close();
} else {
  const store = sqliteStore(dbPath);
  for (let i = 0; i < count; i++) store.increment(name, 1);
  store.close();
}
