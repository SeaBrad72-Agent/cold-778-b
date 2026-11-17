// Child process for the cross-process lost-update test (test/store.test.ts). Usage:
//   node --import <tsx> test/helpers/bump-many.ts <db-path> <name> <count> <go-file> [mutant]
// Rendezvous: the child opens its connection, writes `<go-file>.ready-<pid>`, then waits for <go-file>;
// the parent writes <go-file> only once every child is ready, so the bump loops start together and
// overlap by construction (a barrier written before the children load is a no-op: measured, review
// round 2). With `mutant`, it bumps by read-then-write instead of the store's single statement; that
// variant exists only to show, by hand, that the harness detects lost updates.
import { existsSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { sqliteStore } from '../../src/store.js';

const [dbPath, name, countArg, goFile, mode] = process.argv.slice(2);
const count = Number(countArg);

function rendezvous(): void {
  writeFileSync(`${goFile}.ready-${process.pid}`, '');
  const deadline = Date.now() + 10_000;
  while (!existsSync(goFile)) {
    if (Date.now() > deadline) process.exit(3);
  }
}

if (mode === 'mutant') {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA busy_timeout = 5000');
  const read = db.prepare('SELECT value FROM counters WHERE name = ?');
  const write = db.prepare('UPDATE counters SET value = ? WHERE name = ?');
  rendezvous();
  for (let i = 0; i < count; i++) {
    const { value } = read.get(name) as { value: number };
    write.run(value + 1, name);
  }
  db.close();
} else {
  const store = sqliteStore(dbPath);
  rendezvous();
  for (let i = 0; i < count; i++) store.increment(name, 1);
  store.close();
}
