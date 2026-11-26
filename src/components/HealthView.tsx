import React, { useState } from 'react';
import { motion } from 'motion/react';
import {
  Activity,
  ArrowUpRight,
  BellPlus,
  Droplets,
  Footprints,
  Minus,
  Moon,
  Plus,
  SlidersHorizontal,
} from 'lucide-react';
import type { HealthConfig, HealthDailyLog } from '../types/relay';

interface HealthViewProps {
  healthConfig: HealthConfig;
  todayLog: HealthDailyLog;
  onUpdateConfig: (next: HealthConfig) => void;
  onUpdateTodayLog: (next: HealthDailyLog) => void;
  onScheduleBedtimeReminder: () => void;
  onAskAgentHealthCheck: () => void;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export const HealthView: React.FC<HealthViewProps> = ({
  healthConfig,
  todayLog,
  onUpdateConfig,
  onUpdateTodayLog,
  onScheduleBedtimeReminder,
  onAskAgentHealthCheck,
}) => {
  const [editingGoals, setEditingGoals] = useState(false);

  const sleepPct = clamp(
    Math.round((todayLog.sleepHours / Math.max(1, healthConfig.sleepGoalHours)) * 100),
    0,
    100
  );
  const stepsPct = clamp(
    Math.round((todayLog.steps / Math.max(1, healthConfig.stepsGoal)) * 100),
    0,
    100
  );
  const waterPct = clamp(
    Math.round((todayLog.waterCups / Math.max(1, healthConfig.waterGoalCups)) * 100),
    0,
    100
  );
  const exercisePct = clamp(
    Math.round((todayLog.exerciseMinutes / Math.max(1, healthConfig.exerciseGoalMinutes)) * 100),
    0,
    100
  );

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 pb-28 sm:px-6 lg:py-10 lg:pb-14 space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            健康与作息
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            设定理想的睡眠时长、步数与饮水目标，让云端助理按时提醒并帮你复盘。
          </p>
        </div>

        <button
          type="button"
          onClick={() => setEditingGoals((v) => !v)}
          className="inline-flex min-h-[40px] shrink-0 items-center justify-center gap-1.5 rounded-2xl border border-stone-200/90 bg-white px-4 text-xs font-medium text-zinc-800 transition-colors hover:border-stone-300 dark:border-zinc-800 dark:bg-[#15171C] dark:text-zinc-200 whitespace-nowrap"
        >
          <SlidersHorizontal className="h-3.5 w-3.5 text-[#1B6EF3] dark:text-blue-400" />
          <span>{editingGoals ? '完成目标设定' : '设定每日目标'}</span>
        </button>
      </div>

      {/* Goal Configuration Panel */}
      {editingGoals && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mac-card rounded-3xl border border-stone-200/80 p-5 dark:border-zinc-800 space-y-4"
        >
          <div className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
            个人健康目标参数
          </div>

          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <label className="space-y-1.5 text-xs">
              <span className="text-zinc-600 dark:text-zinc-300">目标睡眠时长（小时）</span>
              <input
                type="number"
                step={0.5}
                min={4}
                max={12}
                value={healthConfig.sleepGoalHours}
                onChange={(e) =>
                  onUpdateConfig({
                    ...healthConfig,
                    sleepGoalHours: clamp(Number(e.target.value) || 7.5, 4, 12),
                  })
                }
                className="min-h-[40px] w-full rounded-xl border border-stone-200 bg-[#F8F7F4] px-3 font-mono-tabular text-sm text-zinc-900 focus:border-[#1B6EF3] focus:outline-none dark:border-zinc-700 dark:bg-[#0E0F12] dark:text-zinc-100"
              />
            </label>

            <label className="space-y-1.5 text-xs">
              <span className="text-zinc-600 dark:text-zinc-300">目标每日步数</span>
              <input
                type="number"
                step={500}
                min={1000}
                max={50000}
                value={healthConfig.stepsGoal}
                onChange={(e) =>
                  onUpdateConfig({
                    ...healthConfig,
                    stepsGoal: clamp(Number(e.target.value) || 8000, 1000, 50000),
                  })
                }
                className="min-h-[40px] w-full rounded-xl border border-stone-200 bg-[#F8F7F4] px-3 font-mono-tabular text-sm text-zinc-900 focus:border-[#1B6EF3] focus:outline-none dark:border-zinc-700 dark:bg-[#0E0F12] dark:text-zinc-100"
              />
            </label>

            <label className="space-y-1.5 text-xs">
              <span className="text-zinc-600 dark:text-zinc-300">理想入睡时间</span>
              <input
                type="time"
                value={healthConfig.bedtimeTarget}
                onChange={(e) =>
                  onUpdateConfig({ ...healthConfig, bedtimeTarget: e.target.value })
                }
                className="min-h-[40px] w-full rounded-xl border border-stone-200 bg-[#F8F7F4] px-3 font-mono-tabular text-sm text-zinc-900 focus:border-[#1B6EF3] focus:outline-none dark:border-zinc-700 dark:bg-[#0E0F12] dark:text-zinc-100"
              />
            </label>

            <label className="space-y-1.5 text-xs">
              <span className="text-zinc-600 dark:text-zinc-300">理想起床时间</span>
              <input
                type="time"
                value={healthConfig.wakeTarget}
                onChange={(e) => onUpdateConfig({ ...healthConfig, wakeTarget: e.target.value })}
                className="min-h-[40px] w-full rounded-xl border border-stone-200 bg-[#F8F7F4] px-3 font-mono-tabular text-sm text-zinc-900 focus:border-[#1B6EF3] focus:outline-none dark:border-zinc-700 dark:bg-[#0E0F12] dark:text-zinc-100"
              />
            </label>

            <label className="space-y-1.5 text-xs">
              <span className="text-zinc-600 dark:text-zinc-300">每日饮水目标（杯）</span>
              <input
                type="number"
                min={2}
                max={20}
                value={healthConfig.waterGoalCups}
                onChange={(e) =>
                  onUpdateConfig({
                    ...healthConfig,
                    waterGoalCups: clamp(Number(e.target.value) || 8, 2, 20),
                  })
                }
                className="min-h-[40px] w-full rounded-xl border border-stone-200 bg-[#F8F7F4] px-3 font-mono-tabular text-sm text-zinc-900 focus:border-[#1B6EF3] focus:outline-none dark:border-zinc-700 dark:bg-[#0E0F12] dark:text-zinc-100"
              />
            </label>

            <label className="space-y-1.5 text-xs">
              <span className="text-zinc-600 dark:text-zinc-300">每日运动目标（分钟）</span>
              <input
                type="number"
                step={5}
                min={10}
                max={240}
                value={healthConfig.exerciseGoalMinutes}
                onChange={(e) =>
                  onUpdateConfig({
                    ...healthConfig,
                    exerciseGoalMinutes: clamp(Number(e.target.value) || 30, 10, 240),
                  })
                }
                className="min-h-[40px] w-full rounded-xl border border-stone-200 bg-[#F8F7F4] px-3 font-mono-tabular text-sm text-zinc-900 focus:border-[#1B6EF3] focus:outline-none dark:border-zinc-700 dark:bg-[#0E0F12] dark:text-zinc-100"
              />
            </label>
          </div>
        </motion.div>
      )}

