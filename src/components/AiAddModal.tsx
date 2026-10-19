import React, { useState, useEffect } from 'react';
import { Sparkles, Loader2, AlertCircle, X, ArrowRight, CornerDownLeft } from 'lucide-react';
import confetti from 'canvas-confetti';
import { Assignment, Exam, Subject, Priority } from '../types';

export interface ParsedItem {
  id: string;
  type: 'deber' | 'examen';
  title: string;
  subject: string;
  date: string;
  datePending?: boolean;
  dateDescription?: string;
  priority: Priority;
  notes?: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  subjects: Subject[];
  assignments: Assignment[];
  exams: Exam[];
  onSaveAssignment: (assignment: Assignment) => Promise<Assignment>;
  onSaveExam: (exam: Exam) => Promise<Exam>;
  onSaveSubject: (subject: Subject) => Promise<Subject>;
  onSuccessSaved: (summary: {
    assignmentsCount: number;
    examsCount: number;
    duplicatesSkipped: number;
    savedItems: { title: string; type: string; subject: string; date: string }[];
  }) => void;
}

const PRESET_COLORS = [
  '#10b981', // emerald
  '#3b82f6', // blue
  '#8b5cf6', // purple
  '#ec4899', // pink
  '#f59e0b', // amber
  '#ef4444', // red
  '#06b6d4', // cyan
];

