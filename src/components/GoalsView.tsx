import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, GripVertical, X } from 'lucide-react';
import type { AgentProfile, ConnectionConfig, GoalItem, ReminderItem } from '../types/relay';
import { sendNtfyNotification } from '../services/agentClient';
import { useGridDragReorder } from '../hooks/useGridDragReorder';
import { MuseAvatarHeader } from './MuseAvatarHeader';
import {
  Alarm,
  ArrowUpRight,
  ArrowsClockwise,
  Clock,
  FeedReminderIcon,
  GoalFinanceIcon,
  GoalHealthIcon,
  GoalInterestIcon,
  GoalOthersIcon,
  GoalProductivityIcon,
  NavGoalsIcon,
  Plus,
  Star,
  Trash,
} from './AppIcons';

interface GoalsViewProps {
  goals: GoalItem[];
  reminders: ReminderItem[];
  config: ConnectionConfig;
  agentProfile?: AgentProfile;
  isVoiceActive?: boolean;
  onOpenDrawer?: () => void;
  onTapAvatar?: () => void;
  onSyncStateWithAgent?: () => void;
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

interface CategoryStarter {
  key: string;
  label: string;
  defaultNote: string;
  placeholder: string;
  bgTint: string;
  Icon: React.ComponentType<{ className?: string }>;
}

const GOAL_CATEGORIES: CategoryStarter[] = [
  {
    key: 'health',
    label: 'Health',
    defaultNote: 'Health',
    placeholder: '每周跑步 3 次 / 23:30 入睡',
    bgTint: 'bg-zinc-100 dark:bg-zinc-800',
    Icon: GoalHealthIcon,
  },
  {
    key: 'productivity',
    label: 'Productivity',
    defaultNote: 'Productivity',
    placeholder: '完成实验与论文初稿',
    bgTint: 'bg-zinc-100 dark:bg-zinc-800',
    Icon: GoalProductivityIcon,
  },
  {
    key: 'interest',
    label: 'Interest',
    defaultNote: 'Interest',
    placeholder: '每月精读 2 本书',
    bgTint: 'bg-zinc-100 dark:bg-zinc-800',
    Icon: GoalInterestIcon,
  },
  {
    key: 'finance',
    label: 'Finance',
    defaultNote: 'Finance',
    placeholder: '每月自动定投复盘',
    bgTint: 'bg-zinc-100 dark:bg-zinc-800',
    Icon: GoalFinanceIcon,
  },
  {
    key: 'others',
    label: 'Others',
    defaultNote: 'Others',
    placeholder: '输入目标…',
    bgTint: 'bg-zinc-100 dark:bg-zinc-800',
    Icon: GoalOthersIcon,
  },
];

interface MiniRingProps {
  value: number;
  size?: number;
  strokeWidth?: number;
}

const MiniRing: React.FC<MiniRingProps> = ({ value, size = 40, strokeWidth = 3.5 }) => {
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
          stroke={value >= 100 ? 'var(--accent-mint)' : 'var(--accent-primary)'}
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
  agentProfile,
  isVoiceActive = false,
  onOpenDrawer,
  onTapAvatar,
  onSyncStateWithAgent,
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
  const [activeCategoryPlaceholder, setActiveCategoryPlaceholder] = useState('输入目标…');
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

  const openGoalSheetWithCategory = (cat?: CategoryStarter) => {
    setSection('goals');
    setGoalTitle('');
    setGoalNotes(cat ? cat.defaultNote : '');
    setActiveCategoryPlaceholder(cat ? cat.placeholder : '输入目标…');
    setGoalStepsRaw('');
    setGoalImportantDraft(false);
    setShowAddSheet(true);
  };

  const toggleGoalPriority = (id: string) => {
    setPriorityGoalIds((prev) => {
      const exists = prev.includes(id);
      onShowToast(exists ? '已取消重点' : '已设为重点');
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
    onShowToast('已创建');
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
    onShowToast('已添加');
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
        onShowToast('已推送');
        return;
      }
    }
    onShowToast(item.title);
  };

  return (
    <div className="mx-auto w-full max-w-[680px] px-4 pt-3 pb-28 sm:px-6 lg:pt-7 lg:pb-14 space-y-4">
      {/* Shared Muse Header — tapping circular AI avatar starts in-place voice */}
      <MuseAvatarHeader
        agentProfile={agentProfile}
        isVoiceActive={isVoiceActive}
        onOpenDrawer={onOpenDrawer}
        onTapAvatar={onTapAvatar}
        rightSlot={
          onSyncStateWithAgent ? (
            <button
              type="button"
              onClick={onSyncStateWithAgent}
              aria-label="立即同步状态给助理"
              title="同步完成进度给助理"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-black/[0.08] bg-white text-zinc-800 shadow-xs transition-colors hover:bg-zinc-50 active:scale-95 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-200"
            >
              <ArrowsClockwise weight="regular" className="h-[18px] w-[18px]" />
            </button>
          ) : undefined
        }
      />

      {/* Card 1: Goals / Reminders Elevated Card */}
      <section className="muse-card rounded-[26px] p-5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {section === 'goals' ? (
              <NavGoalsIcon className="h-5 w-5" active />
            ) : (
              <FeedReminderIcon className="h-5 w-5" active />
            )}
            <h1 className="text-[18px] font-semibold tracking-tight text-[var(--relay-text)]">
              {section === 'goals' ? 'Goals' : '日程'}
            </h1>
            <span className="font-mono-tabular text-xs text-[var(--relay-text-faint)]">
              {section === 'goals' ? goals.length : pendingRemindersCount}
            </span>
          </div>