      {/* Primary Metric Cards Grid (macOS translucent cards) */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Sleep Card */}
        <motion.div
          whileHover={{ y: -2 }}
          className="mac-card rounded-3xl border border-stone-200/80 p-5 dark:border-zinc-800 space-y-4"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400">
                <Moon className="h-4 w-4" />
              </div>
              <div>
                <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">昨晚睡眠</div>
                <div className="font-mono-tabular text-[11px] text-zinc-400">
                  目标 {healthConfig.bedtimeTarget} – {healthConfig.wakeTarget}
                </div>
              </div>
            </div>
            <span className="font-mono-tabular text-xs font-semibold text-indigo-600 dark:text-indigo-400">
              {sleepPct}%
            </span>
          </div>

          <div className="flex items-baseline gap-1.5">
            <span className="font-mono-tabular text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
              {todayLog.sleepHours.toFixed(1)}
            </span>
            <span className="text-xs text-zinc-400">
              / {healthConfig.sleepGoalHours} 小时
            </span>
          </div>

          <div className="h-2 w-full overflow-hidden rounded-full bg-stone-200/70 dark:bg-zinc-800">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-blue-500"
              initial={false}
              animate={{ width: `${sleepPct}%` }}
              transition={{ type: 'spring', stiffness: 260, damping: 28 }}
            />
          </div>

