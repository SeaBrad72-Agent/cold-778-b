// A span is named by its route's FIXED template string (`/counters/:name`), recorded here when the route
// matches. Recording it at match time survives error paths (Express resets req.baseUrl on the way out of
// a router), and a fixed string never carries request text, not even the URL's letter case.
import type { RequestHandler } from 'express';

export function routeName(template: string): RequestHandler {
  return (_req, res, next) => {
    res.locals.route = template;
    next();
  };
}