          <div className="inline-flex rounded-full bg-zinc-100 p-0.5 dark:bg-zinc-800/80">
            <button
              type="button"
              onClick={() => setSection('goals')}
              aria-label="目标"
              className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                section === 'goals'
                  ? 'bg-white text-zinc-950 shadow-xs dark:bg-zinc-700 dark:text-white'
                  : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
              }`}
            >
              <NavGoalsIcon className="h-3.5 w-3.5" active={section === 'goals'} />
              <span>目标</span>
            </button>
            <button
              type="button"
              onClick={() => setSection('reminders')}
              aria-label="日程"
              className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                section === 'reminders'
                  ? 'bg-white text-zinc-950 shadow-xs dark:bg-zinc-700 dark:text-white'
                  : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
              }`}
            >
              <Alarm
                weight={section === 'reminders' ? 'fill' : 'regular'}
                className="h-3.5 w-3.5"
              />
              <span>日程</span>
            </button>
          </div>
        </div>

        {section === 'goals' ? (
          goals.length === 0 ? (
            <div className="flex items-center justify-center py-6 text-[var(--relay-text-faint)]">
              <NavGoalsIcon className="h-6 w-6 opacity-35" />
            </div>
          ) : (
            <div className="mt-4 divide-y divide-black/[0.06] dark:divide-white/10">
              <AnimatePresence mode="popLayout">
                {goals.map((goal) => {
                  const total = goal.milestones.length;
                  const doneCount = goal.milestones.filter((m) => m.done).length;
                  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;
                  const isPriority = priorityGoalIds.includes(goal.id);
                  const isDragging = draggingId === goal.id;

                  return (
                    <motion.article
                      key={goal.id}
                      data-drag-tile-id={goal.id}
                      layout
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: isDragging ? 0.85 : 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      onClick={() => setSelectedGoalId(goal.id)}
                      className={`group flex cursor-pointer items-center gap-3 py-3.5 first:pt-1 last:pb-0 ${
                        isDragging ? 'rounded-2xl bg-zinc-50 px-2 dark:bg-zinc-800/60' : ''
                      }`}
                    >
                      <MiniRing value={pct} size={42} strokeWidth={3.5} />

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          {isPriority && (
                            <Star
                              weight="fill"
                              className="h-3.5 w-3.5 shrink-0 text-amber-400"
                            />
                          )}
                          <h2 className="truncate text-[14px] font-semibold text-[var(--relay-text)]">
                            {goal.title}
                          </h2>
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[var(--relay-text-muted)]">
                          {total > 0 && (
                            <span className="font-mono-tabular">
                              {doneCount}/{total}
                            </span>
                          )}
                          {goal.notes && (
                            <span className="truncate">{goal.notes}</span>
                          )}
                        </div>
                      </div>

                      <div
                        className="flex items-center gap-0.5 shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={() => onDelegateGoal(goal)}
                          aria-label="交给助理"
                          className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-[#2563EB] dark:hover:bg-zinc-800 dark:hover:text-blue-400"
                        >
                          <ArrowUpRight weight="bold" className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onPointerDown={(e) => startDrag(goal.id, e)}
                          aria-label="拖动排序"
                          className="touch-none flex h-8 w-8 cursor-grab items-center justify-center rounded-full text-zinc-300 transition-colors hover:bg-zinc-100 hover:text-zinc-600 active:cursor-grabbing dark:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                        >
                          <GripVertical className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </motion.article>
                  );
                })}
              </AnimatePresence>
            </div>
          )
        ) : (
          <div className="mt-4 space-y-3">
            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
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
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                    remFilter === k
                      ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950'
                      : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200/70 dark:bg-zinc-800 dark:text-zinc-400'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {filteredReminders.length === 0 ? (
              <div className="flex items-center justify-center py-5 text-[var(--relay-text-faint)]">
                <FeedReminderIcon className="h-5 w-5 opacity-35" />
              </div>
            ) : (
              <div className="divide-y divide-black/[0.06] dark:divide-white/10">
                {filteredReminders.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-3 py-3 first:pt-1 last:pb-0"
                  >
                    <button
                      type="button"
                      onClick={() => onToggleReminder(item.id)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      <span
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors ${
                          item.completed
                            ? 'border-emerald-500 bg-emerald-500 text-white'
                            : 'border-zinc-300 bg-white dark:border-zinc-600 dark:bg-zinc-900'
                        }`}
                      >
                        {item.completed && <Check className="h-3 w-3" />}
                      </span>
                      <div className="min-w-0">
                        <div
                          className={`truncate text-sm font-medium ${
                            item.completed
                              ? 'text-[var(--relay-text-faint)] line-through'
                              : 'text-[var(--relay-text)]'
                          }`}
                        >
                          {item.title}
                        </div>
                        <div className="font-mono-tabular text-[11px] text-[var(--relay-text-faint)]">
                          {item.dueLabel}
                        </div>
                      </div>
                    </button>

                    <div className="flex items-center gap-1 shrink-0">
                      {!item.completed && (
                        <>
                          <button
                            type="button"
                            onClick={() => void handleTestNotify(item)}
                            aria-label="推送"
                            className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800"
                          >
                            <FeedReminderIcon className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onSnoozeReminder(item.id)}
                            aria-label="延后30分钟"
                            className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                          >
                            <Clock weight="duotone" className="h-4 w-4" />
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => onDeleteReminder(item.id)}
                        aria-label="删除"
                        className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-100 hover:text-rose-600 dark:hover:bg-zinc-800"
                      >
                        <Trash weight="duotone" className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Card 2: '+ Create a goal' Clean Action Card */}
      <button
        type="button"
        onClick={() => {
          if (section === 'goals') {
            openGoalSheetWithCategory();
          } else {
            setShowAddSheet(true);
          }
        }}
        className="muse-card flex w-full items-center justify-between rounded-[24px] px-5 py-4 text-left transition-transform active:scale-[0.99]"
      >
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100">
            <Plus weight="bold" className="h-4 w-4" />
          </span>
          <span className="text-[15px] font-semibold text-[var(--relay-text)]">
            {section === 'goals' ? 'Create a goal' : '新提醒'}
          </span>
        </div>
        <Plus weight="bold" className="h-4 w-4 text-zinc-400" />
      </button>

      {/* Card 3: Colored Duotone Category Quick-Start List */}
      <section className="muse-card overflow-hidden rounded-[26px] divide-y divide-black/[0.06] dark:divide-white/10">
        {GOAL_CATEGORIES.map((cat) => {
          const Icon = cat.Icon;
          return (
            <button
              key={cat.key}
              type="button"
              onClick={() => openGoalSheetWithCategory(cat)}
              className="flex min-h-[56px] w-full items-center justify-between gap-3 px-4.5 py-3 text-left transition-colors hover:bg-zinc-50/90 active:bg-zinc-100/80 dark:hover:bg-zinc-800/50"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${cat.bgTint}`}
                >
                  <Icon className="h-[18px] w-[18px]" />
                </span>
                <span className="text-[15px] font-medium text-[var(--relay-text)]">
                  {cat.label}
                </span>
              </div>
              <Plus weight="bold" className="h-4 w-4 shrink-0 text-zinc-400" />
            </button>
          );
        })}
      </section>

      {/* ADD GOAL OR REMINDER SHEET */}
      <AnimatePresence>
        {showAddSheet && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowAddSheet(false)}
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/35 p-3 backdrop-blur-xs sm:items-center"
          >
            {section === 'goals' ? (
              <motion.form
                initial={{ y: 24, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 20, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
                onSubmit={handleCreateGoal}
                className="mac-card w-full max-w-md rounded-[28px] p-5 text-[var(--relay-text)] space-y-3.5"
              >
                <div className="flex items-center justify-between border-b border-black/[0.06] pb-3 dark:border-white/10">
                  <span className="text-sm font-semibold">Create a goal</span>
                  <button
                    type="button"
                    onClick={() => setShowAddSheet(false)}
                    aria-label="关闭"
                    className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--relay-text-muted)] hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <input
                  type="text"
                  autoFocus
                  value={goalTitle}
                  onChange={(e) => setGoalTitle(e.target.value)}
                  placeholder={activeCategoryPlaceholder}
                  className="min-h-[44px] w-full rounded-2xl border border-black/[0.09] bg-zinc-50 px-3.5 text-sm text-[var(--relay-text)] placeholder:text-[var(--relay-text-faint)] focus:border-[#1B6EF3] focus:bg-white focus:outline-none dark:border-white/12 dark:bg-zinc-900 dark:focus:bg-zinc-900"
                />

                <button
                  type="button"
                  onClick={() => setGoalImportantDraft((v) => !v)}
                  className={`flex min-h-[42px] w-full items-center justify-between rounded-2xl border px-3.5 text-xs font-medium transition-colors ${
                    goalImportantDraft
                      ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-200'
                      : 'border-black/[0.08] bg-zinc-50 text-[var(--relay-text-muted)] dark:border-white/10 dark:bg-zinc-900'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Star
                      weight={goalImportantDraft ? 'fill' : 'duotone'}
                      className={`h-4 w-4 ${goalImportantDraft ? 'text-amber-500' : ''}`}
                    />
                    <span>重点</span>
                  </span>
                  <span className="text-[11px]">{goalImportantDraft ? 'ON' : 'OFF'}</span>
                </button>

                <input
                  type="text"
                  value={goalNotes}
                  onChange={(e) => setGoalNotes(e.target.value)}
                  placeholder="备注"
                  className="min-h-[42px] w-full rounded-2xl border border-black/[0.09] bg-zinc-50 px-3.5 text-xs text-[var(--relay-text)] placeholder:text-[var(--relay-text-faint)] focus:border-[#1B6EF3] focus:bg-white focus:outline-none dark:border-white/12 dark:bg-zinc-900"
                />

                <textarea
                  rows={3}
                  value={goalStepsRaw}
                  onChange={(e) => setGoalStepsRaw(e.target.value)}
                  placeholder="里程碑（每行一条）"
                  className="w-full rounded-2xl border border-black/[0.09] bg-zinc-50 px-3.5 py-2.5 text-xs text-[var(--relay-text)] placeholder:text-[var(--relay-text-faint)] focus:border-[#1B6EF3] focus:bg-white focus:outline-none dark:border-white/12 dark:bg-zinc-900"
                />

                <button
                  type="submit"
                  disabled={!goalTitle.trim()}
                  className="flex h-11 w-full items-center justify-center rounded-full bg-zinc-950 text-xs font-semibold text-white transition-colors hover:bg-[#1B6EF3] disabled:opacity-40 dark:bg-[#1B6EF3]"
                >
                  保存
                </button>
              </motion.form>
            ) : (
              <motion.form
                initial={{ y: 24, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 20, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
                onSubmit={handleCreateReminder}
                className="mac-card w-full max-w-md rounded-[28px] p-5 text-[var(--relay-text)] space-y-3.5"
              >
                <div className="flex items-center justify-between border-b border-black/[0.06] pb-3 dark:border-white/10">
                  <span className="text-sm font-semibold">新提醒</span>
                  <button
                    type="button"
                    onClick={() => setShowAddSheet(false)}
                    aria-label="关闭"
                    className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--relay-text-muted)] hover:bg-zinc-100 dark:hover:bg-zinc-800"
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
                  className="min-h-[44px] w-full rounded-2xl border border-black/[0.09] bg-zinc-50 px-3.5 text-sm text-[var(--relay-text)] placeholder:text-[var(--relay-text-faint)] focus:border-[#1B6EF3] focus:bg-white focus:outline-none dark:border-white/12 dark:bg-zinc-900"
                />

                <div className="grid grid-cols-3 gap-2">
                  <select
                    value={remDay}
                    onChange={(e) => setRemDay(e.target.value as 'today' | 'tomorrow' | 'week')}
                    aria-label="日期"
                    className="min-h-[40px] rounded-xl border border-black/[0.09] bg-zinc-50 px-2.5 text-xs text-[var(--relay-text)] dark:border-white/12 dark:bg-zinc-900"
                  >
                    <option value="today">今天</option>
                    <option value="tomorrow">明天</option>
                    <option value="week">本周</option>
                  </select>
                  <input
                    type="time"
                    value={remTime}
                    onChange={(e) => setRemTime(e.target.value)}
                    aria-label="时间"
                    className="min-h-[40px] rounded-xl border border-black/[0.09] bg-zinc-50 px-2.5 font-mono-tabular text-xs text-[var(--relay-text)] dark:border-white/12 dark:bg-zinc-900"
                  />
                  <select
                    value={remChannel}
                    onChange={(e) => setRemChannel(e.target.value as 'ntfy' | 'browser' | 'app')}
                    aria-label="渠道"
                    className="min-h-[40px] rounded-xl border border-black/[0.09] bg-zinc-50 px-2.5 text-xs text-[var(--relay-text)] dark:border-white/12 dark:bg-zinc-900"
                  >
                    <option value="ntfy">ntfy</option>
                    <option value="browser">通知</option>
                    <option value="app">应用内</option>
                  </select>
                </div>

                <button
                  type="submit"
                  disabled={!remTitle.trim()}
                  className="flex h-11 w-full items-center justify-center rounded-full bg-zinc-950 text-xs font-semibold text-white transition-colors hover:bg-[#1B6EF3] disabled:opacity-40 dark:bg-[#1B6EF3]"
                >
                  保存
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
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/35 p-3 backdrop-blur-xs sm:items-center"
          >
            <motion.div
              initial={{ y: 24, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 20, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="mac-card w-full max-w-md rounded-[28px] p-5 text-[var(--relay-text)] space-y-4"
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
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--relay-text-muted)] hover:bg-zinc-100 dark:hover:bg-zinc-800"
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
                      className="flex min-h-[42px] w-full items-center gap-2.5 rounded-2xl border border-black/[0.07] bg-zinc-50 px-3 py-2 text-left text-xs transition-colors hover:bg-zinc-100 dark:border-white/10 dark:bg-zinc-900"
                    >
                      <span
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                          m.done
                            ? 'border-emerald-500 bg-emerald-500 text-white'
                            : 'border-zinc-300 bg-white dark:border-zinc-600 dark:bg-zinc-800'
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

              <div className="flex items-center gap-2 border-t border-black/[0.06] pt-3 dark:border-white/10">
                <button
                  type="button"
                  onClick={() => {
                    onDeleteGoal(selectedGoal.id);
                    setSelectedGoalId(null);
                  }}
                  aria-label="删除"
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-black/[0.08] text-[var(--relay-text-muted)] hover:bg-rose-50 hover:text-rose-600 dark:border-white/10 dark:hover:bg-rose-500/15"
                >
                  <Trash weight="duotone" className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => toggleGoalPriority(selectedGoal.id)}
                  aria-label="重点"
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-black/[0.08] text-[var(--relay-text)] hover:bg-zinc-50 dark:border-white/10 dark:hover:bg-zinc-800"
                >
                  <Star
                    weight={priorityGoalIds.includes(selectedGoal.id) ? 'fill' : 'duotone'}
                    className={`h-4 w-4 ${
                      priorityGoalIds.includes(selectedGoal.id) ? 'text-amber-500' : ''
                    }`}
                  />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onDelegateGoal(selectedGoal);
                    setSelectedGoalId(null);
                  }}
                  className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-full bg-zinc-950 px-4 text-xs font-semibold text-white hover:bg-[#1B6EF3] dark:bg-[#1B6EF3]"
                >
                  <span>助理</span>
                  <ArrowUpRight weight="bold" className="h-3.5 w-3.5" />
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