          <div className="flex items-center justify-between gap-2 pt-1">
            <button
              type="button"
              onClick={() =>
                onUpdateTodayLog({
                  ...todayLog,
                  sleepHours: clamp(Number((todayLog.sleepHours - 0.5).toFixed(1)), 0, 16),
                })
              }
              aria-label="减少 0.5 小时"
              className="flex h-9 flex-1 items-center justify-center gap-1 rounded-xl border border-stone-200/80 bg-[#F8F7F4] text-xs font-medium text-zinc-700 active:scale-[0.97] dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
            >
              <Minus className="h-3.5 w-3.5" />
              <span>0.5h</span>
            </button>
            <button
              type="button"
              onClick={() =>
                onUpdateTodayLog({
                  ...todayLog,
                  sleepHours: clamp(Number((todayLog.sleepHours + 0.5).toFixed(1)), 0, 16),
                })
              }
              aria-label="增加 0.5 小时"
              className="flex h-9 flex-1 items-center justify-center gap-1 rounded-xl bg-zinc-950 text-xs font-medium text-white active:scale-[0.97] dark:bg-[#1B6EF3]"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>0.5h</span>
            </button>
          </div>
        </motion.div>

        {/* Steps Card */}
        <motion.div
          whileHover={{ y: -2 }}
          className="mac-card rounded-3xl border border-stone-200/80 p-5 dark:border-zinc-800 space-y-4"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400">
                <Footprints className="h-4 w-4" />
              </div>
              <div>
                <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">今日步数</div>
                <div className="font-mono-tabular text-[11px] text-zinc-400">
                  {todayLog.dateKey}
                </div>
              </div>
            </div>
            <span className="font-mono-tabular text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              {stepsPct}%
            </span>
          </div>

          <div className="flex items-baseline gap-1.5">
            <span className="font-mono-tabular text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
              {todayLog.steps.toLocaleString()}
            </span>
            <span className="text-xs text-zinc-400">
              / {healthConfig.stepsGoal.toLocaleString()} 步
            </span>
          </div>

          <div className="h-2 w-full overflow-hidden rounded-full bg-stone-200/70 dark:bg-zinc-800">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400"
              initial={false}
              animate={{ width: `${stepsPct}%` }}
              transition={{ type: 'spring', stiffness: 260, damping: 28 }}
            />
          </div>

          <div className="flex items-center justify-between gap-2 pt-1">
            <button
              type="button"
              onClick={() =>
                onUpdateTodayLog({
                  ...todayLog,
                  steps: clamp(todayLog.steps + 1000, 0, 100000),
                })
              }
              className="flex h-9 flex-1 items-center justify-center rounded-xl border border-stone-200/80 bg-[#F8F7F4] font-mono-tabular text-xs font-medium text-zinc-700 active:scale-[0.97] dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
            >
              +1,000
            </button>
            <button
              type="button"
              onClick={() =>
                onUpdateTodayLog({
                  ...todayLog,
                  steps: clamp(todayLog.steps + 2500, 0, 100000),
                })
              }
              className="flex h-9 flex-1 items-center justify-center rounded-xl bg-zinc-950 font-mono-tabular text-xs font-medium text-white active:scale-[0.97] dark:bg-[#1B6EF3]"
            >
              +2,500
            </button>
          </div>
        </motion.div>

        {/* Water Intake Card */}
        <motion.div
          whileHover={{ y: -2 }}
          className="mac-card rounded-3xl border border-stone-200/80 p-5 dark:border-zinc-800 space-y-3.5"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-sky-50 text-sky-600 dark:bg-sky-950/60 dark:text-sky-400">
                <Droplets className="h-4 w-4" />
              </div>
              <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">饮水打卡</span>
            </div>
            <span className="font-mono-tabular text-xs font-semibold text-zinc-900 dark:text-zinc-100">
              {todayLog.waterCups} / {healthConfig.waterGoalCups} 杯
            </span>
          </div>

