import type { Request, Response } from 'express';
import { GoogleGenAI, Type } from '@google/genai';

export const CANDIDATE_MODELS = [
  'gemini-3-flash-preview',
  'gemini-3.8-flash',
  'gemini-3.1-flash-lite',
  'gemini-flash-latest',
];

export function setCorsHeaders(res: Response) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

export async function processAcademicPrompt(body: any, res: Response) {
  setCorsHeaders(res);

  const { text, clientDate, timezone, existingSubjects } = body || {};

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY' || apiKey.trim().length < 10) {
    return res.status(500).json({
      error: 'No se ha configurado la variable de entorno GEMINI_API_KEY en Vercel ni en el servidor. Ve a Vercel Dashboard > Project Settings > Environment Variables y añade tu GEMINI_API_KEY.',
      missingKey: true,
    });
  }

  const rawText = typeof text === 'string' ? text.trim() : '';
  if (!rawText) {
    return res.status(400).json({
      error: 'El texto está vacío. Por favor, escribe o dicta tus tareas con el teclado.',
      emptyText: true,
    });
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  // Reference date & time context in Europe/Madrid
  const tz = timezone || 'Europe/Madrid';
  const refDate = clientDate ? new Date(clientDate) : new Date();
  const currentYear = refDate.getFullYear();

  const dayNames = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const currentDayName = dayNames[refDate.getDay()];
  const dateFormatted = refDate.toLocaleDateString('es-ES', {
    timeZone: tz,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const timeFormatted = refDate.toLocaleTimeString('es-ES', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
  });

  const subjectsListStr = Array.isArray(existingSubjects) && existingSubjects.length > 0
    ? existingSubjects.join(', ')
    : 'Matemáticas, Física, Lengua, Historia, Inglés, Química, Biología, Filosofía, Francés, Tecnología';

  const systemInstruction = `Eres el asistente y motor de extracción académica de StudyFlow.
Tu cometido es analizar el texto que escribe o dicta un estudiante (usando el dictado de su teclado) y desglosarlo en registros estructurados individuales de deberes y exámenes.

INFORMACIÓN TEMPORAL Y DE CONTEXTO:
- Fecha actual (hoy): ${dateFormatted} (${currentDayName}).
- Hora actual de referencia: ${timeFormatted}.
- Zona horaria de referencia: ${tz}.
- Año de referencia: ${currentYear}.
- Asignaturas registradas actualmente del alumno: ${subjectsListStr}.

INSTRUCCIONES ESTRICTAS DE EXTRACCIÓN:
1. DESGLOSE INDIVIDUAL OBLIGATORIO:
   Si el mensaje menciona varios deberes, exámenes o solicitudes, debes crear un registro INDEPENDIENTE para cada uno. Jamás guardes todo el texto en una sola tarea.

2. CLASIFICACIÓN DE TIPO:
   - "examen": Exámenes, controles, parciales, pruebas, evaluaciones, recuperaciones, test.
   - "deber": Deberes, ejercicios, actividades, trabajo, entrega, proyecto, redacción, resumen, lectura, ficha, problemas.

3. TÍTULO Y DETALLES:
   - title: Debe ser conciso, natural y específico. Por ejemplo:
     - "Ejercicios 3 y 4"
     - "Ejercicios 2, 4, 5 y 7 del workbook"
     - "Examen Tema 4" o "Examen de Lengua - Tema 4"
     - "Entrega trabajo de Historia" o "Trabajo de Historia"
     - "Páginas 20, 21 y 23 del workbook"
   - notes: Conserva los números de ejercicios, páginas, capítulos, temario ("Tema 4") o detalles mencionados. No inventes información ausente.

4. ASIGNATURA (subject):
   - Asocia cada tarea a la materia que corresponda ("Lengua", "Física", "Inglés", "Historia", etc.).
   - Normalízala exactamente con alguna de las asignaturas existentes del alumno (${subjectsListStr}) si coincide.
   - Si no está en la lista pero el usuario la nombra claramente, usa ese nombre con mayúscula inicial.
   - Si no nombra asignatura pero es evidente por el contexto (ej: "ejercicios de matrices" -> "Matemáticas"), asígnala inteligentemente.

5. FECHAS ABSOLUTAS Y RELATIVAS (ZONA HORARIA ${tz}):
   - ¡CUIDADO CRÍTICO!: No confundas la fecha en que se anuncia o manda la tarea (ej: "Hoy me han puesto...") con la fecha para la que es ("para el 28 de octubre", "para mañana", "el viernes").
   - "mañana": el día siguiente respecto a hoy (${dateFormatted}).
   - "pasado mañana": dos días después.
   - "este viernes", "el viernes": el próximo viernes a partir de hoy.
   - "el martes de la semana que viene": el martes de la próxima semana.
   - Fechas fijas como "el 28 de octubre": 28 de octubre del año ${currentYear}.
   - Horas:
     - Si el usuario dice una hora ("a las 10:00", "a las 17h"), úsala.
     - Si no especifica hora: para deberes usa las 18:00 (18:00:00) y para exámenes las 09:30 (09:30:00).
   - El campo 'date' debe ser una cadena ISO 8601 estricta ("YYYY-MM-DDTHH:mm:ss").
   - Si no se menciona ninguna fecha ni relativa ni absoluta y es imposible saberla con seguridad, indica datePending: true y dateDescription: "Fecha pendiente de concretar".

6. PRIORIDAD:
   - Exámenes: 'alta'.
   - Entregas de trabajos: 'alta' o 'media'.
   - Deberes diarios: 'media' o 'baja'.

7. DEDUPLICACIÓN INTERNA:
   - Si una misma tarea se repite dentro del texto de entrada, inclúyela una sola vez.`;

  const responseSchema = {
    type: Type.OBJECT,
    properties: {
      items: {
        type: Type.ARRAY,
        description: 'Lista de deberes y exámenes extraídos del texto.',
        items: {
          type: Type.OBJECT,
          properties: {
            type: {
              type: Type.STRING,
              description: "Tipo de registro: estrictamente 'deber' o 'examen'",
            },
            title: {
              type: Type.STRING,
              description: 'Título descriptivo del deber o examen.',
            },
            subject: {
              type: Type.STRING,
              description: 'Nombre de la materia o asignatura.',
            },
            date: {
              type: Type.STRING,
              description: 'Fecha en formato ISO 8601 (YYYY-MM-DDTHH:mm:ss) o null si no se puede determinar.',
            },
            datePending: {
              type: Type.BOOLEAN,
              description: 'True si falta concretar la fecha con exactitud.',
            },
            dateDescription: {
              type: Type.STRING,
              description: 'Explicación legible en español (ej: "Mañana a las 18:00", "28 de octubre a las 09:30").',
            },
            priority: {
              type: Type.STRING,
              description: "Prioridad: 'alta', 'media' o 'baja'",
            },
            notes: {
              type: Type.STRING,
              description: 'Detalles adicionales, números de ejercicios, páginas o temario.',
            },
          },
          required: ['type', 'title', 'subject', 'priority'],
        },
      },
    },
    required: ['items'],
  };

  let lastError: any = null;
  let successfulResponse: any = null;
  let modelUsed = '';

  for (const model of CANDIDATE_MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        console.log(`[Gemini Task Parser] Procesando con modelo: ${model} (intento ${attempt + 1})...`);
        const response = await ai.models.generateContent({
          model,
          contents: [
            {
              text: `Analiza el siguiente texto de un estudiante y extrae todos los deberes y exámenes como registros individuales: "${rawText}"`,
            },
          ],
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            responseSchema,
          },
        });

        if (response && response.text) {
          successfulResponse = response;
          modelUsed = model;
          break;
        }
      } catch (err: any) {
        lastError = err;
        console.warn(`[Gemini Task Parser] Modelo ${model} devolvió aviso (${err.status || err.message}).`);
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 600));
        }
      }
    }
    if (successfulResponse) break;
  }

  if (!successfulResponse || !successfulResponse.text) {
    let errMsg = lastError?.message || 'No se pudo procesar la solicitud con ninguno de los modelos de Gemini.';
    try {
      const parsedErr = JSON.parse(errMsg);
      if (parsedErr.error?.code === 503 || parsedErr.error?.status === 'UNAVAILABLE' || (parsedErr.error?.message && parsedErr.error.message.includes('high demand'))) {
        errMsg = 'El servicio de Gemini tiene una sobrecarga temporal de peticiones. Por favor, espera unos segundos y vuelve a pulsar «Añadir». Tu texto se ha conservado.';
      } else if (parsedErr.error?.message) {
        errMsg = parsedErr.error.message;
      }
    } catch {
      // not JSON
    }
    if (errMsg.includes('503') || errMsg.includes('high demand') || errMsg.includes('UNAVAILABLE')) {
      errMsg = 'El servicio de Gemini tiene una sobrecarga temporal de peticiones. Por favor, espera unos segundos y vuelve a pulsar «Añadir». Tu texto se ha conservado.';
    }
    return res.status(500).json({ error: errMsg });
  }

  let outputText = successfulResponse.text.trim();
  if (outputText.startsWith('```json')) {
    outputText = outputText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  } else if (outputText.startsWith('```')) {
    outputText = outputText.replace(/^```\s*/, '').replace(/\s*```$/, '');
  }

  let parsed: any;
  try {
    parsed = JSON.parse(outputText);
  } catch {
    return res.status(500).json({ error: 'La respuesta de la IA no contenía un formato JSON válido.' });
  }

  const rawItems = Array.isArray(parsed.items) ? parsed.items : [];

  if (rawItems.length === 0) {
    return res.json({
      success: true,
      modelUsed,
      items: [],
      message: 'No se detectaron tareas ni exámenes en el texto.',
    });
  }

  // Sanitize and validate every item
  const normalizedItems = rawItems.map((item: any, idx: number) => {
    const rawType = String(item.type || '').toLowerCase();
    const isExam =
      rawType.includes('exam') ||
      rawType.includes('control') ||
      rawType.includes('parcial') ||
      rawType.includes('test') ||
      rawType.includes('prueba') ||
      rawType.includes('evalu');

    const type: 'deber' | 'examen' = isExam ? 'examen' : 'deber';

    let cleanPriority = String(item.priority || '').toLowerCase();
    if (cleanPriority.includes('alt')) cleanPriority = 'alta';
    else if (cleanPriority.includes('baj')) cleanPriority = 'baja';
    else cleanPriority = isExam ? 'alta' : 'media';

    // Date validation
    let isDatePending = Boolean(item.datePending);
    let parsedDate = typeof item.date === 'string' ? item.date.trim() : '';

    if (/^\d{4}-\d{2}-\d{2}$/.test(parsedDate)) {
      parsedDate = isExam ? `${parsedDate}T09:30:00` : `${parsedDate}T18:00:00`;
    }

    let validDateISO: string;

    if (!parsedDate || parsedDate === 'null' || isNaN(new Date(parsedDate).getTime())) {
      isDatePending = true;
      const fallback = new Date(refDate);
      fallback.setDate(fallback.getDate() + 1);
      if (isExam) {
        fallback.setHours(9, 30, 0, 0);
      } else {
        fallback.setHours(18, 0, 0, 0);
      }
      validDateISO = fallback.toISOString();
    } else {
      validDateISO = new Date(parsedDate).toISOString();
    }

    let title = (item.title || (isExam ? 'Examen' : 'Deber')).trim();
    if (isDatePending && !title.includes('[Fecha pendiente]')) {
      title = `${title} [Fecha pendiente]`;
    }

    // RFC4122 v4 compliant ID
    const pseudoUUID = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });

    return {
      id: pseudoUUID,
      type,
      title,
      subject: (item.subject || 'General').trim(),
      date: validDateISO,
      datePending: isDatePending,
      dateDescription: item.dateDescription || (isDatePending ? 'Fecha pendiente de concretar' : undefined),
      priority: cleanPriority,
      notes: (item.notes || '').trim(),
    };
  });

  // Deduplicate identical items in same request
  const uniqueItems: typeof normalizedItems = [];
  const seenKeys = new Set<string>();

  for (const it of normalizedItems) {
    const key = `${it.type}_${it.title.toLowerCase().trim()}_${it.subject.toLowerCase().trim()}_${it.date.slice(0, 10)}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      uniqueItems.push(it);
    }
  }

  return res.json({
    success: true,
    modelUsed,
    items: uniqueItems,
  });
}
