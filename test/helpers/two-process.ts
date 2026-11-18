// Parent side of the cross-process harness: starts two bump-many.ts children on one SQLite file, waits
// until BOTH report ready, then releases them together (a real rendezvous).
import { spawn } from 'node:child_process';
import { readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const TSX = join(ROOT, 'node_modules/tsx/dist/esm/index.mjs');
const BUMP_MANY = join(ROOT, 'test/helpers/bump-many.ts');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type ChildMode = 'store' | 'mutant' | 'churn' | 'dec-refused';

/** Runs two children on `name`, `perChild` iterations each, in the given modes (one mode = both
 * children); resolves to their exit codes. */
export async function bumpFromTwoProcesses(
  dbPath: string,
  name: string,
  perChild: number,
  modes: ChildMode | [ChildMode, ChildMode] = 'store',
): Promise<Array<number | null>> {
  const go = join(dirname(dbPath), `go-${basename(dbPath)}`);
  const pair = Array.isArray(modes) ? modes : [modes, modes];
  const exits = pair.map(
    (mode) =>
      new Promise<number | null>((resolve) => {
        const args = ['--import', TSX, BUMP_MANY, dbPath, name, String(perChild), go, mode];
        spawn(process.execPath, args, { stdio: 'inherit' }).on('exit', resolve);
      }),
  );

  const prefix = `${basename(go)}.ready-`;
  const deadline = Date.now() + 15_000;
  while (readdirSync(dirname(go)).filter((f) => f.startsWith(prefix)).length < 2) {
    if (Date.now() > deadline) throw new Error('children never became ready');
    await sleep(5);
  }
  writeFileSync(go, '');
  return Promise.all(exits);
}
