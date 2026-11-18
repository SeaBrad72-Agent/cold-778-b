// Child process for the cross-process tests (test/store.test.ts). Usage:
//   node --import <tsx> test/helpers/bump-many.ts <db-path> <name> <count> <go-file> [mode]
// Rendezvous: the child opens its connection, writes `<go-file>.ready-<pid>`, then waits for <go-file>;
// the parent writes <go-file> only once every child is ready, so the loops start together and overlap
// by construction (a barrier written before the children load is a no-op: measured, COLD-6 review).
// Modes:
//   store        (default) increment by 1, <count> times, through the store
//   mutant       increment by read-then-write; only for showing, by hand, that lost updates are detected
//   churn        delete then re-create <name>, <count> times (COLD-9)
//   dec-refused  decrement by 1, <count> times, on a counter that is never above 0. Every call must be
//                refused with CounterNotFoundError or CounterBoundError. A success exits 5; any other
//                error exits 4, with its message on stderr (COLD-9).
import { existsSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { CounterBoundError, CounterNotFoundError, sqliteStore } from '../../src/store.js';

const [dbPath, name, countArg, goFile, mode = 'store'] = process.argv.slice(2);
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
  for (let i = 0; i < count; i++) {
    if (mode === 'churn') {
      store.delete(name);
      store.create(name);
    } else if (mode === 'dec-refused') {
      try {
        store.decrement(name, 1);
        process.exit(5);
      } catch (err) {
        if (!(err instanceof CounterNotFoundError) && !(err instanceof CounterBoundError)) {
          console.error(String(err));
          process.exit(4);
        }
      }
    } else {
      store.increment(name, 1);
    }
  }
  store.close();
}
