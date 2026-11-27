import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowUpRight,
  Bell,
  CalendarClock,
  Check,
  Clock,
  GripVertical,
  Plus,
  Star,
  Target,
  Trash2,
  X,
} from 'lucide-react';
import type { ConnectionConfig, GoalItem, ReminderItem } from '../types/relay';
import { sendNtfyNotification } from '../services/agentClient';
import { useGridDragReorder } from '../hooks/useGridDragReorder';

interface GoalsViewProps {
  goals: GoalItem[];
  reminders: ReminderItem[];
  config: ConnectionConfig;
  onAddGoal: (title: string, notes: string, milestones: string[]) => void;
  onToggleMilestone: (goalId: string, milestoneId: string) => void;
  onReorderGoals?: (nextGoals: GoalItem[]) => void;
  onDeleteGoal: (goalId: string) => void;
  onDelegateGoal: (goal: GoalItem) => void;
  onAddReminder: (item: Omit<ReminderItem, 'id' | 'completed'>) => void;
  onToggleReminder: (id: string) => void;
  onSnoozeReminder: (id: string) => void;
  onDeleteReminder: (id: string) => void;
  onShowToast: (msg: string) => void;
}

type SectionKey = 'goals' | 'reminders';
type ReminderFilter = 'today' | 'tomorrow' | 'week' | 'completed';

const GOAL_PRIORITY_KEY = 'relay_goal_priority_v1';

interface MiniRingProps {
  value: number;
  color: string;
  size?: number;
  strokeWidth?: number;
}

const MiniRing: React.FC<MiniRingProps> = ({
  value,
  color,
  size = 46,
  strokeWidth = 4.5,
}) => {
  const r = (size - strokeWidth * 2) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (Math.max(0, Math.min(100, value)) / 100) * c;

  return (
    <div
      className="relative flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full -rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--relay-track)"
          strokeWidth={strokeWidth}
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={false}
          animate={{ strokeDashoffset: offset }}
          transition={{ type: 'spring', stiffness: 240, damping: 26 }}
        />
      </svg>
      <span className="absolute font-mono-tabular text-[10px] font-semibold text-[var(--relay-text)]">
        {value}%
      </span>
    </div>
  );
};