          <div className="h-1.5 w-full overflow-hidden rounded-full bg-stone-200/70 dark:bg-zinc-800">
            <motion.div
              className="h-full rounded-full bg-sky-500"
              initial={false}
              animate={{ width: `${waterPct}%` }}
              transition={{ type: 'spring', stiffness: 260, damping: 28 }}
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                onUpdateTodayLog({
                  ...todayLog,
                  waterCups: clamp(todayLog.waterCups - 1, 0, 30),
                })
              }
              className="flex h-8 flex-1 items-center justify-center rounded-xl border border-stone-200/80 bg-[#F8F7F4] text-xs text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
            >
              -1 杯
            </button>
            <button
              type="button"
              onClick={() =>
                onUpdateTodayLog({
                  ...todayLog,
                  waterCups: clamp(todayLog.waterCups + 1, 0, 30),
                })
              }
              className="flex h-8 flex-1 items-center justify-center rounded-xl bg-sky-600 text-xs font-medium text-white active:scale-[0.97]"
            >
              +1 杯
            </button>
          </div>
        </motion.div>

        {/* Exercise Minutes Card */}
        <motion.div
          whileHover={{ y: -2 }}
          className="mac-card rounded-3xl border border-stone-200/80 p-5 dark:border-zinc-800 space-y-3.5"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400">
                <Activity className="h-4 w-4" />
              </div>
              <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">活动运动</span>
            </div>
            <span className="font-mono-tabular text-xs font-semibold text-zinc-900 dark:text-zinc-100">
              {todayLog.exerciseMinutes} / {healthConfig.exerciseGoalMinutes} 分钟
            </span>
          </div>

          <div className="h-1.5 w-full overflow-hidden rounded-full bg-stone-200/70 dark:bg-zinc-800">
            <motion.div
              className="h-full rounded-full bg-amber-500"
              initial={false}
              animate={{ width: `${exercisePct}%` }}
              transition={{ type: 'spring', stiffness: 260, damping: 28 }}
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                onUpdateTodayLog({
                  ...todayLog,
                  exerciseMinutes: clamp(todayLog.exerciseMinutes + 15, 0, 300),
                })
              }
              className="flex h-8 flex-1 items-center justify-center rounded-xl border border-stone-200/80 bg-[#F8F7F4] text-xs font-medium text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
            >
              +15 分钟
            </button>
            <button
              type="button"
              onClick={() =>
                onUpdateTodayLog({
                  ...todayLog,
                  exerciseMinutes: clamp(todayLog.exerciseMinutes + 30, 0, 300),
                })
              }
              className="flex h-8 flex-1 items-center justify-center rounded-xl bg-amber-500 text-xs font-medium text-white active:scale-[0.97]"
            >
              +30 分钟
            </button>
          </div>
        </motion.div>
      </div>

      {/* Agent Proactive Reminder & Review Dock */}
      <motion.div
        whileHover={{ y: -2 }}
        className="mac-card rounded-3xl border border-stone-200/80 p-5 dark:border-zinc-800 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
            让助理按时提醒与监督
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
            一键生成 {healthConfig.bedtimeTarget} 就寝提醒，或将今日睡眠与步数同步给云端 Agent 帮你规划提醒。
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onScheduleBedtimeReminder}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-2xl border border-stone-200/90 bg-white px-3.5 py-2 text-xs font-medium text-zinc-800 transition-transform active:scale-[0.97] hover:border-[#1B6EF3]/50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 whitespace-nowrap"
          >
            <BellPlus className="h-3.5 w-3.5 text-[#1B6EF3] dark:text-blue-400" />
            <span>生成就寝提醒</span>
          </button>

          <button
            type="button"
            onClick={onAskAgentHealthCheck}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-2xl bg-zinc-950 px-4 py-2 text-xs font-medium text-white transition-transform active:scale-[0.97] hover:bg-zinc-800 dark:bg-[#1B6EF3] dark:hover:bg-blue-600 whitespace-nowrap"
          >
            <span>交给助理安排提醒</span>
            <ArrowUpRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </motion.div>
    </div>
  );
};
