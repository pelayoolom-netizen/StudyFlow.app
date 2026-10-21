import type { Request, Response } from 'express';
import { processAcademicPrompt, setCorsHeaders } from '../_lib/geminiParser';

export default async function handler(req: Request, res: Response) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Método no permitido. Se requiere POST.',
      success: false,
    });
  }

  try {
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        return res.status(400).json({
          error: 'Cuerpo de petición JSON inválido.',
          success: false,
        });
      }
    }

    if (!body || typeof body !== 'object') {
      return res.status(400).json({
        error: 'Cuerpo de petición ausente o inválido.',
        success: false,
      });
    }

    return await processAcademicPrompt(body, res);
  } catch (err: any) {
    console.error('[API /api/gemini/analyze-voice] Error:', err);
    return res.status(500).json({
      error: err?.message || 'Error interno del servidor al procesar las tareas.',
      success: false,
    });
  }
}
