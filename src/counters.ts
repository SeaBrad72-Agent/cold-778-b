// Counter routes: POST /counters creates, GET /counters/:name reads (COLD-2); POST
// /counters/:name/increment and /decrement bump (COLD-6). Every name is validated by NAME before the
// store is touched; the store never sees an invalid name or bump.
import express, { Router } from 'express';
import { z } from 'zod';
import {
  CounterBoundError,
  CounterExistsError,
  CounterNotFoundError,
  type CounterStore,
} from './store.js';
import { routeName } from './route-name.js';

/** 1-64 chars of lowercase letters, digits and hyphens, not starting with a hyphen. */
export const NAME = z
  .string({ error: 'name must be a string' })
  .regex(/^[a-z0-9][a-z0-9-]{0,63}$/, {
    error: 'name must be 1-64 lowercase letters, digits or hyphens, not starting with a hyphen',
  });

const CreateBody = z.object({ name: NAME }, { error: 'request body must be a JSON object with a name' });

/** How much to bump by: a whole number from 1 to 1,000,000; absent means 1. */
const BY_ERROR = 'by must be a whole number from 1 to 1000000';
const BumpBody = z.object(
  {
    by: z
      .number({ error: BY_ERROR })
      .int({ error: BY_ERROR })
      .min(1, { error: BY_ERROR })
      .max(1_000_000, { error: BY_ERROR })
      .default(1),
  },
  { error: 'request body must be a JSON object' },
);

function firstIssue(err: z.ZodError): string {
  return err.issues[0]?.message ?? 'invalid request';
}

export function countersRouter(store: CounterStore): Router {
  const router = Router();

  // routeName runs BEFORE the body parser, so a 400/413/415 from parsing still carries the route's name.
  router.post('/', routeName('/counters'), express.json({ limit: '1kb', strict: false }), (req, res) => {
    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstIssue(parsed.error) });
      return;
    }
    try {
      res.status(201).json(store.create(parsed.data.name));
    } catch (err) {
      if (err instanceof CounterExistsError) {
        res.status(409).json({ error: 'counter already exists' });
        return;
      }
      throw err;
    }
  });

  router.get('/:name', routeName('/counters/:name'), (req, res) => {
    const parsed = NAME.safeParse(req.params.name);
    if (!parsed.success) {
      res.status(400).json({ error: firstIssue(parsed.error) });
      return;
    }
    const counter = store.get(parsed.data);
    if (!counter) {
      res.status(404).json({ error: 'counter not found' });
      return;
    }
    res.json(counter);
  });

  // POST /counters/:name/increment and /decrement (COLD-6). Name and body are validated before the
  // store; the store applies the bump in one guarded statement and names a refusal by its error type.
  for (const op of ['increment', 'decrement'] as const) {
    router.post(
      `/:name/${op}`,
      routeName(`/counters/:name/${op}`),
      express.json({ limit: '1kb', strict: false }),
      (req, res) => {
        const name = NAME.safeParse(req.params.name);
        if (!name.success) {
          res.status(400).json({ error: firstIssue(name.error) });
          return;
        }
        // Only a request with NO body means "by 1". A body that is present but not JSON is refused (415),
        // so a client that forgets the header never gets a silent +1 for its {"by": 5}; a JSON null
        // reaches the schema and is refused (400).
        const hasBody =
          req.headers['transfer-encoding'] !== undefined || Number(req.headers['content-length'] ?? 0) > 0;
        if (hasBody && !req.is('application/json')) {
          res.status(415).json({ error: 'unsupported content type or encoding' });
          return;
        }
        const body = BumpBody.safeParse(req.body === undefined ? {} : req.body);
        if (!body.success) {
          res.status(400).json({ error: firstIssue(body.error) });
          return;
        }
        try {
          res.json(store[op](name.data, body.data.by));
        } catch (err) {
          if (err instanceof CounterNotFoundError) {
            res.status(404).json({ error: 'counter not found' });
            return;
          }
          if (err instanceof CounterBoundError) {
            res.status(409).json({
              error: err.bound === 'zero' ? 'counter cannot go below zero' : 'counter would exceed the maximum value',
            });
            return;
          }
          throw err;
        }
      },
    );
  }

  return router;
}