const normalizeStr = (str: string) =>
  (str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

export const AiAddModal: React.FC<Props> = ({
  isOpen,
  onClose,
  subjects,
  assignments,
  exams,
  onSaveAssignment,
  onSaveExam,
  onSaveSubject,
  onSuccessSaved,
}) => {
  const [inputText, setInputText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isMissingApiKey, setIsMissingApiKey] = useState(false);

  // Check Gemini configuration status when modal opens
  useEffect(() => {
    if (isOpen) {
      fetch('/api/gemini/status')
        .then((res) => res.json())
        .then((data) => {
          setIsMissingApiKey(!data.available);
        })
        .catch(() => {
          // If status check fails, rely on server response during submit
        });
    } else {
      setErrorMessage(null);
      setIsProcessing(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Check if item already exists in existing assignments or exams
  const checkIfAlreadyExists = (item: { type: 'deber' | 'examen'; title: string; date: string }) => {
    const itemNormTitle = normalizeStr(item.title);
    const itemDay = item.date ? item.date.slice(0, 10) : '';

    if (item.type === 'deber') {
      return assignments.some((a) => {
        const aNorm = normalizeStr(a.title);
        const aDay = a.due_date ? a.due_date.slice(0, 10) : '';
        return aNorm === itemNormTitle && aDay === itemDay;
      });
    } else {
      return exams.some((e) => {
        const eNorm = normalizeStr(e.name);
        const eDay = e.exam_date ? e.exam_date.slice(0, 10) : '';
        return eNorm === itemNormTitle && eDay === itemDay;
      });
    }
  };

  const handleExampleClick = () => {
    setInputText(
      'Hoy me han puesto un examen de Lengua sobre el tema 4 para el 28 de octubre. También me han mandado de Inglés los ejercicios 2, 4, 5 y 7 del workbook para mañana, y tengo que entregar un trabajo de Historia el viernes.'
    );
    setErrorMessage(null);
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setErrorMessage(null);

    const trimmed = inputText.trim();
    if (!trimmed) {
      setErrorMessage('Por favor, escribe o dicta tus tareas con el teclado antes de pulsar «Añadir».');
      return;
    }

    setIsProcessing(true);

    try {
      // 1. Send text to server for Gemini interpretation
      const clientDate = new Date().toISOString();
      const timezone = 'Europe/Madrid';
      const existingSubjectsList = subjects.map((s) => s.name);

      const response = await fetch('/api/gemini/parse-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: trimmed,
          clientDate,
          timezone,
          existingSubjects: existingSubjectsList,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (data.missingKey) {
          setIsMissingApiKey(true);
        }
        throw new Error(data.error || 'Error al comunicarse con el servidor de IA.');
      }

      const items: ParsedItem[] = Array.isArray(data.items) ? data.items : [];

      if (items.length === 0) {
        setErrorMessage(
          'No se han podido detectar deberes ni exámenes concretos en el texto. Revisa la redacción o añade detalles (por ejemplo: asignatura y fecha de entrega) y vuelve a pulsar «Añadir». Tu texto se ha conservado intacto.'
        );
        setIsProcessing(false);
        return;
      }

      // 2. Automatically save all detected items into StudyFlow real database
      const subjectCache = new Map<string, Subject>();
      subjects.forEach((s) => {
        subjectCache.set(normalizeStr(s.name), s);
      });

      let createdAssignments = 0;
      let createdExams = 0;
      let duplicatesSkipped = 0;
      const savedItemsList: { title: string; type: string; subject: string; date: string }[] = [];

      // Avoid creating duplicates within the same batch
      const addedKeysInBatch = new Set<string>();

      for (const item of items) {
        const titleClean = item.title.trim();
        if (!titleClean) continue;

        // Subject matching or creation
        const normSubject = normalizeStr(item.subject);
        let matchedSubject = subjectCache.get(normSubject);

        if (!matchedSubject && onSaveSubject) {
          const randomColor = PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)];
          const newSub: Subject = {
            id: `sub-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            name: item.subject.trim() || 'General',
            color: randomColor,
            weekly_goal_minutes: 120,
            created_at: new Date().toISOString(),
          };
          matchedSubject = await onSaveSubject(newSub);
          subjectCache.set(normSubject, matchedSubject);
        }

        const subjectId = matchedSubject ? matchedSubject.id : subjects[0]?.id || null;
        const subjectName = matchedSubject ? matchedSubject.name : item.subject || 'General';

        // Check if duplicate of an existing record or an item already added in this batch
        const isDuplicateOfExisting = checkIfAlreadyExists({
          type: item.type,
          title: titleClean,
          date: item.date,
        });

        const batchKey = `${item.type}_${normalizeStr(titleClean)}_${item.date.slice(0, 10)}`;
        const isDuplicateInBatch = addedKeysInBatch.has(batchKey);

        if (isDuplicateOfExisting || isDuplicateInBatch) {
          duplicatesSkipped++;
          continue;
        }

        addedKeysInBatch.add(batchKey);

        // Save Assignment or Exam
        if (item.type === 'deber') {
          const newAssignment: Assignment = {
            id: `asg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            title: titleClean,
            description: item.notes?.trim() || undefined,
            subject_id: subjectId,
            due_date: new Date(item.date).toISOString(),
            priority: item.priority || 'media',
            status: 'pendiente',
            estimated_minutes: 30,
            actual_minutes: 0,
            completed_at: null,
            created_at: new Date().toISOString(),
          };
          await onSaveAssignment(newAssignment);
          createdAssignments++;
          savedItemsList.push({
            title: titleClean,
            type: 'deber',
            subject: subjectName,
            date: item.date,
          });
        } else {
          const newExam: Exam = {
            id: `ex-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            name: titleClean,
            subject_id: subjectId,
            exam_date: new Date(item.date).toISOString(),
            priority: item.priority || 'alta',
            status: 'pendiente',
            grade: null,
            max_grade: 10,
            syllabus: item.notes?.trim() || undefined,
            notes: item.notes?.trim() || undefined,
            created_at: new Date().toISOString(),
          };
          await onSaveExam(newExam);
          createdExams++;
          savedItemsList.push({
            title: titleClean,
            type: 'examen',
            subject: subjectName,
            date: item.date,
          });
        }
      }

      // 3. Confirm success only after all saving is truly complete
      confetti({
        particleCount: 50,
        spread: 75,
        origin: { y: 0.65 },
        colors: ['#10b981', '#6366f1', '#38bdf8', '#fbbf24'],
      });

      setInputText('');
      onSuccessSaved({
        assignmentsCount: createdAssignments,
        examsCount: createdExams,
        duplicatesSkipped,
        savedItems: savedItemsList,
      });

      onClose();
    } catch (err: any) {
      console.error('Error al procesar y guardar con IA:', err);
      // Retain the text so the user can edit or retry without losing what they typed
      setErrorMessage(
        err.message || 'Ocurrió un error inesperado al interpretar o guardar las tareas. Tu texto se conserva para reintentar.'
      );
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-xl flex flex-col bg-[#0f141e] border border-[#222d42] rounded-3xl shadow-2xl overflow-hidden">
        {/* Glow accent */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-96 h-24 bg-gradient-to-r from-emerald-500/20 via-indigo-500/20 to-teal-500/20 rounded-full blur-2xl pointer-events-none" />

        {/* Modal Header */}
        <div className="relative z-10 flex items-center justify-between p-4 sm:p-5 border-b border-[#1c2536] bg-[#121927]/90">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-emerald-500 to-indigo-600 p-0.5 shadow-lg shadow-emerald-950/50 flex items-center justify-center">
              <div className="w-full h-full bg-[#111723] rounded-[14px] flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-emerald-400" />
              </div>
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-black text-white tracking-tight flex items-center gap-2">
                <span>Añadir con IA</span>
              </h2>
              <p className="text-xs text-zinc-400">
                Escribe o dicta con el teclado de tu móvil para guardar automáticamente.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            disabled={isProcessing}
            className="w-8 h-8 rounded-xl bg-[#182130] hover:bg-[#222e42] disabled:opacity-40 text-zinc-400 hover:text-white flex items-center justify-center transition border border-[#2a374f] cursor-pointer"
            title="Cerrar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Missing API Key Alert */}
        {isMissingApiKey && (
          <div className="p-3.5 bg-amber-500/10 border-b border-amber-500/20 text-amber-200 text-xs flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold block">Configuración de servidor requerida:</span>
              <span>
                Se necesita configurar la variable <code className="bg-amber-950/60 px-1 py-0.5 rounded font-mono text-amber-300">GEMINI_API_KEY</code> en las variables de entorno del servidor.
              </span>
            </div>
          </div>
        )}

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="relative z-10 p-4 sm:p-6 space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label htmlFor="ai-input-text" className="text-xs font-bold text-zinc-300">
                Texto de tus deberes y exámenes
              </label>
              <button
                type="button"
                onClick={handleExampleClick}
                disabled={isProcessing}
                className="text-[11px] text-emerald-400 hover:text-emerald-300 underline font-medium cursor-pointer disabled:opacity-50"
              >
                Cargar ejemplo
              </button>
            </div>

            <div className="relative">
              <textarea
                id="ai-input-text"
                rows={6}
                value={inputText}
                onChange={(e) => {
                  setInputText(e.target.value);
                  if (errorMessage) setErrorMessage(null);
                }}
                disabled={isProcessing}
                placeholder="Escribe o dicta aquí con el teclado de tu móvil. Ejemplo: «Hoy me han puesto un examen de Lengua sobre el tema 4 para el 28 de octubre. También me han mandado de Inglés los ejercicios 2, 4, 5 y 7 del workbook para mañana, y tengo que entregar un trabajo de Historia el viernes»..."
                className="w-full px-4 py-3 rounded-2xl bg-[#141b27] border border-[#232e42] focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-white text-xs sm:text-sm placeholder:text-zinc-600 focus:outline-none transition resize-none leading-relaxed disabled:opacity-60"
                autoFocus
              />
              {Boolean(inputText) && !isProcessing && (
                <button
                  type="button"
                  onClick={() => setInputText('')}
                  className="absolute right-3 top-3 text-zinc-500 hover:text-zinc-300 transition cursor-pointer p-1 rounded-md"
                  title="Borrar texto"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Hint */}
            <p className="text-[11px] text-zinc-400 leading-normal">
              💡 Puedes incluir varias tareas, fechas relativas («mañana», «el viernes») o fechas fijas («28 de octubre»). La IA detectará cada una por separado y las guardará automáticamente en StudyFlow.
            </p>
          </div>

          {/* Error Banner with Retained Text Confirmation */}
          {errorMessage && (
            <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/25 text-rose-300 text-xs flex items-start gap-2.5 animate-in fade-in">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <span className="font-bold block">No se pudo completar el guardado:</span>
                <span>{errorMessage}</span>
                <span className="block text-[11px] text-rose-400/90 font-medium pt-0.5">
                  ✓ Tu texto no se ha borrado para que puedas corregirlo o volver a pulsar «Añadir».
                </span>
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="pt-2 flex items-center justify-end gap-3 border-t border-[#1a2333]">
            <button
              type="button"
              onClick={onClose}
              disabled={isProcessing}
              className="px-4 py-2.5 rounded-xl bg-[#141c28] hover:bg-[#1a2433] disabled:opacity-50 text-zinc-300 text-xs font-semibold border border-zinc-800 transition cursor-pointer"
            >
              Cancelar
            </button>

            <button
              type="submit"
              disabled={isProcessing || !inputText.trim()}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 via-teal-500 to-indigo-600 hover:from-emerald-400 hover:to-indigo-500 disabled:opacity-50 text-white font-bold text-xs sm:text-sm transition shadow-lg shadow-emerald-950/60 flex items-center gap-2 cursor-pointer active:scale-95"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                  <span>Interpretando y guardando...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 text-amber-300" />
                  <span>Añadir</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
