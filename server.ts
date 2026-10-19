import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import webpush from 'web-push';
import { GoogleGenAI, Type } from '@google/genai';
import { createServer as createViteServer } from 'vite';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === 'production';

// Support audio uploads and structured payloads
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// CORS & Preflight Handling for API
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

// VAPID Configuration for Web Push
// Use provided env vars or fallback to a persistent default test keypair
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || 'BDbXhM_5O1xdJcldjjBBWtrmUtw_iWWfbiHOQlKjBmo8OvNC68_YJd453m06CRG9wXMm9o3Y2r1Y-PTO6_NqqqE';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || 'w3lBNFcdyiOsNFccs1K9LeFgGTo507T6PlbOCOuZDI8';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:soporte@studyflow.app';

try {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} catch (err) {
  console.error('[WebPush] Error setting VAPID details:', err);
}

// ----------------------------------------------------
// API ROUTES
// ----------------------------------------------------

// 1. Health check
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    app: 'StudyFlow',
    timestamp: new Date().toISOString(),
    vapidConfigured: Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY),
  });
});

// 2. Get Public VAPID Key for client Web Push registration
app.get('/api/vapid-public-key', (_req: Request, res: Response) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

// 3. Send direct test push notification
app.post('/api/push/send-test', async (req: Request, res: Response) => {
  const { subscription, title, body, url } = req.body;

  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'Falta el objeto de suscripción válido' });
  }

  const payload = JSON.stringify({
    title: title || 'StudyFlow — Notificación de Prueba',
    body: body || '¡Las notificaciones Web Push están funcionando correctamente!',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    url: url || '/',
    tag: 'test-notification-' + Date.now(),
  });

  try {
    const result = await webpush.sendNotification(subscription, payload);
    return res.json({
      success: true,
      statusCode: result.statusCode,
      message: 'Notificación enviada con éxito',
    });
  } catch (error: any) {
    console.error('[WebPush] Error sending test notification:', error);
    // If 410 or 404, subscription expired
    const isExpired = error.statusCode === 410 || error.statusCode === 404;
    return res.status(error.statusCode || 500).json({
      error: error.message || 'Error al enviar notificación push',
      statusCode: error.statusCode,
      expired: isExpired,
    });
  }
});

// 4. Trigger scheduled/manual reminders evaluation
app.post('/api/push/trigger-reminder', async (req: Request, res: Response) => {
  const { subscription, itemsSummary } = req.body;

  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'Falta la suscripción' });
  }

  const payload = JSON.stringify({
    title: 'StudyFlow — Recordatorio Académico',
    body: itemsSummary || 'Tienes tareas y revisiones académicas pendientes.',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    url: '/',
    tag: 'daily-reminder-' + Date.now(),
  });

  try {
    const result = await webpush.sendNotification(subscription, payload);
    return res.json({ success: true, statusCode: result.statusCode });
  } catch (error: any) {
    console.error('[WebPush] Error triggering reminder:', error);
    return res.status(error.statusCode || 500).json({
      error: error.message || 'Error al emitir recordatorio push',
    });
  }
});

// 5. Check Gemini Assistant API status
app.get('/api/gemini/status', (_req: Request, res: Response) => {
  const apiKey = process.env.GEMINI_API_KEY;
  const isConfigured = Boolean(apiKey && apiKey !== 'MY_GEMINI_API_KEY' && apiKey.trim().length > 10);
  res.json({
    available: isConfigured,
    model: 'gemini-3.8-flash',
  });
});

// Helper function to process academic text parsing with Gemini
async function processAcademicPromptWithGemini(body: any, res: Response) {
  const { text, clientDate, timezone, existingSubjects } = body;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY' || apiKey.trim().length < 10) {
    return res.status(500).json({
      error: 'No se ha configurado la variable de entorno GEMINI_API_KEY en el servidor.',
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

  const CANDIDATE_MODELS = [
    'gemini-3-flash-preview',
    'gemini-3.8-flash',
    'gemini-3.1-flash-lite',
    'gemini-flash-latest',
  ];

  let lastError: any = null;
  let successfulResponse: any = null;
  let modelUsed = '';

  for (const model of CANDIDATE_MODELS) {
    // Attempt up to 2 times per model if a 503/429 spike occurs
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        console.log(`[Gemini Task Parser] Intentando procesar texto con modelo: ${model} (intento ${attempt + 1})...`);
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
          console.log(`[Gemini Task Parser] Éxito con modelo: ${model}`);
          break;
        }
      } catch (err: any) {
        lastError = err;
        console.warn(`[Gemini Task Parser] Modelo ${model} devolvió error (${err.status || err.message}).`);
        // Brief pause before retry on high demand
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 600));
        }
      }
    }
    if (successfulResponse) break;
  }

  if (!successfulResponse || !successfulResponse.text) {
    throw lastError || new Error('No se pudo procesar la solicitud con ninguno de los modelos de Gemini.');
  }

  let outputText = successfulResponse.text.trim();
  if (outputText.startsWith('```json')) {
    outputText = outputText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  } else if (outputText.startsWith('```')) {
    outputText = outputText.replace(/^```\s*/, '').replace(/\s*```$/, '');
  }

  const parsed = JSON.parse(outputText);
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

    // If date is simple YYYY-MM-DD without hours, append default hours (09:30 for exam, 18:00 for task)
    if (/^\d{4}-\d{2}-\d{2}$/.test(parsedDate)) {
      parsedDate = isExam ? `${parsedDate}T09:30:00` : `${parsedDate}T18:00:00`;
    }

    let validDateISO: string;

    if (!parsedDate || parsedDate === 'null' || isNaN(new Date(parsedDate).getTime())) {
      // Date could not be determined safely
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

    return {
      id: `ai-item-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
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

// 6. Gemini Add with AI - Parse student academic tasks
app.post('/api/gemini/parse-tasks', async (req: Request, res: Response) => {
  try {
    await processAcademicPromptWithGemini(req.body, res);
  } catch (error: any) {
    console.error('[Gemini Task Parser] Error:', error);
    let errMsg = error.message || 'Error al procesar el texto con Gemini';
    try {
      const parsed = JSON.parse(errMsg);
      if (parsed.error?.code === 503 || parsed.error?.status === 'UNAVAILABLE' || (parsed.error?.message && parsed.error.message.includes('high demand'))) {
        errMsg = 'El servicio de Gemini tiene una sobrecarga temporal de peticiones. Por favor, espera unos segundos y vuelve a pulsar «Añadir». Tu texto se ha conservado.';
      } else if (parsed.error?.message) {
        errMsg = parsed.error.message;
      }
    } catch {
      // not JSON string
    }
    if (errMsg.includes('503') || errMsg.includes('high demand') || errMsg.includes('UNAVAILABLE')) {
      errMsg = 'El servicio de Gemini tiene una sobrecarga temporal de peticiones. Por favor, espera unos segundos y vuelve a pulsar «Añadir». Tu texto se ha conservado.';
    }
    return res.status(500).json({
      error: errMsg,
    });
  }
});

// Backward-compatible alias for existing endpoints
app.post('/api/gemini/analyze-voice', async (req: Request, res: Response) => {
  try {
    await processAcademicPromptWithGemini(req.body, res);
  } catch (error: any) {
    console.error('[Gemini Legacy Alias] Error:', error);
    return res.status(500).json({
      error: error.message || 'Error al procesar la petición con Gemini',
    });
  }
});

// ----------------------------------------------------
// VITE INTEGRATION
// ----------------------------------------------------
async function startServer() {
  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[StudyFlow] Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('[StudyFlow] Failed to start server:', err);
  process.exit(1);
});
