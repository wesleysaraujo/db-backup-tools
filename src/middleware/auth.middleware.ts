import { timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { config } from '../config/index.js';
import type { ApiResponse } from '../types/index.js';

export function authMiddleware(req: Request, res: Response, next: NextFunction): void
{
  if (!config.apiKey)
  {
    const body: ApiResponse = { success: false, error: 'Unauthorized: API_KEY not configured on server' };
    res.status(401).json(body);
    return;
  }

  const authHeader = req.headers['authorization'];
  const xApiKey = req.headers['x-api-key'];

  let token: string | undefined;

  if (authHeader && authHeader.startsWith('Bearer '))
  {
    token = authHeader.slice(7);
  } else if (typeof xApiKey === 'string')
  {
    token = xApiKey;
  }

  if (!token)
  {
    const body: ApiResponse = { success: false, error: 'Unauthorized: invalid or missing API key' };
    res.status(401).json(body);
    return;
  }

  const expected = Buffer.from(config.apiKey, 'utf-8');
  const received = Buffer.from(token, 'utf-8');

  if (expected.length !== received.length || !timingSafeEqual(expected, received))
  {
    const body: ApiResponse = { success: false, error: 'Unauthorized: invalid or missing API key' };
    res.status(401).json(body);
    return;
  }

  next();
}
