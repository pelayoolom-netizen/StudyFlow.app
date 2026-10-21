import type { Request, Response } from 'express';

export default function handler(req: Request, res: Response) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const apiKey = process.env.GEMINI_API_KEY;
  const isConfigured = Boolean(
    apiKey &&
    apiKey !== 'MY_GEMINI_API_KEY' &&
    apiKey.trim().length > 10
  );

  return res.status(200).json({
    available: isConfigured,
    model: 'gemini-3.8-flash',
    environment: process.env.VERCEL ? 'vercel-serverless' : 'express',
    reason: isConfigured
      ? undefined
      : 'GEMINI_API_KEY no está configurada en las variables de entorno de Vercel.',
  });
}
