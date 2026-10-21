import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Navigation } from './components/Navigation';
import { Header } from './components/Header';
import { AuthModal } from './components/AuthModal';
import { AiAddModal } from './components/AiAddModal';
import { DashboardView } from './views/DashboardView';
import { AssignmentsView } from './views/AssignmentsView';
import { CalendarView } from './views/CalendarView';
import { SubjectsView } from './views/SubjectsView';
import { ExamsView } from './views/ExamsView';
import { StudyTimerView } from './views/StudyTimerView';
import { AnalyticsView } from './views/AnalyticsView';
import { SettingsView } from './views/SettingsView';
import {
  ActiveTab,
  Subject,
  Assignment,
  Exam,
  StudySession,
  AcademicPeriod,
  UserProfile,
} from './types';
import { dataService, SyncState } from './lib/storage';
import { getSupabaseClient } from './lib/supabase';
import { registerServiceWorker } from './lib/pushNotifications';
import { startReminderEngine } from './lib/reminderScheduler';
import { WifiOff, CheckCircle2, RotateCcw, X } from 'lucide-react';
import { SavedAiItem } from './components/AiAddModal';

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [syncState, setSyncState] = useState<SyncState>('local');
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [isGlobalAiAddOpen, setIsGlobalAiAddOpen] = useState(false);
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);

  // Core Data Collections
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [exams, setExams] = useState<Exam[]>([]);
  const [studySessions, setStudySessions] = useState<StudySession[]>([]);
  const [periods, setPeriods] = useState<AcademicPeriod[]>([]);
  const [profile, setProfile] = useState<UserProfile>({
    id: 'local',
    full_name: 'Estudiante',
    daily_study_goal_minutes: 120,
    reminder_time: '15:30',
    reminder_days: [1, 2, 3, 4, 5, 6, 7],
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Madrid',
    theme: 'dark',
    calendar_first_day: 1,
    calendar_default_view: 'month',
    notify_daily_reminder: true,
    notify_upcoming_exams: true,
    notify_due_assignments: true,
    notify_overdue_tasks: true,
    notify_study_sessions: true,
  });

  // Pre-fill states for Timer
  const [timerSubjectId, setTimerSubjectId] = useState<string | undefined>(undefined);
  const [timerAssignmentId, setTimerAssignmentId] = useState<string | undefined>(undefined);

  // Undo and Success Toast for AI-added tasks
  const [aiSuccessToast, setAiSuccessToast] = useState<{
    message: string;
    items: SavedAiItem[];
  } | null>(null);
  const [undoStatusMessage, setUndoStatusMessage] = useState<string | null>(null);

  // Listen to online / offline status
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Register service worker on initial load
  useEffect(() => {
    registerServiceWorker();
  }, []);

  // Subscribe to sync state changes
  useEffect(() => {
    return dataService.onSyncChange((state) => {
      setSyncState(state);
    });
  }, []);

  // Automated daily reminder scheduler (monitors time, respects timezone, sends real tasks/exams)
  useEffect(() => {
    const cleanup = startReminderEngine(
      () => profile,
      () => assignments,
      () => exams
    );
    return cleanup;
  }, [profile, assignments, exams]);

  // Initial Data Load
  const loadAllData = useCallback(async () => {
    try {
      const [subs, asgs, exs, sess, pers, prof] = await Promise.all([
        dataService.getSubjects(),
        dataService.getAssignments(),
        dataService.getExams(),
        dataService.getStudySessions(),
        dataService.getAcademicPeriods(),
        dataService.getProfile(),
      ]);

      setSubjects(subs);
      setAssignments(asgs);
      setExams(exs);
      setStudySessions(sess);
      setPeriods(pers);
      setProfile(prof);
    } catch (err) {
      console.error('Error loading initial data:', err);
    }
  }, []);

  // Check Supabase Auth user on mount
  useEffect(() => {
    loadAllData();

    const supabase = getSupabaseClient();
    if (supabase) {
      supabase.auth.getUser().then(({ data }) => {
        if (data.user) {
          setUserEmail(data.user.email || null);
          loadAllData();
        }
      });

      const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
        setUserEmail(session?.user?.email || null);
        loadAllData();
      });

      return () => {
        authListener.subscription.unsubscribe();
      };
    }
  }, [loadAllData]);

  // Handlers for Assignments
  const handleSaveAssignment = async (asg: Assignment) => {
    const saved = await dataService.saveAssignment(asg);
    setAssignments((prev) => {
      const index = prev.findIndex((a) => a.id === saved.id);
      if (index >= 0) {
        const copy = [...prev];
        copy[index] = saved;
        return copy;
      }
      return [saved, ...prev];
    });
    return saved;
  };

  const handleDeleteAssignment = async (id: string) => {
    await dataService.deleteAssignment(id);
    setAssignments((prev) => prev.filter((a) => a.id !== id));
  };

  const handleToggleAssignment = async (id: string) => {
    const updated = await dataService.toggleAssignmentStatus(id);
    if (updated) {
      setAssignments((prev) => prev.map((a) => (a.id === id ? updated : a)));
    }
  };

  // Handlers for Exams
  const handleSaveExam = async (exam: Exam) => {
    const saved = await dataService.saveExam(exam);
    setExams((prev) => {
      const index = prev.findIndex((e) => e.id === saved.id);
      if (index >= 0) {
        const copy = [...prev];
        copy[index] = saved;
        return copy;
      }
      return [saved, ...prev];
    });
    return saved;
  };

  const handleDeleteExam = async (id: string) => {
    await dataService.deleteExam(id);
    setExams((prev) => prev.filter((e) => e.id !== id));
  };

  // Undo AI batch addition
  const handleUndoLastAiBatch = async () => {
    if (!aiSuccessToast || aiSuccessToast.items.length === 0) return;
    const itemsToUndo = [...aiSuccessToast.items];
    setAiSuccessToast(null);

    let undoneCount = 0;
    for (const item of itemsToUndo) {
      try {
        if (item.type === 'deber') {
          await handleDeleteAssignment(item.id);
          undoneCount++;
        } else {
          await handleDeleteExam(item.id);
          undoneCount++;
        }
      } catch (err) {
        console.error('Error al deshacer elemento:', err);
      }
    }
    setUndoStatusMessage(`Acción deshecha: se eliminaron los ${undoneCount} elementos creados.`);
  };

  // Auto-dismiss timers
  useEffect(() => {
    if (aiSuccessToast) {
      const t = setTimeout(() => setAiSuccessToast(null), 12000);
      return () => clearTimeout(t);
    }
  }, [aiSuccessToast]);

  useEffect(() => {
    if (undoStatusMessage) {
      const t = setTimeout(() => setUndoStatusMessage(null), 4000);
      return () => clearTimeout(t);
    }
  }, [undoStatusMessage]);

  // Handlers for Subjects
  const handleSaveSubject = async (sub: Subject) => {
    const saved = await dataService.saveSubject(sub);
    setSubjects((prev) => {
      const index = prev.findIndex((s) => s.id === saved.id);
      if (index >= 0) {
        const copy = [...prev];
        copy[index] = saved;
        return copy;
      }
      return [saved, ...prev];
    });
    return saved;
  };

  const handleDeleteSubject = async (id: string) => {
    await dataService.deleteSubject(id);
    setSubjects((prev) => prev.filter((s) => s.id !== id));
  };

  // Handlers for Study Sessions
  const handleSaveStudySession = async (session: StudySession) => {
    const saved = await dataService.saveStudySession(session);
    setStudySessions((prev) => [saved, ...prev]);
    return saved;
  };

  // Handlers for Profile
  const handleUpdateProfile = async (updates: Partial<UserProfile>) => {
    const updated = await dataService.updateProfile(updates);
    setProfile(updated);
    return updated;
  };

  // Quick navigation to Timer with pre-filled subject/assignment
  const handleStartTimer = (subId?: string, asgId?: string) => {
    setTimerSubjectId(subId);
    setTimerAssignmentId(asgId);
    setActiveTab('timer');
  };

  // Compute minutes studied today
  const minutesStudiedToday = useMemo(() => {
    const today = new Date().toDateString();
    return studySessions
      .filter((s) => new Date(s.start_time).toDateString() === today)
      .reduce((acc, s) => acc + (s.duration_minutes || 0), 0);
  }, [studySessions]);

  // Pending tasks summary text for Push notification
  const pendingTasksSummary = useMemo(() => {
    const now = new Date();
    const active = assignments.filter((a) => a.status !== 'completado');
    const overdue = active.filter((a) => new Date(a.due_date) < now);
    const dueToday = active.filter((a) => new Date(a.due_date).toDateString() === now.toDateString());

    let text = '';
    if (overdue.length > 0) text += `⚠️ ${overdue.length} deberes atrasados. `;
    if (dueToday.length > 0) text += `📋 ${dueToday.length} para hoy. `;
    if (exams.length > 0) {
      const nextEx = exams.find((e) => new Date(e.exam_date) >= now);
      if (nextEx) text += `🎯 Próximo examen: ${nextEx.name}.`;
    }
    return text || '¡Estás al día! Gran momento para concentrarte con StudyFlow.';
  }, [assignments, exams]);

  return (
    <div className="min-h-screen bg-[#090b0e] text-zinc-100 flex flex-col md:flex-row antialiased selection:bg-emerald-500/20 selection:text-emerald-300">
      {/* Offline Toast */}
      {!isOnline && (
        <div className="fixed top-2 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-xl bg-amber-500/90 text-black px-4 py-1.5 text-xs font-bold shadow-xl backdrop-blur-xs">
          <WifiOff className="w-3.5 h-3.5" />
          <span>Modo sin conexión activo — Tus cambios se sincronizarán al recuperar la red.</span>
        </div>
      )}

      {/* Navigation (Sidebar desktop + Bottom bar mobile) */}
      <Navigation
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        syncState={syncState}
        minutesStudiedToday={minutesStudiedToday}
        dailyGoalMinutes={profile.daily_study_goal_minutes || 120}
      />

      {/* Main Content Area */}
      <div className="flex-1 md:pl-64 flex flex-col min-w-0 min-h-screen">
        <Header
          syncState={syncState}
          userEmail={userEmail}
          onOpenAuth={() => setIsAuthOpen(true)}
          onOpenSettings={() => setActiveTab('settings')}
          onOpenAiAdd={() => setIsGlobalAiAddOpen(true)}
        />

        <main className="flex-1 p-4 md:p-8 max-w-7xl w-full mx-auto pb-24 md:pb-12">
          {activeTab === 'dashboard' && (
            <DashboardView
              userName={userEmail ? userEmail.split('@')[0] : profile.full_name}
              assignments={assignments}
              exams={exams}
              subjects={subjects}
              studySessions={studySessions}
              minutesStudiedToday={minutesStudiedToday}
              dailyGoalMinutes={profile.daily_study_goal_minutes || 120}
              onToggleAssignment={handleToggleAssignment}
              onSaveAssignment={handleSaveAssignment}
              onDeleteAssignment={handleDeleteAssignment}
              onSaveExam={handleSaveExam}
              onSaveSubject={handleSaveSubject}
              onOpenNewAssignment={() => setActiveTab('assignments')}
              onOpenNewExam={() => setActiveTab('exams')}
              onStartTimer={handleStartTimer}
              onNavigate={(tab) => setActiveTab(tab)}
            />
          )}

          {activeTab === 'assignments' && (
            <AssignmentsView
              assignments={assignments}
              subjects={subjects}
              exams={exams}
              onSaveAssignment={handleSaveAssignment}
              onDeleteAssignment={handleDeleteAssignment}
              onToggleAssignment={handleToggleAssignment}
              onStartTimer={handleStartTimer}
              onSaveSubject={handleSaveSubject}
              onSaveExam={handleSaveExam}
            />
          )}

          {activeTab === 'calendar' && (
            <CalendarView
              assignments={assignments}
              exams={exams}
              studySessions={studySessions}
              subjects={subjects}
              onOpenNewAssignment={() => setActiveTab('assignments')}
              onOpenNewExam={() => setActiveTab('exams')}
            />
          )}

          {activeTab === 'subjects' && (
            <SubjectsView
              subjects={subjects}
              assignments={assignments}
              exams={exams}
              studySessions={studySessions}
              onSaveSubject={handleSaveSubject}
              onDeleteSubject={handleDeleteSubject}
              onOpenNewAssignment={() => setActiveTab('assignments')}
              onOpenNewExam={() => setActiveTab('exams')}
              onStartTimer={handleStartTimer}
            />
          )}

          {activeTab === 'exams' && (
            <ExamsView
              exams={exams}
              subjects={subjects}
              assignments={assignments}
              onSaveExam={handleSaveExam}
              onDeleteExam={handleDeleteExam}
              onStartTimer={handleStartTimer}
              onSaveSubject={handleSaveSubject}
              onSaveAssignment={handleSaveAssignment}
            />
          )}

          {activeTab === 'timer' && (
            <StudyTimerView
              subjects={subjects}
              assignments={assignments}
              studySessions={studySessions}
              onSaveSession={handleSaveStudySession}
              initialSubjectId={timerSubjectId}
              initialAssignmentId={timerAssignmentId}
            />
          )}

          {activeTab === 'analytics' && (
            <AnalyticsView
              subjects={subjects}
              assignments={assignments}
              exams={exams}
              studySessions={studySessions}
              periods={periods}
            />
          )}

          {activeTab === 'settings' && (
            <SettingsView
              profile={profile}
              onUpdateProfile={handleUpdateProfile}
              userEmail={userEmail}
              syncState={syncState}
              onSignOut={() => {
                const client = getSupabaseClient();
                if (client) client.auth.signOut();
                setUserEmail(null);
              }}
              pendingTasksSummary={pendingTasksSummary}
              onResetAllData={async () => {
                await dataService.resetAllData();
                setAssignments([]);
                setExams([]);
                setSubjects([]);
                setStudySessions([]);
              }}
            />
          )}
        </main>
      </div>

      {/* Global AiAddModal accessible from Header and any tab */}
      <AiAddModal
        isOpen={isGlobalAiAddOpen}
        onClose={() => setIsGlobalAiAddOpen(false)}
        subjects={subjects}
        assignments={assignments}
        exams={exams}
        onSaveAssignment={handleSaveAssignment}
        onSaveExam={handleSaveExam}
        onSaveSubject={handleSaveSubject}
        onSuccessSaved={(summary) => {
          let parts: string[] = [];
          if (summary.assignmentsCount > 0) {
            parts.push(`${summary.assignmentsCount} ${summary.assignmentsCount === 1 ? 'deber' : 'deberes'}`);
          }
          if (summary.examsCount > 0) {
            parts.push(`${summary.examsCount} ${summary.examsCount === 1 ? 'examen' : 'exámenes'}`);
          }
          const summaryStr = parts.length > 0
            ? `Se han añadido ${parts.join(' y ')}.`
            : 'Tareas procesadas con éxito.';

          setAiSuccessToast({
            message: summaryStr,
            items: summary.savedItems,
          });
        }}
      />

      {/* Undo / Success Banner for AI Tasks */}
      {aiSuccessToast && (
        <div className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-50 w-[92%] max-w-md p-3.5 rounded-2xl bg-[#0f172a] border border-emerald-500/40 shadow-2xl shadow-emerald-950/60 flex items-center justify-between gap-3 animate-in fade-in slide-in-from-bottom-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            <div className="min-w-0">
              <span className="text-xs font-bold text-white block truncate">
                {aiSuccessToast.message}
              </span>
              <span className="text-[11px] text-zinc-400 truncate block">
                Guardados automáticamente en tu horario
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={handleUndoLastAiBatch}
              className="px-2.5 py-1.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 text-xs font-bold flex items-center gap-1 transition cursor-pointer active:scale-95"
              title="Deshacer creación de tareas"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Deshacer</span>
            </button>
            <button
              onClick={() => setAiSuccessToast(null)}
              className="p-1 rounded-lg text-zinc-500 hover:text-white transition cursor-pointer"
              title="Cerrar aviso"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Status toast for undo */}
      {undoStatusMessage && (
        <div className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-50 p-3 rounded-xl bg-zinc-900 border border-zinc-700 text-xs font-semibold text-zinc-200 shadow-xl flex items-center gap-2 animate-in fade-in">
          <RotateCcw className="w-4 h-4 text-amber-400" />
          <span>{undoStatusMessage}</span>
        </div>
      )}

      {/* Supabase Authentication & Cloud Setup Modal */}
      <AuthModal
        isOpen={isAuthOpen}
        onClose={() => setIsAuthOpen(false)}
        userEmail={userEmail}
        onOpenSettings={() => {
          setIsAuthOpen(false);
          setActiveTab('settings');
        }}
        onAuthSuccess={(email) => {
          setUserEmail(email);
          loadAllData();
        }}
      />
    </div>
  );
}
