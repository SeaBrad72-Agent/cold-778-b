// Counter routes (COLD-2 design §2): POST /counters creates, GET /counters/:name reads.
// Every name is validated by NAME before the store is touched; the store never sees an invalid name.
import express, { Router } from 'express';
import { z } from 'zod';
import { CounterExistsError, type CounterStore } from './store.js';

/** 1-64 chars of lowercase letters, digits and hyphens, not starting with a hyphen. */
export const NAME = z
  .string({ error: 'name must be a string' })
  .regex(/^[a-z0-9][a-z0-9-]{0,63}$/, {
    error: 'name must be 1-64 lowercase letters, digits or hyphens, not starting with a hyphen',
  });

const CreateBody = z.object({ name: NAME }, { error: 'request body must be a JSON object with a name' });

function firstIssue(err: z.ZodError): string {
  return err.issues[0]?.message ?? 'invalid request';
}

export function countersRouter(store: CounterStore): Router {
  const router = Router();

  router.post('/', express.json({ limit: '1kb', strict: false }), (req, res) => {
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

  router.get('/:name', (req, res) => {
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

  return router;
}
