import React, { useMemo, useState } from 'react';
import { Bell, Check, Clock, Plus, Trash2 } from 'lucide-react';
import type { ConnectionConfig, ReminderItem } from '../types/relay';
import { sendNtfyNotification } from '../services/agentClient';

interface RemindersViewProps {
  reminders: ReminderItem[];
  config: ConnectionConfig;
  onAddReminder: (item: Omit<ReminderItem, 'id' | 'completed'>) => void;
  onToggleReminder: (id: string) => void;
  onSnoozeReminder: (id: string) => void;
  onDeleteReminder: (id: string) => void;
  onShowToast: (message: string) => void;
}

type GroupFilter = 'today' | 'tomorrow' | 'week' | 'completed';

export const RemindersView: React.FC<RemindersViewProps> = ({
  reminders,
  config,
  onAddReminder,
  onToggleReminder,
  onSnoozeReminder,
  onDeleteReminder,
  onShowToast,
}) => {
  const [group, setGroup] = useState<GroupFilter>('today');
  const [title, setTitle] = useState('');
  const [timeInput, setTimeInput] = useState('20:00');
  const [dayGroup, setDayGroup] = useState<'today' | 'tomorrow' | 'week'>('today');
  const [channel, setChannel] = useState<'ntfy' | 'browser' | 'app'>('ntfy');
  const [priority, setPriority] = useState<'normal' | 'high'>('normal');

  const filtered = useMemo(() => {
    if (group === 'completed') {
      return reminders.filter((r) => r.completed);
    }
    return reminders.filter((r) => !r.completed && r.dayGroup === group);
  }, [reminders, group]);

  const counts = useMemo(
    () => ({
      today: reminders.filter((r) => !r.completed && r.dayGroup === 'today').length,
      tomorrow: reminders.filter((r) => !r.completed && r.dayGroup === 'tomorrow').length,
      week: reminders.filter((r) => !r.completed && r.dayGroup === 'week').length,
      completed: reminders.filter((r) => r.completed).length,
    }),
    [reminders]
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = title.trim();
    if (!cleaned) return;
    const prefix = dayGroup === 'today' ? '今天' : dayGroup === 'tomorrow' ? '明天' : '本周';
    onAddReminder({
      title: cleaned,
      dueLabel: `${prefix} ${timeInput}`,
      dayGroup,
      priority,
      channel,
    });
    setTitle('');
    setGroup(dayGroup);
    onShowToast('已添加新的日常提醒');
  };

  const handleTestNotification = async (item: ReminderItem) => {
    if (item.channel === 'ntfy') {
      const res = await sendNtfyNotification(config, 'Relay 日常提醒', `${item.title} (${item.dueLabel})`);
      onShowToast(res.detail);
      return;
    }

    if (typeof Notification !== 'undefined') {
      if (Notification.permission === 'granted') {
        new Notification('Relay 日常提醒', { body: `${item.title} · ${item.dueLabel}` });
        onShowToast('已发送浏览器系统通知');
      } else if (Notification.permission !== 'denied') {
        const perm = await Notification.requestPermission();
        if (perm === 'granted') {
          new Notification('Relay 日常提醒', { body: `${item.title} · ${item.dueLabel}` });
          onShowToast('通知权限已开启并发送提醒');
        } else {
          onShowToast('浏览器未授予通知权限，可改用 ntfy 推送');
        }
      } else {
        onShowToast('浏览器通知已被禁用，建议在连接设置中配置 ntfy 推送');
      }
    } else {
      onShowToast(`应用内提醒触发：${item.title}`);
    }
  };

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-5 pb-28 sm:px-6 lg:py-8 lg:pb-12 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          日程与主动提醒
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          配合云端定时任务与 ntfy over Tailscale，让重要事务按时直达 Android 通知栏。
        </p>
      </div>

      {/* Quick Add Reminder Form */}
      <form
        onSubmit={handleSubmit}
        className="rounded-2xl border border-slate-200/90 bg-white p-4 sm:p-5 dark:border-slate-800 dark:bg-[#131822]"
      >
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="输入要提醒的事项，例如：整理今天下载的论文 PDF..."
            className="min-h-[44px] flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-[#0B0E14] dark:text-slate-100 dark:focus:border-blue-500"
          />
          <button
            type="submit"
            disabled={!title.trim()}
            className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <Plus className="h-4 w-4" />
            <span>添加提醒</span>
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2.5 text-xs">
          <select
            value={dayGroup}
            onChange={(e) => setDayGroup(e.target.value as 'today' | 'tomorrow' | 'week')}
            aria-label="日期分组"
            className="min-h-[38px] rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            <option value="today">今天</option>
            <option value="tomorrow">明天</option>
            <option value="week">本周</option>
          </select>

          <input
            type="time"
            value={timeInput}
            onChange={(e) => setTimeInput(e.target.value)}
            aria-label="提醒时间"
            className="min-h-[38px] rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono-tabular text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          />

          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value as 'ntfy' | 'browser' | 'app')}
            aria-label="推送通道"
            className="min-h-[38px] rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            <option value="ntfy">ntfy 手机推送</option>
            <option value="browser">浏览器通知</option>
            <option value="app">仅应用内</option>
          </select>

          <button
            type="button"
            onClick={() => setPriority((p) => (p === 'high' ? 'normal' : 'high'))}
            className={`min-h-[38px] rounded-lg border px-3 py-1.5 font-medium transition-colors whitespace-nowrap ${
              priority === 'high'
                ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700/80 dark:bg-amber-950/40 dark:text-amber-300'
                : 'border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
            }`}
          >
            {priority === 'high' ? '高优先级' : '普通优先级'}
          </button>
        </div>
      </form>

      {/* Date Segmented Tabs */}
      <div className="flex items-center gap-1 overflow-x-auto rounded-xl bg-slate-200/60 p-1 dark:bg-slate-800/70 sm:inline-flex">
        {(
          [
            ['today', `今天 (${counts.today})`],
            ['tomorrow', `明天 (${counts.tomorrow})`],
            ['week', `本周 (${counts.week})`],
            ['completed', `已完成 (${counts.completed})`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setGroup(key)}
            className={`min-h-[38px] flex-1 rounded-lg px-3.5 py-1.5 font-mono-tabular text-xs font-medium transition-colors whitespace-nowrap shrink-0 sm:flex-none ${
              group === key
                ? 'bg-white text-slate-900 shadow-xs dark:bg-[#131822] dark:text-slate-100'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Reminders List */}
      <div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white dark:border-slate-800 dark:bg-[#131822]">
        {filtered.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-slate-500 dark:text-slate-400">
            该时段暂无待办提醒。
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
            {filtered.map((item) => (
              <div
                key={item.id}
                className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex items-start gap-3 min-w-0">
                  <button
                    type="button"
                    onClick={() => onToggleReminder(item.id)}
                    aria-label={item.completed ? '取消完成' : '标记完成'}
                    className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border transition-colors ${
                      item.completed
                        ? 'border-emerald-600 bg-emerald-600 text-white'
                        : 'border-slate-300 bg-white hover:border-blue-500 dark:border-slate-600 dark:bg-slate-900'
                    }`}
                  >
                    {item.completed && <Check className="h-3.5 w-3.5" />}
                  </button>
                  <div className="min-w-0">
                    <div
                      className={`text-sm font-medium leading-snug ${
                        item.completed
                          ? 'text-slate-400 line-through dark:text-slate-500'
                          : 'text-slate-900 dark:text-slate-100'
                      }`}
                    >
                      {item.title}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-slate-500 dark:text-slate-400">
                      <span className="font-mono-tabular">{item.dueLabel}</span>
                      {item.priority === 'high' && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-medium text-amber-700 dark:text-amber-400">高优先级</span>
                        </>
                      )}
                      {item.repeat && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{item.repeat}</span>
                        </>
                      )}
                      <span aria-hidden="true">·</span>
                      <span>
                        {item.channel === 'ntfy'
                          ? 'ntfy 推送'
                          : item.channel === 'browser'
                            ? '浏览器通知'
                            : '应用内'}
                      </span>
                    </div>
                    {item.note && (
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{item.note}</p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0 pl-9 sm:pl-0">
                  {!item.completed && (
                    <>
                      <button
                        type="button"
                        onClick={() => onSnoozeReminder(item.id)}
                        title="延后 30 分钟"
                        className="inline-flex min-h-[40px] items-center gap-1 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap"
                      >
                        <Clock className="h-3.5 w-3.5" />
                        <span>延后</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleTestNotification(item)}
                        title="立即测试推送"
                        className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                      >
                        <Bell className="h-4 w-4" />
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => onDeleteReminder(item.id)}
                    aria-label="删除提醒"
                    className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40 dark:hover:text-rose-400"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
