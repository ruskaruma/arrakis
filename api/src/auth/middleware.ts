import { Request, Response, NextFunction } from 'express';

const SKIP_AUTH = process.env.SKIP_AUTH === 'true';

export function isAuthenticated(req: Request, res: Response, next: NextFunction): void {
  if (SKIP_AUTH) {
    next();
    return;
  }

  if (req.isAuthenticated()) {
    next();
    return;
  }

  res.status(401).json({ error: 'Not authenticated' });
}