export const GoalsView: React.FC<GoalsViewProps> = ({
  goals,
  reminders,
  config,
  onAddGoal,
  onToggleMilestone,
  onReorderGoals,
  onDeleteGoal,
  onDelegateGoal,
  onAddReminder,
  onToggleReminder,
  onSnoozeReminder,
  onDeleteReminder,
  onShowToast,
}) => {
  const [section, setSection] = useState<SectionKey>('goals');
  const [showAddSheet, setShowAddSheet] = useState(false);
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null);
  const [priorityGoalIds, setPriorityGoalIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(GOAL_PRIORITY_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as string[];
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // ignore
    }
    return [];
  });

  // Goal composer
  const [goalTitle, setGoalTitle] = useState('');
  const [goalNotes, setGoalNotes] = useState('');
  const [goalStepsRaw, setGoalStepsRaw] = useState('');
  const [goalImportantDraft, setGoalImportantDraft] = useState(false);
  const [pendingPriorityGoalTitle, setPendingPriorityGoalTitle] = useState<string | null>(null);

  // Reminder composer
  const [remFilter, setRemFilter] = useState<ReminderFilter>('today');
  const [remTitle, setRemTitle] = useState('');
  const [remTime, setRemTime] = useState('20:00');
  const [remDay, setRemDay] = useState<'today' | 'tomorrow' | 'week'>('today');
  const [remPriority, setRemPriority] = useState<'normal' | 'high'>('normal');
  const [remChannel, setRemChannel] = useState<'ntfy' | 'browser' | 'app'>('ntfy');

  useEffect(() => {
    try {
      localStorage.setItem(GOAL_PRIORITY_KEY, JSON.stringify(priorityGoalIds));
    } catch {
      // ignore
    }
  }, [priorityGoalIds]);

  useEffect(() => {
    if (!pendingPriorityGoalTitle) return;
    const match = goals.find((g) => g.title === pendingPriorityGoalTitle);
    if (match) {
      setPriorityGoalIds((prev) => (prev.includes(match.id) ? prev : [...prev, match.id]));
      setPendingPriorityGoalTitle(null);
    }
  }, [goals, pendingPriorityGoalTitle]);

  const { draggingId, startDrag } = useGridDragReorder({
    items: goals,
    getId: (g) => g.id,
    onReorder: (next) => onReorderGoals?.(next),
  });

  const selectedGoal = useMemo(
    () => goals.find((g) => g.id === selectedGoalId) ?? null,
    [goals, selectedGoalId]
  );

  const filteredReminders = useMemo(() => {
    if (remFilter === 'completed') return reminders.filter((r) => r.completed);
    return reminders.filter((r) => !r.completed && r.dayGroup === remFilter);
  }, [reminders, remFilter]);

  const pendingRemindersCount = reminders.filter((r) => !r.completed).length;

  const toggleGoalPriority = (id: string) => {
    setPriorityGoalIds((prev) => {
      const exists = prev.includes(id);
      onShowToast(exists ? '已转为方形浮贴' : '已标记为重点目标（横向满宽）');
      return exists ? prev.filter((x) => x !== id) : [...prev, id];
    });
  };

  const handleCreateGoal = (e: React.FormEvent) => {
    e.preventDefault();
    const t = goalTitle.trim();
    if (!t) return;
    if (goalImportantDraft) {
      setPendingPriorityGoalTitle(t);
    }
    const steps = goalStepsRaw
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    onAddGoal(t, goalNotes.trim(), steps);
    setGoalTitle('');
    setGoalNotes('');
    setGoalStepsRaw('');
    setGoalImportantDraft(false);
    setShowAddSheet(false);
    onShowToast('已贴上新目标浮贴');
  };

  const handleCreateReminder = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = remTitle.trim();
    if (!cleaned) return;
    const prefix = remDay === 'today' ? '今天' : remDay === 'tomorrow' ? '明天' : '本周';
    onAddReminder({
      title: cleaned,
      dueLabel: `${prefix} ${remTime}`,
      dayGroup: remDay,
      priority: remPriority,
      channel: remChannel,
    });
    setRemTitle('');
    setRemPriority('normal');
    setRemFilter(remDay);
    setShowAddSheet(false);
    onShowToast('已贴上新日程提醒');
  };

  const handleTestNotify = async (item: ReminderItem) => {
    if (item.channel === 'ntfy') {
      const res = await sendNtfyNotification(
        config,
        'Relay 提醒',
        `${item.title} (${item.dueLabel})`
      );
      onShowToast(res.detail);
      return;
    }
    if (typeof Notification !== 'undefined') {
      const perm =
        Notification.permission === 'granted'
          ? 'granted'
          : await Notification.requestPermission();
      if (perm === 'granted') {
        new Notification('Relay 提醒', { body: `${item.title} · ${item.dueLabel}` });
        onShowToast('已发送浏览器通知');
        return;
      }
    }
    onShowToast(`提醒触发：${item.title}`);
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-5 pb-28 sm:px-6 lg:py-8 lg:pb-14 space-y-5">
      {/* FLUSH BOARD HEADER (NOT a tile) */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-2.5 min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-[var(--relay-text)]">目标</h1>
          <span className="font-mono-tabular text-xs text-[var(--relay-text-muted)]">
            {goals.length} 计划 · {pendingRemindersCount} 提醒
          </span>
        </div>

        <button
          type="button"
          onClick={() => setShowAddSheet(true)}
          className="mini-tile inline-flex h-10 items-center gap-1.5 rounded-xl px-3.5 text-xs font-semibold text-[var(--relay-text)] transition-transform active:scale-95"
          style={
            {
              '--tile-tint': section === 'goals' ? 'var(--tint-blue)' : 'var(--tint-red)',
            } as React.CSSProperties
          }
        >
          <Plus className="h-4 w-4 text-[var(--accent-indigo)]" />
          <span>{section === 'goals' ? '贴目标' : '贴提醒'}</span>
        </button>
      </div>

      {/* FLUSH SEGMENTED SWITCH + SUB-FILTERS */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-y border-[var(--relay-tile-border)]/45 py-3">
        <div className="inline-flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setSection('goals')}
            style={{ '--tile-tint': 'var(--tint-blue)' } as React.CSSProperties}
            className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-xl px-3.5 text-xs font-medium transition-colors ${
              section === 'goals'
                ? 'mini-tile mini-tile-active text-[var(--relay-text)]'
                : 'text-[var(--relay-text-muted)] hover:text-[var(--relay-text)]'
            }`}
          >
            <Target className="h-3.5 w-3.5 text-[var(--accent-indigo)]" />
            <span>目标</span>
            <span className="font-mono-tabular text-[11px] text-[var(--relay-text-faint)]">
              {goals.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setSection('reminders')}
            style={{ '--tile-tint': 'var(--tint-red)' } as React.CSSProperties}
            className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-xl px-3.5 text-xs font-medium transition-colors ${
              section === 'reminders'
                ? 'mini-tile mini-tile-active text-[var(--relay-text)]'
                : 'text-[var(--relay-text-muted)] hover:text-[var(--relay-text)]'
            }`}
          >
            <CalendarClock className="h-3.5 w-3.5 text-[var(--accent-coral)]" />
            <span>日程</span>
            <span className="font-mono-tabular text-[11px] text-[var(--relay-text-faint)]">
              {pendingRemindersCount}
            </span>
          </button>
        </div>

        {section === 'reminders' && (
          <div className="flex items-center gap-1 overflow-x-auto">
            {(
              [
                ['today', '今天'],
                ['tomorrow', '明天'],
                ['week', '本周'],
                ['completed', '已完成'],
              ] as [ReminderFilter, string][]
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setRemFilter(k)}
                className={`min-h-[32px] rounded-xl px-3 text-xs font-medium transition-colors whitespace-nowrap ${
                  remFilter === k
                    ? 'bg-white/15 text-[var(--relay-text)]'
                    : 'text-[var(--relay-text-muted)] hover:text-[var(--relay-text)]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* SECTION 1: GOALS MAGNETIC TILE BOARD */}
      {section === 'goals' ? (
        goals.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="mini-tile flex h-14 w-14 items-center justify-center rounded-2xl text-[var(--relay-text-faint)]">
              <Target className="h-6 w-6" />
            </div>
            <button
              type="button"
              onClick={() => setShowAddSheet(true)}
              className="mini-tile mt-4 inline-flex min-h-[42px] items-center gap-1.5 rounded-xl px-4 text-xs font-medium text-[var(--relay-text)] active:scale-95"
            >
              <Plus className="h-4 w-4 text-[var(--accent-indigo)]" />
              <span>贴上第一个目标浮贴</span>
            </button>
          </div>
        ) : (
          <div
            className="grid grid-cols-2 lg:grid-cols-4"
            style={{ gap: 'var(--relay-gap)' }}
          >
            <AnimatePresence mode="popLayout">
              {goals.map((goal, idx) => {
                const total = goal.milestones.length;
                const doneCount = goal.milestones.filter((m) => m.done).length;
                const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;
                const isPriority = priorityGoalIds.includes(goal.id);
                const isDragging = draggingId === goal.id;
                const goalTints = [
                  'var(--tint-blue)',
                  'var(--tint-violet)',
                  'var(--tint-teal)',
                  'var(--tint-cyan)',
                  'var(--tint-amber)',
                ];
                const goalAngles = ['164deg', '186deg', '172deg', '194deg', '160deg'];
                const tintVar = isPriority
                  ? 'var(--tint-red)'
                  : pct >= 100 && total > 0
                    ? 'var(--tint-emerald)'
                    : goalTints[idx % goalTints.length];
                const accentVar = isPriority
                  ? 'var(--accent-coral)'
                  : pct >= 100 && total > 0
                    ? 'var(--accent-mint)'
                    : 'var(--accent-indigo)';

                return (
                  <motion.article
                    key={goal.id}
                    data-drag-tile-id={goal.id}
                    layout
                    initial={{ opacity: 0, scale: 0.92 }}
                    animate={{
                      opacity: isDragging ? 0.95 : 1,
                      scale: isDragging ? 1.03 : 1,
                    }}
                    exit={{ opacity: 0, scale: 0.85, y: -10 }}
                    transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                    onClick={() => setSelectedGoalId(goal.id)}
                    style={
                      {
                        '--tile-tint': tintVar,
                        '--tile-angle': goalAngles[idx % goalAngles.length],
                      } as React.CSSProperties
                    }
                    className={`board-tile flex cursor-pointer flex-col justify-between gap-2.5 ${
                      isPriority ? 'board-tile-priority col-span-2' : 'col-span-1'
                    } ${isDragging ? 'z-30 ring-2 ring-white/75 shadow-2xl' : ''}`}
                  >
                    {/* Header: Target icon + Star + Drag Grip */}
                    <div className="flex items-center justify-between gap-1">
                      <div className="flex items-center gap-1.5 text-[11px] text-[var(--relay-text-muted)]">
                        <Target className="h-3.5 w-3.5" style={{ color: accentVar }} />
                        <span className="font-mono-tabular">
                          {total > 0 ? `${doneCount}/${total}` : '计划'}
                        </span>
                      </div>

                      <div
                        className="flex items-center gap-0.5 shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={() => toggleGoalPriority(goal.id)}
                          aria-label={isPriority ? '取消重点' : '标为重点'}
                          className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${
                            isPriority
                              ? 'text-[var(--accent-coral)]'
                              : 'text-[var(--relay-text-faint)] hover:text-[var(--relay-text)]'
                          }`}
                        >
                          <Star className={`h-3.5 w-3.5 ${isPriority ? 'fill-current' : ''}`} />
                        </button>
                        <button
                          type="button"
                          onPointerDown={(e) => startDrag(goal.id, e)}
                          aria-label="拖动排序"
                          className="touch-none flex h-7 w-7 cursor-grab items-center justify-center rounded-lg text-[var(--relay-text-faint)] hover:bg-white/10 hover:text-[var(--relay-text)] active:cursor-grabbing"
                        >
                          <GripVertical className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Visual Body */}
                    {isPriority ? (
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1 space-y-1.5">
                          <h2 className="line-clamp-2 text-[15px] font-semibold leading-snug text-[var(--relay-text)]">
                            {goal.title}
                          </h2>
                          {goal.milestones.slice(0, 2).map((m) => (
                            <button
                              key={m.id}
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onToggleMilestone(goal.id, m.id);
                              }}
                              className="flex w-full items-center gap-1.5 text-left text-[11px]"
                            >
                              <span
                                className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
                                  m.done
                                    ? 'border-[var(--accent-mint)] bg-[var(--accent-mint)] text-[#0D1017]'
                                    : 'border-white/30'
                                }`}
                              >
                                {m.done && <Check className="h-2.5 w-2.5" />}
                              </span>
                              <span
                                className={`truncate ${
                                  m.done
                                    ? 'text-[var(--relay-text-faint)] line-through'
                                    : 'text-[var(--relay-text-muted)]'
                                }`}
                              >
                                {m.text}
                              </span>
                            </button>
                          ))}
                        </div>
                        <MiniRing value={pct} color={accentVar} size={56} strokeWidth={5} />
                      </div>
                    ) : (
                      <div className="flex flex-1 flex-col justify-between gap-2">
                        <h2 className="line-clamp-2 text-[13px] font-semibold leading-snug text-[var(--relay-text)]">
                          {goal.title}
                        </h2>
                        <div className="flex items-center justify-between gap-2">
                          <MiniRing value={pct} color={accentVar} size={44} strokeWidth={4.5} />
                          <span className="font-mono-tabular text-[10px] text-[var(--relay-text-faint)]">
                            {goal.updatedAt}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Bottom Action Strip */}
                    <div
                      className="flex items-center justify-between gap-1 border-t border-white/10 pt-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => onDeleteGoal(goal.id)}
                        aria-label="删除目标"
                        className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--relay-text-faint)] hover:text-[var(--accent-coral)]"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelegateGoal(goal)}
                        className="inline-flex h-7 items-center gap-0.5 rounded-lg bg-white/12 px-2 text-[10px] font-semibold text-[var(--relay-text)] active:scale-95 hover:bg-white/20"
                      >
                        <span>助理</span>
                        <ArrowUpRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </motion.article>
                );
              })}
            </AnimatePresence>
          </div>
        )
      ) : (
        /* SECTION 2: REMINDERS MAGNETIC TILE BOARD */
        filteredReminders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="mini-tile flex h-14 w-14 items-center justify-center rounded-2xl text-[var(--relay-text-faint)]">
              <Bell className="h-6 w-6" />
            </div>
            <button
              type="button"
              onClick={() => setShowAddSheet(true)}
              className="mini-tile mt-4 inline-flex min-h-[42px] items-center gap-1.5 rounded-xl px-4 text-xs font-medium text-[var(--relay-text)] active:scale-95"
            >
              <Plus className="h-4 w-4 text-[var(--accent-coral)]" />
              <span>贴上一条日程提醒</span>
            </button>
          </div>
        ) : (
          <div
            className="grid grid-cols-2 lg:grid-cols-4"
            style={{ gap: 'var(--relay-gap)' }}
          >
            <AnimatePresence mode="popLayout">
              {filteredReminders.map((item, idx) => {
                const isHigh = item.priority === 'high' && !item.completed;
                const remTints = ['var(--tint-violet)', 'var(--tint-cyan)', 'var(--tint-teal)', 'var(--tint-rose)'];
                const remAngles = ['168deg', '188deg', '160deg', '180deg'];
                const tintVar = item.completed
                  ? '#334155'
                  : isHigh
                    ? 'var(--tint-red)'
                    : remTints[idx % remTints.length];
                return (
                  <motion.article
                    key={item.id}
                    layout
                    initial={{ opacity: 0, scale: 0.92 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.85, y: -8 }}
                    transition={{ type: 'spring', stiffness: 360, damping: 28 }}
                    style={
                      {
                        '--tile-tint': tintVar,
                        '--tile-angle': remAngles[idx % remAngles.length],
                      } as React.CSSProperties
                    }
                    className={`board-tile flex flex-col justify-between gap-2.5 ${
                      isHigh ? 'board-tile-priority col-span-2' : 'col-span-1'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <span className="font-mono-tabular text-xs font-semibold text-[var(--relay-text)]">
                        {item.dueLabel}
                      </span>
                      <button
                        type="button"
                        onClick={() => onToggleReminder(item.id)}
                        aria-label={item.completed ? '取消完成' : '完成撕下'}
                        className={`flex h-7 w-7 items-center justify-center rounded-lg border transition-colors ${
                          item.completed
                            ? 'border-[var(--accent-mint)] bg-[var(--accent-mint)] text-[#0D1017]'
                            : 'border-white/25 bg-black/25 text-[var(--relay-text-muted)] hover:border-white/60'
                        }`}
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <div
                      className={`line-clamp-2 text-[13px] font-semibold leading-snug ${
                        item.completed
                          ? 'text-[var(--relay-text-faint)] line-through'
                          : 'text-[var(--relay-text)]'
                      }`}
                    >
                      {item.title}
                    </div>

                    <div className="flex items-center justify-between border-t border-white/10 pt-2">
                      <span className="font-mono-tabular text-[10px] text-[var(--relay-text-faint)]">
                        {item.channel}
                      </span>
                      <div className="flex items-center gap-1">
                        {!item.completed && (
                          <>
                            <button
                              type="button"
                              onClick={() => void handleTestNotify(item)}
                              aria-label="测试推送"
                              className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--relay-text-muted)] hover:bg-white/10 hover:text-[var(--accent-indigo)]"
                            >
                              <Bell className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => onSnoozeReminder(item.id)}
                              aria-label="延后30分钟"
                              className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--relay-text-muted)] hover:bg-white/10 hover:text-[var(--relay-text)]"
                            >
                              <Clock className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => onDeleteReminder(item.id)}
                          aria-label="删除提醒"
                          className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--relay-text-faint)] hover:text-[var(--accent-coral)]"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </motion.article>
                );
              })}
            </AnimatePresence>
          </div>
        )
      )}

      {/* ADD GOAL OR REMINDER SHEET */}
      <AnimatePresence>
        {showAddSheet && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowAddSheet(false)}
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 backdrop-blur-sm sm:items-center"
          >
            {section === 'goals' ? (
              <motion.form
                initial={{ y: 24, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 20, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
                onSubmit={handleCreateGoal}
                className="mac-card w-full max-w-md rounded-[26px] p-5 text-[var(--relay-text)] shadow-2xl space-y-3.5"
              >
                <div className="flex items-center justify-between pb-3 border-b border-white/12">
                  <span className="text-sm font-semibold">新目标浮贴</span>
                  <button
                    type="button"
                    onClick={() => setShowAddSheet(false)}
                    aria-label="关闭"
                    className="flex h-8 w-8 items-center justify-center rounded-xl text-[var(--relay-text-muted)]"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <input
                  type="text"
                  autoFocus
                  value={goalTitle}
                  onChange={(e) => setGoalTitle(e.target.value)}
                  placeholder="目标标题"
                  className="min-h-[44px] w-full rounded-xl border border-white/15 bg-black/30 px-3.5 text-sm text-[var(--relay-text)] placeholder:text-[var(--relay-text-faint)] focus:border-white/45 focus:outline-none"
                />

                <button
                  type="button"
                  onClick={() => setGoalImportantDraft((v) => !v)}
                  style={
                    {
                      '--tile-tint': goalImportantDraft ? 'var(--tint-red)' : 'var(--tint-blue)',
                    } as React.CSSProperties
                  }
                  className={`mini-tile flex min-h-[40px] w-full items-center justify-between rounded-xl px-3.5 text-xs font-medium ${
                    goalImportantDraft ? 'mini-tile-active text-[var(--relay-text)]' : 'text-[var(--relay-text-muted)]'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Star
                      className={`h-4 w-4 ${
                        goalImportantDraft ? 'fill-current text-[var(--accent-coral)]' : ''
                      }`}
                    />
                    <span>标记为重点</span>
                  </span>
                  <span className="font-mono-tabular text-[11px] text-[var(--relay-text-faint)]">
                    {goalImportantDraft ? '横向满宽' : '半宽方形'}
                  </span>
                </button>

                <input
                  type="text"
                  value={goalNotes}
                  onChange={(e) => setGoalNotes(e.target.value)}
                  placeholder="备注（可选）"
                  className="min-h-[40px] w-full rounded-xl border border-white/12 bg-black/30 px-3 text-xs text-[var(--relay-text)] placeholder:text-[var(--relay-text-faint)] focus:border-white/40 focus:outline-none"
                />

                <textarea
                  rows={3}
                  value={goalStepsRaw}
                  onChange={(e) => setGoalStepsRaw(e.target.value)}
                  placeholder="里程碑（每行一条，可选）"
                  className="w-full rounded-xl border border-white/12 bg-black/30 px-3 py-2 text-xs text-[var(--relay-text)] placeholder:text-[var(--relay-text-faint)] focus:border-white/40 focus:outline-none"
                />

                <button
                  type="submit"
                  disabled={!goalTitle.trim()}
                  className="flex h-11 w-full items-center justify-center rounded-2xl bg-white text-xs font-semibold text-[#0D1017] disabled:opacity-40"
                >
                  贴到看板
                </button>
              </motion.form>
            ) : (
              <motion.form
                initial={{ y: 24, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 20, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
                onSubmit={handleCreateReminder}
                className="mac-card w-full max-w-md rounded-[26px] p-5 text-[var(--relay-text)] shadow-2xl space-y-3.5"
              >
                <div className="flex items-center justify-between pb-3 border-b border-white/12">
                  <span className="text-sm font-semibold">新日程提醒</span>
                  <button
                    type="button"
                    onClick={() => setShowAddSheet(false)}
                    aria-label="关闭"
                    className="flex h-8 w-8 items-center justify-center rounded-xl text-[var(--relay-text-muted)]"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <input
                  type="text"
                  autoFocus
                  value={remTitle}
                  onChange={(e) => setRemTitle(e.target.value)}
                  placeholder="提醒内容"
                  className="min-h-[44px] w-full rounded-xl border border-white/15 bg-black/30 px-3.5 text-sm text-[var(--relay-text)] placeholder:text-[var(--relay-text-faint)] focus:border-white/45 focus:outline-none"
                />

                <div className="grid grid-cols-3 gap-2">
                  <select
                    value={remDay}
                    onChange={(e) => setRemDay(e.target.value as 'today' | 'tomorrow' | 'week')}
                    aria-label="日期分组"
                    className="min-h-[40px] rounded-xl border border-white/12 bg-black/30 px-2.5 text-xs text-[var(--relay-text)]"
                  >
                    <option value="today">今天</option>
                    <option value="tomorrow">明天</option>
                    <option value="week">本周</option>
                  </select>
                  <input
                    type="time"
                    value={remTime}
                    onChange={(e) => setRemTime(e.target.value)}
                    aria-label="提醒时间"
                    className="min-h-[40px] rounded-xl border border-white/12 bg-black/30 px-2.5 font-mono-tabular text-xs text-[var(--relay-text)]"
                  />
                  <select
                    value={remChannel}
                    onChange={(e) => setRemChannel(e.target.value as 'ntfy' | 'browser' | 'app')}
                    aria-label="通知渠道"
                    className="min-h-[40px] rounded-xl border border-white/12 bg-black/30 px-2.5 text-xs text-[var(--relay-text)]"
                  >
                    <option value="ntfy">ntfy</option>
                    <option value="browser">通知</option>
                    <option value="app">应用内</option>
                  </select>
                </div>

                <button
                  type="button"
                  onClick={() => setRemPriority((p) => (p === 'high' ? 'normal' : 'high'))}
                  style={
                    {
                      '--tile-tint': remPriority === 'high' ? 'var(--tint-red)' : 'var(--tint-violet)',
                    } as React.CSSProperties
                  }
                  className={`mini-tile flex min-h-[40px] w-full items-center justify-between rounded-xl px-3.5 text-xs font-medium ${
                    remPriority === 'high' ? 'mini-tile-active text-[var(--relay-text)]' : 'text-[var(--relay-text-muted)]'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Star
                      className={`h-4 w-4 ${
                        remPriority === 'high' ? 'fill-current text-[var(--accent-coral)]' : ''
                      }`}
                    />
                    <span>高优先级提醒</span>
                  </span>
                  <span className="font-mono-tabular text-[11px] text-[var(--relay-text-faint)]">
                    {remPriority === 'high' ? '横向满宽' : '半宽方形'}
                  </span>
                </button>

                <button
                  type="submit"
                  disabled={!remTitle.trim()}
                  className="flex h-11 w-full items-center justify-center rounded-2xl bg-white text-xs font-semibold text-[#0D1017] disabled:opacity-40"
                >
                  贴到日程
                </button>
              </motion.form>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* GOAL DETAIL DRAWER */}
      <AnimatePresence>
        {selectedGoal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSelectedGoalId(null)}
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 backdrop-blur-sm sm:items-center"
          >
            <motion.div
              initial={{ y: 24, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 20, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="mac-card w-full max-w-md rounded-[26px] p-5 text-[var(--relay-text)] shadow-2xl space-y-4"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-[var(--relay-text)]">
                    {selectedGoal.title}
                  </h2>
                  {selectedGoal.notes && (
                    <p className="mt-1 text-xs text-[var(--relay-text-muted)]">
                      {selectedGoal.notes}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedGoalId(null)}
                  aria-label="关闭"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-[var(--relay-text-muted)]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {selectedGoal.milestones.length > 0 && (
                <div className="space-y-1.5">
                  {selectedGoal.milestones.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => onToggleMilestone(selectedGoal.id, m.id)}
                      className="mini-tile flex min-h-[42px] w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs"
                    >
                      <span
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                          m.done
                            ? 'border-[var(--accent-mint)] bg-[var(--accent-mint)] text-[#0D1017]'
                            : 'border-white/30'
                        }`}
                      >
                        {m.done && <Check className="h-3 w-3" />}
                      </span>
                      <span
                        className={
                          m.done
                            ? 'text-[var(--relay-text-faint)] line-through'
                            : 'text-[var(--relay-text)]'
                        }
                      >
                        {m.text}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-2 pt-2 border-t border-white/12">
                <button
                  type="button"
                  onClick={() => {
                    onDeleteGoal(selectedGoal.id);
                    setSelectedGoalId(null);
                  }}
                  aria-label="删除目标"
                  className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/12 text-[var(--relay-text-muted)] hover:text-[var(--accent-coral)]"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => toggleGoalPriority(selectedGoal.id)}
                  className="flex h-10 items-center gap-1.5 rounded-xl border border-white/12 px-3.5 text-xs font-medium text-[var(--relay-text)]"
                >
                  <Star
                    className={`h-3.5 w-3.5 ${
                      priorityGoalIds.includes(selectedGoal.id)
                        ? 'fill-current text-[var(--accent-coral)]'
                        : ''
                    }`}
                  />
                  <span>{priorityGoalIds.includes(selectedGoal.id) ? '取消重点' : '标为重点'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onDelegateGoal(selectedGoal);
                    setSelectedGoalId(null);
                  }}
                  className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-white px-4 text-xs font-semibold text-[#0D1017]"
                >
                  <span>交给助理推进</span>
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
