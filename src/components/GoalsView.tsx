import React, { useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Bell,
  Check,
  Clock,
  Plus,
  Target,
  Trash2,
} from 'lucide-react';
import type { ConnectionConfig, GoalItem, ReminderItem } from '../types/relay';
import { sendNtfyNotification } from '../services/agentClient';

interface GoalsViewProps {
  goals: GoalItem[];
  reminders: ReminderItem[];
  config: ConnectionConfig;
  onAddGoal: (title: string, notes: string, milestones: string[]) => void;
  onToggleMilestone: (goalId: string, milestoneId: string) => void;
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

export const GoalsView: React.FC<GoalsViewProps> = ({
  goals,
  reminders,
  config,
  onAddGoal,
  onToggleMilestone,
  onDeleteGoal,
  onDelegateGoal,
  onAddReminder,
  onToggleReminder,
  onSnoozeReminder,
  onDeleteReminder,
  onShowToast,
}) => {
  const [section, setSection] = useState<SectionKey>('goals');

  // Goal composer
  const [goalTitle, setGoalTitle] = useState('');
  const [goalNotes, setGoalNotes] = useState('');
  const [goalStepsRaw, setGoalStepsRaw] = useState('');
  const [showGoalForm, setShowGoalForm] = useState(false);

  // Reminder composer
  const [remFilter, setRemFilter] = useState<ReminderFilter>('today');
  const [remTitle, setRemTitle] = useState('');
  const [remTime, setRemTime] = useState('20:00');
  const [remDay, setRemDay] = useState<'today' | 'tomorrow' | 'week'>('today');
  const [remChannel, setRemChannel] = useState<'ntfy' | 'browser' | 'app'>('ntfy');

  const filteredReminders = useMemo(() => {
    if (remFilter === 'completed') return reminders.filter((r) => r.completed);
    return reminders.filter((r) => !r.completed && r.dayGroup === remFilter);
  }, [reminders, remFilter]);

  const handleCreateGoal = (e: React.FormEvent) => {
    e.preventDefault();
    const t = goalTitle.trim();
    if (!t) return;
    const steps = goalStepsRaw
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    onAddGoal(t, goalNotes.trim(), steps);
    setGoalTitle('');
    setGoalNotes('');
    setGoalStepsRaw('');
    setShowGoalForm(false);
    onShowToast('已添加新目标');
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
      priority: 'normal',
      channel: remChannel,
    });
    setRemTitle('');
    setRemFilter(remDay);
    onShowToast('已创建日程提醒');
  };

  const handleTestNotify = async (item: ReminderItem) => {
    if (item.channel === 'ntfy') {
      const res = await sendNtfyNotification(config, 'Relay 提醒', `${item.title} (${item.dueLabel})`);
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
    <div className="mx-auto w-full max-w-3xl px-4 py-6 pb-28 sm:px-6 lg:py-10 lg:pb-14 space-y-6">
      {/* Header & Clean Segmented Control */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            目标与日程
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            管理长期行动计划与主动提醒，随时一键委托给云端 Agent 推进。
          </p>
        </div>

        <div className="inline-flex rounded-2xl bg-stone-200/70 p-1 dark:bg-zinc-900">
          <button
            type="button"
            onClick={() => setSection('goals')}
            className={`min-h-[38px] rounded-xl px-4 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
              section === 'goals'
                ? 'bg-white text-zinc-950 shadow-xs dark:bg-[#1A1D24] dark:text-zinc-50'
                : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
            }`}
          >
            目标计划{goals.length > 0 ? ` · ${goals.length}` : ''}
          </button>
          <button
            type="button"
            onClick={() => setSection('reminders')}
            className={`min-h-[38px] rounded-xl px-4 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
              section === 'reminders'
                ? 'bg-white text-zinc-950 shadow-xs dark:bg-[#1A1D24] dark:text-zinc-50'
                : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
            }`}
          >
            日程提醒{reminders.filter((r) => !r.completed).length > 0 ? ` · ${reminders.filter((r) => !r.completed).length}` : ''}
          </button>
        </div>
      </div>

      {section === 'goals' ? (
        <div className="space-y-4">
          {!showGoalForm ? (
            <button
              type="button"
              onClick={() => setShowGoalForm(true)}
              className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-stone-300 bg-white/60 px-4 py-3 text-sm font-medium text-zinc-700 transition-colors hover:border-[#1B6EF3] hover:text-[#1B6EF3] dark:border-zinc-700 dark:bg-[#15171C]/60 dark:text-zinc-300 dark:hover:border-blue-500 dark:hover:text-blue-400"
            >
              <Plus className="h-4 w-4" />
              <span>新建长期目标或行动计划</span>
            </button>
          ) : (
            <form
              onSubmit={handleCreateGoal}
              className="rounded-3xl border border-stone-200/80 bg-white p-5 shadow-xs dark:border-zinc-800 dark:bg-[#15171C] space-y-3.5"
            >
              <input
                type="text"
                value={goalTitle}
                onChange={(e) => setGoalTitle(e.target.value)}
                placeholder="目标名称，例如：每周追踪 AI Agent 领域核心论文"
                className="min-h-[44px] w-full rounded-2xl border border-stone-200 bg-[#F8F7F4] px-3.5 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-[#1B6EF3] focus:bg-white focus:outline-none dark:border-zinc-700 dark:bg-[#0E0F12] dark:text-zinc-100"
              />
              <input
                type="text"
                value={goalNotes}
                onChange={(e) => setGoalNotes(e.target.value)}
                placeholder="补充背景或期望产出（可选）"
                className="min-h-[42px] w-full rounded-2xl border border-stone-200 bg-[#F8F7F4] px-3.5 py-2 text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-[#1B6EF3] focus:bg-white focus:outline-none dark:border-zinc-700 dark:bg-[#0E0F12] dark:text-zinc-100"
              />
              <textarea
                rows={3}
                value={goalStepsRaw}
                onChange={(e) => setGoalStepsRaw(e.target.value)}
                placeholder="关键里程碑（每行一条，可选）"
                className="w-full rounded-2xl border border-stone-200 bg-[#F8F7F4] px-3.5 py-2.5 text-xs leading-relaxed text-zinc-900 placeholder:text-zinc-400 focus:border-[#1B6EF3] focus:bg-white focus:outline-none dark:border-zinc-700 dark:bg-[#0E0F12] dark:text-zinc-100"
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowGoalForm(false)}
                  className="min-h-[40px] rounded-xl px-4 text-xs font-medium text-zinc-500 hover:bg-stone-100 dark:hover:bg-zinc-800"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={!goalTitle.trim()}
                  className="min-h-[40px] rounded-xl bg-zinc-950 px-5 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-40 dark:bg-[#1B6EF3] dark:hover:bg-blue-600"
                >
                  保存目标
                </button>
              </div>
            </form>
          )}

          {goals.length === 0 ? (
            <div className="rounded-3xl border border-stone-200/80 bg-white px-6 py-16 text-center dark:border-zinc-800 dark:bg-[#15171C]">
              <Target className="mx-auto h-7 w-7 text-stone-300 dark:text-zinc-700" />
              <p className="mt-3 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                还没有正在推进的目标
              </p>
              <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
                记录你的长期事项或阶段计划，随时交给云端 Agent 拆解和跟进。
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {goals.map((goal) => {
                const total = goal.milestones.length;
                const doneCount = goal.milestones.filter((m) => m.done).length;
                const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;

                return (
                  <div
                    key={goal.id}
                    className="rounded-3xl border border-stone-200/80 bg-white p-5 transition-colors hover:border-stone-300 dark:border-zinc-800 dark:bg-[#15171C] dark:hover:border-zinc-700"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="text-base font-semibold text-zinc-950 dark:text-zinc-50">
                          {goal.title}
                        </h2>
                        {goal.notes && (
                          <p className="mt-1 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                            {goal.notes}
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => onDeleteGoal(goal.id)}
                        aria-label="删除目标"
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-zinc-400 hover:bg-stone-100 hover:text-rose-600 dark:hover:bg-zinc-800 dark:hover:text-rose-400"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>

                    {total > 0 && (
                      <div className="mt-4 space-y-2.5">
                        <div className="flex items-center justify-between text-[11px] text-zinc-500 dark:text-zinc-400">
                          <span>进度</span>
                          <span className="font-mono-tabular">
                            {doneCount}/{total} · {pct}%
                          </span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-stone-100 dark:bg-zinc-800">
                          <div
                            className="h-full rounded-full bg-[#1B6EF3] transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>

                        <div className="pt-1 space-y-1.5">
                          {goal.milestones.map((m) => (
                            <button
                              key={m.id}
                              type="button"
                              onClick={() => onToggleMilestone(goal.id, m.id)}
                              className="flex min-h-[36px] w-full items-center gap-2.5 rounded-xl px-2 py-1 text-left text-xs transition-colors hover:bg-stone-50 dark:hover:bg-zinc-900"
                            >
                              <span
                                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-md border ${
                                  m.done
                                    ? 'border-[#1B6EF3] bg-[#1B6EF3] text-white'
                                    : 'border-stone-300 dark:border-zinc-600'
                                }`}
                              >
                                {m.done && <Check className="h-3 w-3" />}
                              </span>
                              <span
                                className={
                                  m.done
                                    ? 'text-zinc-400 line-through'
                                    : 'text-zinc-700 dark:text-zinc-300'
                                }
                              >
                                {m.text}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="mt-4 flex items-center justify-between border-t border-stone-100 pt-3.5 dark:border-zinc-800/80">
                      <span className="font-mono-tabular text-[11px] text-zinc-400">
                        更新于 {goal.updatedAt}
                      </span>
                      <button
                        type="button"
                        onClick={() => onDelegateGoal(goal)}
                        className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-zinc-950 px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-[#1B6EF3] dark:hover:bg-blue-600"
                      >
                        <span>交给 Agent 推进</span>
                        <ArrowUpRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          {/* Clean Quick Add Reminder */}
          <form
            onSubmit={handleCreateReminder}
            className="rounded-3xl border border-stone-200/80 bg-white p-4 sm:p-5 dark:border-zinc-800 dark:bg-[#15171C] space-y-3"
          >
            <div className="flex flex-col gap-2.5 sm:flex-row">
              <input
                type="text"
                value={remTitle}
                onChange={(e) => setRemTitle(e.target.value)}
                placeholder="添加提醒事项，例如：今晚 9 点整理会议纪要..."
                className="min-h-[44px] flex-1 rounded-2xl border border-stone-200 bg-[#F8F7F4] px-3.5 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-[#1B6EF3] focus:bg-white focus:outline-none dark:border-zinc-700 dark:bg-[#0E0F12] dark:text-zinc-100"
              />
              <button
                type="submit"
                disabled={!remTitle.trim()}
                className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-2xl bg-zinc-950 px-5 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-40 dark:bg-[#1B6EF3] dark:hover:bg-blue-600 whitespace-nowrap"
              >
                <Plus className="h-4 w-4" />
                <span>添加</span>
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <select
                value={remDay}
                onChange={(e) => setRemDay(e.target.value as 'today' | 'tomorrow' | 'week')}
                aria-label="日期分组"
                className="min-h-[36px] rounded-xl border border-stone-200 bg-[#F8F7F4] px-2.5 text-zinc-700 dark:border-zinc-700 dark:bg-[#0E0F12] dark:text-zinc-300"
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
                className="min-h-[36px] rounded-xl border border-stone-200 bg-[#F8F7F4] px-2.5 font-mono-tabular text-zinc-700 dark:border-zinc-700 dark:bg-[#0E0F12] dark:text-zinc-300"
              />
              <select
                value={remChannel}
                onChange={(e) => setRemChannel(e.target.value as 'ntfy' | 'browser' | 'app')}
                aria-label="通知渠道"
                className="min-h-[36px] rounded-xl border border-stone-200 bg-[#F8F7F4] px-2.5 text-zinc-700 dark:border-zinc-700 dark:bg-[#0E0F12] dark:text-zinc-300"
              >
                <option value="ntfy">ntfy 推送</option>
                <option value="browser">浏览器通知</option>
                <option value="app">应用内</option>
              </select>
            </div>
          </form>

          {/* Filter Row */}
          <div className="flex items-center gap-1.5 overflow-x-auto">
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
                className={`min-h-[36px] rounded-xl px-3.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                  remFilter === k
                    ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                    : 'text-zinc-600 hover:bg-stone-200/70 dark:text-zinc-400 dark:hover:bg-zinc-800'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {filteredReminders.length === 0 ? (
            <div className="rounded-3xl border border-stone-200/80 bg-white px-6 py-14 text-center dark:border-zinc-800 dark:bg-[#15171C]">
              <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                当前分组暂无提醒
              </p>
              <p className="mt-1 text-xs text-zinc-400">
                在上方添加一条日程，或在对话中让 Agent 帮你安排提醒。
              </p>
            </div>
          ) : (
            <div className="divide-y divide-stone-100 rounded-3xl border border-stone-200/80 bg-white dark:divide-zinc-800/80 dark:border-zinc-800 dark:bg-[#15171C]">
              {filteredReminders.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-3 px-4 py-3.5 sm:px-5"
                >
                  <button
                    type="button"
                    onClick={() => onToggleReminder(item.id)}
                    className="flex min-w-0 flex-1 items-start gap-3 text-left"
                  >
                    <span
                      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                        item.completed
                          ? 'border-emerald-600 bg-emerald-600 text-white'
                          : 'border-stone-300 dark:border-zinc-600'
                      }`}
                    >
                      {item.completed && <Check className="h-3.5 w-3.5" />}
                    </span>
                    <div className="min-w-0">
                      <div
                        className={`text-sm font-medium ${
                          item.completed
                            ? 'text-zinc-400 line-through'
                            : 'text-zinc-900 dark:text-zinc-100'
                        }`}
                      >
                        {item.title}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 font-mono-tabular text-[11px] text-zinc-400">
                        <span>{item.dueLabel}</span>
                        <span aria-hidden="true">·</span>
                        <span>{item.channel}</span>
                      </div>
                    </div>
                  </button>

                  <div className="flex items-center gap-1 shrink-0">
                    {!item.completed && (
                      <>
                        <button
                          type="button"
                          onClick={() => void handleTestNotify(item)}
                          aria-label="发送推送测试"
                          className="flex h-9 w-9 items-center justify-center rounded-xl text-zinc-400 hover:bg-stone-100 hover:text-[#1B6EF3] dark:hover:bg-zinc-800 dark:hover:text-blue-400"
                        >
                          <Bell className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onSnoozeReminder(item.id)}
                          aria-label="延后 30 分钟"
                          className="flex h-9 w-9 items-center justify-center rounded-xl text-zinc-400 hover:bg-stone-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                        >
                          <Clock className="h-4 w-4" />
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => onDeleteReminder(item.id)}
                      aria-label="删除提醒"
                      className="flex h-9 w-9 items-center justify-center rounded-xl text-zinc-400 hover:bg-stone-100 hover:text-rose-600 dark:hover:bg-zinc-800 dark:hover:text-rose-400"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
