import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Activity,
  ArrowUpRight,
  BellPlus,
  Brain,
  Check,
  Coffee,
  Droplets,
  Footprints,
  GripVertical,
  Maximize2,
  Minus,
  Moon,
  Plus,
  SlidersHorizontal,
  Sun,
  Watch,
  X,
} from 'lucide-react';
import type { HealthConfig, HealthDailyLog } from '../types/relay';
import { useGridDragReorder } from '../hooks/useGridDragReorder';

interface HealthViewProps {
  healthConfig: HealthConfig;
  todayLog: HealthDailyLog;
  onUpdateConfig: (next: HealthConfig) => void;
  onUpdateTodayLog: (next: HealthDailyLog) => void;
  onScheduleBedtimeReminder: () => void;
  onAskAgentHealthCheck: () => void;
}

type TileId = 'sleep' | 'exercise' | 'water' | 'steps' | 'focus' | 'caffeine';
type TileSize = '1x1' | '2x1' | '2x2';

interface TileBoardItem {
  id: TileId;
  size: TileSize;
}

interface ExtraDailyLog {
  dateKey: string;
  focusMinutes: number;
  caffeineCups: number;
}

interface StepsHistoryMap {
  [dateKey: string]: number;
}

const TILES_STORAGE_KEY = 'relay_health_board_tiles_v2';
const EXTRA_LOG_STORAGE_KEY = 'relay_health_extra_log_v1';
const STEPS_HISTORY_KEY = 'relay_health_steps_hist_v1';

const DEFAULT_BOARD_TILES: TileBoardItem[] = [
  { id: 'sleep', size: '1x1' },
  { id: 'exercise', size: '1x1' },
  { id: 'water', size: '2x1' },
  { id: 'steps', size: '2x1' },
];

const ALL_TILE_CATALOG: {
  id: TileId;
  label: string;
  defaultSize: TileSize;
  accentVar: string;
  tintVar: string;
  Icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: 'sleep', label: '睡眠', defaultSize: '1x1', accentVar: 'var(--accent-indigo)', tintVar: 'var(--tint-blue)', Icon: Moon },
  { id: 'exercise', label: '运动', defaultSize: '1x1', accentVar: 'var(--accent-amber)', tintVar: 'var(--tint-red)', Icon: Watch },
  { id: 'water', label: '饮水', defaultSize: '2x1', accentVar: 'var(--accent-sky)', tintVar: 'var(--tint-cyan)', Icon: Droplets },
  { id: 'steps', label: '步数', defaultSize: '2x1', accentVar: 'var(--accent-mint)', tintVar: 'var(--tint-emerald)', Icon: Footprints },
  { id: 'focus', label: '专注', defaultSize: '1x1', accentVar: 'var(--accent-violet)', tintVar: 'var(--tint-violet)', Icon: Brain },
  { id: 'caffeine', label: '咖啡因', defaultSize: '1x1', accentVar: 'var(--accent-coral)', tintVar: 'var(--tint-amber)', Icon: Coffee },
];

const TILE_TINT_MAP: Record<TileId, string> = {
  sleep: 'var(--tint-blue)',
  exercise: 'var(--tint-red)',
  water: 'var(--tint-cyan)',
  steps: 'var(--tint-emerald)',
  focus: 'var(--tint-violet)',
  caffeine: 'var(--tint-amber)',
};

const TILE_ANGLE_MAP: Record<TileId, string> = {
  sleep: '162deg',
  exercise: '194deg',
  water: '176deg',
  steps: '168deg',
  focus: '188deg',
  caffeine: '158deg',
};

const SIZE_CYCLE: TileSize[] = ['1x1', '2x1', '2x2'];

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function parseTimeToHours(timeStr: string, fallback: number): number {
  const parts = timeStr.split(':');
  if (parts.length !== 2) return fallback;
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (Number.isNaN(h) || Number.isNaN(m)) return fallback;
  return h + m / 60;
}

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad),
  };
}

function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number): string {
  const normalizedSweep = ((endAngle - startAngle) % 360 + 360) % 360;
  const effectiveSweep = normalizedSweep === 0 ? 359.5 : normalizedSweep;
  const end = startAngle + effectiveSweep;
  const startPt = polarToCartesian(cx, cy, r, startAngle);
  const endPt = polarToCartesian(cx, cy, r, end);
  const largeArcFlag = effectiveSweep > 180 ? '1' : '0';
  return `M ${startPt.x.toFixed(2)} ${startPt.y.toFixed(2)} A ${r} ${r} 0 ${largeArcFlag} 1 ${endPt.x.toFixed(2)} ${endPt.y.toFixed(2)}`;
}

function getLast7DateKeys(todayKey: string): { key: string; shortLabel: string; isToday: boolean }[] {
  const base = new Date(`${todayKey}T12:00:00`);
  const weekLabels = ['日', '一', '二', '三', '四', '五', '六'];
  const result: { key: string; shortLabel: string; isToday: boolean }[] = [];
  for (let offset = 6; offset >= 0; offset--) {
    const d = new Date(base);
    d.setDate(base.getDate() - offset);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    result.push({
      key: `${yyyy}-${mm}-${dd}`,
      shortLabel: offset === 0 ? '今' : weekLabels[d.getDay()],
      isToday: offset === 0,
    });
  }
  return result;
}

function getExerciseLevel(minutes: number): 0 | 1 | 2 | 3 {
  if (minutes <= 0) return 0;
  if (minutes < 25) return 1;
  if (minutes < 50) return 2;
  return 3;
}

const EXERCISE_LEVEL_META: Record<0 | 1 | 2 | 3, { label: string; minutes: number }> = {
  0: { label: '未动', minutes: 0 },
  1: { label: '轻动', minutes: 15 },
  2: { label: '已动', minutes: 30 },
  3: { label: '痛快', minutes: 60 },
};

export const HealthView: React.FC<HealthViewProps> = ({
  healthConfig,
  todayLog,
  onUpdateConfig,
  onUpdateTodayLog,
  onScheduleBedtimeReminder,
  onAskAgentHealthCheck,
}) => {
  const [tiles, setTiles] = useState<TileBoardItem[]>(() => {
    try {
      const raw = localStorage.getItem(TILES_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as TileBoardItem[];
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // ignore
    }
    return DEFAULT_BOARD_TILES;
  });

  const [extraLog, setExtraLog] = useState<ExtraDailyLog>(() => {
    try {
      const raw = localStorage.getItem(EXTRA_LOG_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as ExtraDailyLog;
        if (parsed.dateKey === todayLog.dateKey) return parsed;
      }
    } catch {
      // ignore
    }
    return { dateKey: todayLog.dateKey, focusMinutes: 0, caffeineCups: 0 };
  });

  const [stepsHistory, setStepsHistory] = useState<StepsHistoryMap>(() => {
    try {
      const raw = localStorage.getItem(STEPS_HISTORY_KEY);
      if (raw) return JSON.parse(raw) as StepsHistoryMap;
    } catch {
      // ignore
    }
    return {};
  });

  const [managingBoard, setManagingBoard] = useState(false);
  const [showTilePicker, setShowTilePicker] = useState(false);
  const [showGoalSheet, setShowGoalSheet] = useState(false);

  const { draggingId, startDrag } = useGridDragReorder({
    items: tiles,
    getId: (t) => t.id,
    onReorder: setTiles,
  });

  useEffect(() => {
    try {
      localStorage.setItem(TILES_STORAGE_KEY, JSON.stringify(tiles));
    } catch {
      // ignore
    }
  }, [tiles]);

  useEffect(() => {
    try {
      localStorage.setItem(EXTRA_LOG_STORAGE_KEY, JSON.stringify(extraLog));
    } catch {
      // ignore
    }
  }, [extraLog]);

  useEffect(() => {
    setStepsHistory((prev) => {
      if (prev[todayLog.dateKey] === todayLog.steps) return prev;
      const next = { ...prev, [todayLog.dateKey]: todayLog.steps };
      try {
        localStorage.setItem(STEPS_HISTORY_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, [todayLog.dateKey, todayLog.steps]);

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
  const exerciseLevel = getExerciseLevel(todayLog.exerciseMinutes);
  const exercisePct = exerciseLevel === 0 ? 0 : exerciseLevel === 1 ? 50 : 100;
  const overallPct = Math.round((sleepPct + stepsPct + waterPct + exercisePct) / 4);

  // 24-hour Sleep Arc geometry
  const bedHours = parseTimeToHours(healthConfig.bedtimeTarget, 23.5);
  const wakeHours = parseTimeToHours(healthConfig.wakeTarget, 7);
  const plannedSleepHours =
    wakeHours >= bedHours ? wakeHours - bedHours : 24 - bedHours + wakeHours;
  const bedAngle = (bedHours / 24) * 360;
  const wakeAngle = (wakeHours / 24) * 360;
  const sleepArcPath = describeArc(56, 56, 42, bedAngle, wakeAngle);
  const bedPt = polarToCartesian(56, 56, 42, bedAngle);
  const wakePt = polarToCartesian(56, 56, 42, wakeAngle);

  const last7Days = useMemo(() => {
    const days = getLast7DateKeys(todayLog.dateKey);
    return days.map((d) => ({
      ...d,
      steps: d.isToday ? todayLog.steps : stepsHistory[d.key] ?? 0,
    }));
  }, [todayLog.dateKey, todayLog.steps, stepsHistory]);

  const maxChartSteps = Math.max(
    healthConfig.stepsGoal,
    ...last7Days.map((d) => d.steps),
    1000
  );

  const shortDateLabel = useMemo(() => {
    const d = new Date(`${todayLog.dateKey}T12:00:00`);
    const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    return `${todayLog.dateKey.slice(5).replace('-', '.')} · ${days[d.getDay()]}`;
  }, [todayLog.dateKey]);

  const togglePinTile = (id: TileId) => {
    setTiles((prev) => {
      if (prev.some((t) => t.id === id)) {
        if (prev.length <= 1) return prev;
        return prev.filter((t) => t.id !== id);
      }
      const catalog = ALL_TILE_CATALOG.find((c) => c.id === id);
      return [...prev, { id, size: catalog?.defaultSize ?? '1x1' }];
    });
  };

  const cycleTileSize = (id: TileId) => {
    setTiles((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        const idx = SIZE_CYCLE.indexOf(t.size);
        const nextSize = SIZE_CYCLE[(idx + 1) % SIZE_CYCLE.length];
        return { ...t, size: nextSize };
      })
    );
  };

  const renderTileControls = (item: TileBoardItem) => (
    <div className="flex items-center gap-1 shrink-0">
      {managingBoard && (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              cycleTileSize(item.id);
            }}
            aria-label="切换浮贴尺寸"
            title={`尺寸 ${item.size}`}
            className="flex h-7 items-center gap-0.5 rounded-lg border border-[var(--relay-tile-border)] bg-black/25 px-1.5 font-mono-tabular text-[10px] text-[var(--relay-text-muted)] hover:text-[var(--relay-text)]"
          >
            <Maximize2 className="h-3 w-3" />
            <span>{item.size}</span>
          </button>
          {tiles.length > 1 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                togglePinTile(item.id);
              }}
              aria-label="撕下浮贴"
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--relay-tile-border)] bg-black/25 text-[var(--accent-coral)]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </>
      )}
      <button
        type="button"
        onPointerDown={(e) => startDrag(item.id, e)}
        aria-label="拖动排序"
        title="按住拖动排序"
        className="touch-none flex h-7 w-7 cursor-grab items-center justify-center rounded-lg text-[var(--relay-text-faint)] transition-colors hover:bg-white/5 hover:text-[var(--relay-text)] active:cursor-grabbing"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
    </div>
  );

  const renderTileContent = (item: TileBoardItem) => {
    const isWide = item.size !== '1x1';

    switch (item.id) {
      case 'exercise': {
        // Lightweight watch-companion check-in (zero noisy minute telemetry)
        const active = exerciseLevel > 0;
        const currentMeta = EXERCISE_LEVEL_META[exerciseLevel];
        return (
          <div className="flex h-full flex-col justify-between gap-2.5">
            <div className="flex items-center justify-between gap-1">
              <div className="flex items-center gap-1.5">
                <Watch className="h-4 w-4 text-[var(--accent-amber)]" />
                <span className="text-xs font-medium text-[var(--relay-text-muted)]">运动</span>
              </div>
              {renderTileControls(item)}
            </div>

            {/* Single-tap visual check-in medallion */}
            <motion.button
              type="button"
              whileTap={{ scale: 0.92 }}
              onClick={() =>
                onUpdateTodayLog({
                  ...todayLog,
                  exerciseMinutes: active ? 0 : 30,
                })
              }
              aria-label={active ? '取消今日运动打卡' : '标记今日已运动'}
              className="relative mx-auto my-1 flex h-[78px] w-[78px] flex-col items-center justify-center rounded-full transition-colors"
              style={{
                backgroundColor: active
                  ? 'color-mix(in srgb, var(--accent-amber) 16%, transparent)'
                  : 'var(--relay-track)',
                boxShadow: active
                  ? 'inset 0 0 0 2px color-mix(in srgb, var(--accent-amber) 60%, transparent)'
                  : 'inset 0 0 0 1.5px var(--relay-tile-border)',
              }}
            >
              {active ? (
                <Check className="h-6 w-6 text-[var(--accent-amber)]" />
              ) : (
                <Activity className="h-6 w-6 text-[var(--relay-text-faint)]" />
              )}
              <span
                className="mt-0.5 text-[11px] font-semibold"
                style={{ color: active ? 'var(--accent-amber)' : 'var(--relay-text-muted)' }}
              >
                {currentMeta.label}
              </span>
            </motion.button>

            {/* Ultra-light 3-level subjective intensity dots (no numbers) */}
            <div className="grid grid-cols-3 gap-1">
              {([1, 2, 3] as const).map((lvl) => {
                const selected = exerciseLevel === lvl;
                return (
                  <button
                    key={lvl}
                    type="button"
                    onClick={() =>
                      onUpdateTodayLog({
                        ...todayLog,
                        exerciseMinutes: selected ? 0 : EXERCISE_LEVEL_META[lvl].minutes,
                      })
                    }
                    className={`flex h-7 items-center justify-center rounded-lg text-[11px] font-medium transition-colors ${
                      selected
                        ? 'bg-[var(--accent-amber)]/20 text-[var(--accent-amber)]'
                        : 'bg-black/15 text-[var(--relay-text-faint)] hover:text-[var(--relay-text-muted)]'
                    }`}
                  >
                    {lvl === 1 ? '轻' : lvl === 2 ? '中' : '强'}
                  </button>
                );
              })}
            </div>
          </div>
        );
      }

      case 'steps': {
        const goalY = 64 - (healthConfig.stepsGoal / maxChartSteps) * 52;
        return (
          <div className="flex h-full flex-col justify-between gap-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <Footprints className="h-4 w-4 text-[var(--accent-mint)]" />
                <span className="text-xs font-medium text-[var(--relay-text-muted)]">步数</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono-tabular text-sm font-semibold text-[var(--relay-text)]">
                  {todayLog.steps.toLocaleString()}
                </span>
                {renderTileControls(item)}
              </div>
            </div>

            {isWide ? (
              <div className="w-full">
                <svg viewBox="0 0 210 74" className="h-[74px] w-full overflow-visible">
                  <line
                    x1="2"
                    y1={goalY}
                    x2="208"
                    y2={goalY}
                    stroke="var(--relay-text-faint)"
                    strokeOpacity="0.35"
                    strokeDasharray="3 3"
                    strokeWidth="1"
                  />
                  {last7Days.map((day, idx) => {
                    const barW = 14;
                    const slot = 210 / 7;
                    const cx = slot * idx + slot / 2;
                    const rawH = (day.steps / maxChartSteps) * 50;
                    const barH = Math.max(day.steps > 0 ? 6 : 4, rawH);
                    const y = 60 - barH;
                    return (
                      <g key={day.key}>
                        <rect
                          x={cx - barW / 2}
                          y={10}
                          width={barW}
                          height={50}
                          rx={5}
                          fill="var(--relay-track)"
                        />
                        <motion.rect
                          x={cx - barW / 2}
                          width={barW}
                          rx={5}
                          initial={false}
                          animate={{ y, height: barH }}
                          transition={{ type: 'spring', stiffness: 280, damping: 26 }}
                          fill={day.isToday ? 'var(--accent-mint)' : 'var(--relay-text-faint)'}
                          fillOpacity={day.isToday ? 0.92 : day.steps > 0 ? 0.45 : 0.16}
                        />
                        <text
                          x={cx}
                          y={72}
                          textAnchor="middle"
                          fill={day.isToday ? 'var(--accent-mint)' : 'var(--relay-text-faint)'}
                          fontSize="9"
                          fontWeight={day.isToday ? '600' : '400'}
                        >
                          {day.shortLabel}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </div>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center">
                <span className="font-mono-tabular text-2xl font-semibold text-[var(--accent-mint)]">
                  {stepsPct}%
                </span>
                <span className="font-mono-tabular text-[10px] text-[var(--relay-text-faint)]">
                  /{(healthConfig.stepsGoal / 1000).toFixed(0)}k
                </span>
              </div>
            )}

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() =>
                  onUpdateTodayLog({
                    ...todayLog,
                    steps: clamp(todayLog.steps + 1000, 0, 100000),
                  })
                }
                className="flex h-8 flex-1 items-center justify-center rounded-xl border border-[var(--relay-tile-border)] bg-black/15 font-mono-tabular text-xs font-medium text-[var(--relay-text)] transition-transform active:scale-95"
              >
                +1k
              </button>
              <button
                type="button"
                onClick={() =>
                  onUpdateTodayLog({
                    ...todayLog,
                    steps: clamp(todayLog.steps + 2500, 0, 100000),
                  })
                }
                className="flex h-8 flex-1 items-center justify-center rounded-xl bg-[var(--accent-mint)]/18 font-mono-tabular text-xs font-semibold text-[var(--accent-mint)] transition-transform active:scale-95"
              >
                +2.5k
              </button>
            </div>
          </div>
        );
      }

      case 'sleep': {
        const r = 34;
        const c = 2 * Math.PI * r;
        const dashOffset = c - (sleepPct / 100) * c;
        return (
          <div className="flex h-full flex-col justify-between gap-2">
            <div className="flex items-center justify-between gap-1">
              <div className="flex items-center gap-1.5">
                <Moon className="h-4 w-4 text-[var(--accent-indigo)]" />
                <span className="text-xs font-medium text-[var(--relay-text-muted)]">睡眠</span>
              </div>
              {renderTileControls(item)}
            </div>

            <div className="relative mx-auto flex h-[82px] w-[82px] items-center justify-center">
              <svg viewBox="0 0 84 84" className="h-full w-full -rotate-90">
                <circle
                  cx="42"
                  cy="42"
                  r={r}
                  fill="none"
                  stroke="var(--relay-track)"
                  strokeWidth="6.5"
                />
                <motion.circle
                  cx="42"
                  cy="42"
                  r={r}
                  fill="none"
                  stroke="var(--accent-indigo)"
                  strokeWidth="6.5"
                  strokeLinecap="round"
                  strokeDasharray={c}
                  initial={false}
                  animate={{ strokeDashoffset: dashOffset }}
                  transition={{ type: 'spring', stiffness: 220, damping: 26 }}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="font-mono-tabular text-lg font-semibold leading-none text-[var(--relay-text)]">
                  {todayLog.sleepHours.toFixed(1)}
                </span>
                <span className="mt-0.5 font-mono-tabular text-[10px] text-[var(--relay-text-faint)]">
                  /{healthConfig.sleepGoalHours}h
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                aria-label="减少 0.5 小时"
                onClick={() =>
                  onUpdateTodayLog({
                    ...todayLog,
                    sleepHours: clamp(Number((todayLog.sleepHours - 0.5).toFixed(1)), 0, 16),
                  })
                }
                className="flex h-8 flex-1 items-center justify-center rounded-xl border border-[var(--relay-tile-border)] bg-black/15 text-[var(--relay-text-muted)] transition-transform active:scale-95 hover:text-[var(--relay-text)]"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                aria-label="增加 0.5 小时"
                onClick={() =>
                  onUpdateTodayLog({
                    ...todayLog,
                    sleepHours: clamp(Number((todayLog.sleepHours + 0.5).toFixed(1)), 0, 16),
                  })
                }
                className="flex h-8 flex-1 items-center justify-center rounded-xl bg-[var(--accent-indigo)]/18 text-[var(--accent-indigo)] transition-transform active:scale-95"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        );
      }

      case 'water': {
        const totalDrops = clamp(healthConfig.waterGoalCups, 4, 12);
        return (
          <div className="flex h-full flex-col justify-between gap-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <Droplets className="h-4 w-4 text-[var(--accent-sky)]" />
                <span className="text-xs font-medium text-[var(--relay-text-muted)]">饮水</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono-tabular text-xs font-semibold text-[var(--relay-text)]">
                  {todayLog.waterCups}
                  <span className="font-normal text-[var(--relay-text-faint)]">
                    /{healthConfig.waterGoalCups}
                  </span>
                </span>
                {renderTileControls(item)}
              </div>
            </div>

            <div className={`grid gap-1.5 py-1 ${isWide ? 'grid-cols-8' : 'grid-cols-4'}`}>
              {Array.from({ length: totalDrops }).map((_, idx) => {
                const cupIndex = idx + 1;
                const filled = cupIndex <= todayLog.waterCups;
                return (
                  <motion.button
                    key={cupIndex}
                    type="button"
                    whileTap={{ scale: 0.85 }}
                    aria-label={`饮水第 ${cupIndex} 杯`}
                    onClick={() => {
                      const nextCups =
                        todayLog.waterCups === cupIndex ? cupIndex - 1 : cupIndex;
                      onUpdateTodayLog({ ...todayLog, waterCups: clamp(nextCups, 0, 30) });
                    }}
                    className={`flex h-10 w-full items-center justify-center rounded-xl transition-colors ${
                      filled
                        ? 'bg-[var(--accent-sky)]/16 text-[var(--accent-sky)]'
                        : 'bg-[var(--relay-track)] text-[var(--relay-text-faint)]/60 hover:text-[var(--relay-text-muted)]'
                    }`}
                  >
                    <svg viewBox="0 0 24 24" className="h-4 w-4">
                      <path
                        d="M12 2.6C12 2.6 5.5 10.1 5.5 14.5C5.5 18.1 8.4 21 12 21C15.6 21 18.5 18.1 18.5 14.5C18.5 10.1 12 2.6 12 2.6Z"
                        fill={filled ? 'currentColor' : 'none'}
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </motion.button>
                );
              })}
            </div>
          </div>
        );
      }

      case 'focus': {
        const pct = clamp(Math.round((extraLog.focusMinutes / 90) * 100), 0, 100);
        return (
          <div className="flex h-full flex-col justify-between gap-2">
            <div className="flex items-center justify-between gap-1">
              <div className="flex items-center gap-1.5">
                <Brain className="h-4 w-4 text-[var(--accent-violet)]" />
                <span className="text-xs font-medium text-[var(--relay-text-muted)]">专注</span>
              </div>
              {renderTileControls(item)}
            </div>

            <div className="relative mx-auto flex h-[80px] w-[80px] items-center justify-center">
              <svg viewBox="0 0 84 84" className="h-full w-full">
                {[36, 28, 20].map((radius, idx) => {
                  const threshold = (2 - idx) * 33;
                  const lit = pct >= threshold && extraLog.focusMinutes > 0;
                  return (
                    <circle
                      key={radius}
                      cx="42"
                      cy="42"
                      r={radius}
                      fill="none"
                      stroke={lit ? 'var(--accent-violet)' : 'var(--relay-track)'}
                      strokeOpacity={lit ? 0.35 + idx * 0.25 : 1}
                      strokeWidth="2.5"
                    />
                  );
                })}
              </svg>
              <span className="absolute font-mono-tabular text-base font-semibold text-[var(--relay-text)]">
                {extraLog.focusMinutes}m
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() =>
                  setExtraLog((p) => ({
                    ...p,
                    focusMinutes: clamp(p.focusMinutes + 15, 0, 480),
                  }))
                }
                className="flex h-8 flex-1 items-center justify-center rounded-xl border border-[var(--relay-tile-border)] bg-black/15 font-mono-tabular text-xs text-[var(--relay-text)] active:scale-95"
              >
                +15m
              </button>
              <button
                type="button"
                onClick={() =>
                  setExtraLog((p) => ({
                    ...p,
                    focusMinutes: clamp(p.focusMinutes + 25, 0, 480),
                  }))
                }
                className="flex h-8 flex-1 items-center justify-center rounded-xl bg-[var(--accent-violet)]/18 font-mono-tabular text-xs font-semibold text-[var(--accent-violet)] active:scale-95"
              >
                +25m
              </button>
            </div>
          </div>
        );
      }

      case 'caffeine': {
        return (
          <div className="flex h-full flex-col justify-between gap-2">
            <div className="flex items-center justify-between gap-1">
              <div className="flex items-center gap-1.5">
                <Coffee className="h-4 w-4 text-[var(--accent-coral)]" />
                <span className="text-xs font-medium text-[var(--relay-text-muted)]">咖啡因</span>
              </div>
              {renderTileControls(item)}
            </div>

            <div className="grid grid-cols-3 gap-2 py-2">
              {[1, 2, 3].map((cup) => {
                const filled = cup <= extraLog.caffeineCups;
                return (
                  <motion.button
                    key={cup}
                    type="button"
                    whileTap={{ scale: 0.88 }}
                    aria-label={`咖啡第 ${cup} 杯`}
                    onClick={() =>
                      setExtraLog((p) => ({
                        ...p,
                        caffeineCups: p.caffeineCups === cup ? cup - 1 : cup,
                      }))
                    }
                    className={`flex h-11 items-center justify-center rounded-2xl transition-colors ${
                      filled
                        ? 'bg-[var(--accent-coral)]/18 text-[var(--accent-coral)]'
                        : 'bg-[var(--relay-track)] text-[var(--relay-text-faint)]/60'
                    }`}
                  >
                    <Coffee className="h-4 w-4" />
                  </motion.button>
                );
              })}
            </div>

            <div className="text-center font-mono-tabular text-[11px] text-[var(--relay-text-faint)]">
              {extraLog.caffeineCups}/3
            </div>
          </div>
        );
      }
    }
  };

  const summaryRings = [
    { key: 'sleep', r: 44, pct: sleepPct, color: 'var(--accent-indigo)', Icon: Moon },
    { key: 'steps', r: 36, pct: stepsPct, color: 'var(--accent-mint)', Icon: Footprints },
    { key: 'water', r: 28, pct: waterPct, color: 'var(--accent-sky)', Icon: Droplets },
    { key: 'exercise', r: 20, pct: exercisePct, color: 'var(--accent-amber)', Icon: Watch },
  ];

  const getSizeClasses = (size: TileSize): string => {
    if (size === '2x2') return 'col-span-2 row-span-2';
    if (size === '2x1') return 'col-span-2';
    return 'col-span-1';
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-5 pb-28 sm:px-6 lg:py-8 lg:pb-14 space-y-6">
      {/* FLUSH BOARD HEADER (Inherent chrome — sits directly on the dark board, NOT a tile) */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-2.5 min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-[var(--relay-text)]">健康</h1>
          <span className="font-mono-tabular text-xs text-[var(--relay-text-muted)]">
            {shortDateLabel}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setShowTilePicker(true)}
            aria-label="管理或贴上浮贴"
            title="浮贴管理"
            className={`flex h-10 items-center gap-1.5 rounded-xl border px-3 text-xs font-medium transition-colors ${
              managingBoard
                ? 'border-[var(--accent-indigo)]/60 bg-[var(--accent-indigo)]/15 text-[var(--accent-indigo)]'
                : 'border-[var(--relay-tile-border)] text-[var(--relay-text-muted)] hover:text-[var(--relay-text)]'
            }`}
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">浮贴</span>
          </button>

          <button
            type="button"
            onClick={() => setShowGoalSheet(true)}
            aria-label="设定目标"
            title="每日目标"
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--relay-tile-border)] text-[var(--relay-text-muted)] transition-colors hover:text-[var(--relay-text)]"
          >
            <SlidersHorizontal className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={onScheduleBedtimeReminder}
            aria-label="生成就寝提醒"
            title={`就寝提醒 ${healthConfig.bedtimeTarget}`}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--relay-tile-border)] text-[var(--relay-text-muted)] transition-colors hover:text-[var(--accent-indigo)]"
          >
            <BellPlus className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={onAskAgentHealthCheck}
            aria-label="同步给助理"
            title="交给助理"
            className="flex h-10 items-center gap-1 rounded-xl bg-[var(--accent-indigo)]/16 px-3 text-xs font-semibold text-[var(--accent-indigo)] transition-transform active:scale-95"
          >
            <span>助理</span>
            <ArrowUpRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* FLUSH VISUAL OVERVIEW STRIP (Embedded directly on board) */}
      <div className="grid grid-cols-2 items-center gap-4 border-y border-[var(--relay-tile-border)] py-4 sm:py-5">
        {/* Left: 24-Hour Sleep Rhythm Arc Dial */}
        <div className="flex items-center justify-center gap-3.5 sm:justify-start sm:pl-2">
          <div className="relative h-[106px] w-[106px] shrink-0">
            <svg viewBox="0 0 112 112" className="h-full w-full">
              <circle
                cx="56"
                cy="56"
                r="42"
                fill="none"
                stroke="var(--relay-track)"
                strokeWidth="7"
              />
              {[0, 90, 180, 270].map((deg) => {
                const p1 = polarToCartesian(56, 56, 33, deg);
                const p2 = polarToCartesian(56, 56, 36, deg);
                return (
                  <line
                    key={deg}
                    x1={p1.x}
                    y1={p1.y}
                    x2={p2.x}
                    y2={p2.y}
                    stroke="var(--relay-text-faint)"
                    strokeOpacity="0.55"
                    strokeWidth="1.2"
                    strokeLinecap="round"
                  />
                );
              })}
              <path
                d={sleepArcPath}
                fill="none"
                stroke="var(--accent-indigo)"
                strokeWidth="7"
                strokeLinecap="round"
              />
              <circle cx={bedPt.x} cy={bedPt.y} r="3.5" fill="var(--relay-bg)" stroke="var(--accent-indigo)" strokeWidth="2" />
              <circle cx={wakePt.x} cy={wakePt.y} r="3.5" fill="var(--relay-bg)" stroke="var(--accent-amber)" strokeWidth="2" />
            </svg>

            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="font-mono-tabular text-base font-semibold leading-none text-[var(--relay-text)]">
                {plannedSleepHours.toFixed(1)}h
              </span>
              <span className="mt-1 font-mono-tabular text-[9px] text-[var(--relay-text-faint)]">
                24H
              </span>
            </div>
          </div>

          <div className="hidden space-y-2 sm:block">
            <div className="flex items-center gap-1.5 font-mono-tabular text-xs text-[var(--relay-text)]">
              <Moon className="h-3.5 w-3.5 text-[var(--accent-indigo)]" />
              <span>{healthConfig.bedtimeTarget}</span>
            </div>
            <div className="flex items-center gap-1.5 font-mono-tabular text-xs text-[var(--relay-text)]">
              <Sun className="h-3.5 w-3.5 text-[var(--accent-amber)]" />
              <span>{healthConfig.wakeTarget}</span>
            </div>
          </div>
        </div>

        {/* Right: 4-Ring Concentric Daily Completion Visual */}
        <div className="flex items-center justify-center gap-4 sm:justify-end sm:pr-2">
          <div className="relative h-[106px] w-[106px] shrink-0">
            <svg viewBox="0 0 112 112" className="h-full w-full -rotate-90">
              {summaryRings.map((ring) => {
                const c = 2 * Math.PI * ring.r;
                const offset = c - (ring.pct / 100) * c;
                return (
                  <g key={ring.key}>
                    <circle
                      cx="56"
                      cy="56"
                      r={ring.r}
                      fill="none"
                      stroke="var(--relay-track)"
                      strokeWidth="5"
                    />
                    <motion.circle
                      cx="56"
                      cy="56"
                      r={ring.r}
                      fill="none"
                      stroke={ring.color}
                      strokeWidth="5"
                      strokeLinecap="round"
                      strokeDasharray={c}
                      initial={false}
                      animate={{ strokeDashoffset: offset }}
                      transition={{ type: 'spring', stiffness: 200, damping: 24 }}
                    />
                  </g>
                );
              })}
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="font-mono-tabular text-sm font-semibold text-[var(--relay-text)]">
                {overallPct}%
              </span>
            </div>
          </div>

          <div className="hidden grid-cols-2 gap-x-3 gap-y-2 sm:grid">
            {summaryRings.map(({ key, pct, color, Icon }) => (
              <div key={key} className="flex items-center gap-1.5">
                <span style={{ color }} className="shrink-0">
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <span className="font-mono-tabular text-xs font-medium text-[var(--relay-text)]">
                  {pct}%
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Board Manage Banner */}
      <AnimatePresence>
        {managingBoard && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="flex items-center justify-between rounded-2xl border border-[var(--accent-indigo)]/35 bg-[var(--accent-indigo)]/10 px-3.5 py-2 text-xs"
          >
            <span className="text-[var(--relay-text)]">
              按住右上角把手拖动排序 · 点尺寸切 1×1 / 2×1 / 2×2
            </span>
            <button
              type="button"
              onClick={() => setManagingBoard(false)}
              className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-[var(--accent-indigo)] px-2.5 py-1 text-[11px] font-semibold text-[#111318]"
            >
              <Check className="h-3 w-3" />
              <span>完成</span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* DRAGGABLE MAGNETIC TILE BOARD */}
      <div
        className="grid grid-cols-2 lg:grid-cols-4"
        style={{ gap: 'var(--relay-gap)' }}
      >
        <AnimatePresence mode="popLayout">
          {tiles.map((tile) => {
            const isDragging = draggingId === tile.id;
            return (
              <motion.section
                key={tile.id}
                data-drag-tile-id={tile.id}
                layout
                initial={{ opacity: 0, scale: 0.92 }}
                animate={{
                  opacity: isDragging ? 0.95 : 1,
                  scale: isDragging ? 1.03 : 1,
                }}
                exit={{ opacity: 0, scale: 0.86, y: -8 }}
                transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                style={
                  {
                    '--tile-tint': TILE_TINT_MAP[tile.id],
                    '--tile-angle': TILE_ANGLE_MAP[tile.id],
                  } as React.CSSProperties
                }
                className={`board-tile relative ${getSizeClasses(tile.size)} ${
                  isDragging ? 'z-30 ring-2 ring-white/75 shadow-2xl' : ''
                }`}
              >
                {renderTileContent(tile)}
              </motion.section>
            );
          })}
        </AnimatePresence>
      </div>

      {/* TILE PICKER SHEET */}
      <AnimatePresence>
        {showTilePicker && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowTilePicker(false)}
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-3 backdrop-blur-xs sm:items-center"
          >
            <motion.div
              initial={{ y: 24, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 20, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 400, damping: 32 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md rounded-[26px] border border-[var(--relay-tile-border)] bg-[var(--relay-tile)] p-5 text-[var(--relay-text)] shadow-2xl"
            >
              <div className="flex items-center justify-between pb-3 border-b border-[var(--relay-tile-border)]">
                <span className="text-sm font-semibold">健康浮贴</span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setManagingBoard((v) => !v);
                      setShowTilePicker(false);
                    }}
                    className="rounded-xl border border-[var(--relay-tile-border)] px-3 py-1.5 text-xs font-medium text-[var(--relay-text-muted)] hover:text-[var(--relay-text)]"
                  >
                    {managingBoard ? '退出排版' : '调整尺寸/撕下'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowTilePicker(false)}
                    aria-label="关闭"
                    className="flex h-8 w-8 items-center justify-center rounded-xl text-[var(--relay-text-muted)] hover:text-[var(--relay-text)]"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2.5">
                {ALL_TILE_CATALOG.map(({ id, label, accentVar, Icon }) => {
                  const pinned = tiles.some((t) => t.id === id);
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => togglePinTile(id)}
                      className={`flex flex-col items-center justify-center gap-2 rounded-2xl border p-3.5 transition-all active:scale-95 ${
                        pinned
                          ? 'border-[var(--accent-indigo)]/55 bg-[var(--accent-indigo)]/12'
                          : 'border-[var(--relay-tile-border)] bg-black/15 opacity-70 hover:opacity-100'
                      }`}
                    >
                      <span style={{ color: accentVar }}>
                        <Icon className="h-5 w-5" />
                      </span>
                      <span className="text-xs font-medium">{label}</span>
                    </button>
                  );
                })}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* GOAL CONFIGURATION DRAWER */}
      <AnimatePresence>
        {showGoalSheet && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowGoalSheet(false)}
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-3 backdrop-blur-xs sm:items-center"
          >
            <motion.div
              initial={{ y: 24, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 20, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 400, damping: 32 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md rounded-[26px] border border-[var(--relay-tile-border)] bg-[var(--relay-tile)] p-5 text-[var(--relay-text)] shadow-2xl space-y-4"
            >
              <div className="flex items-center justify-between pb-3 border-b border-[var(--relay-tile-border)]">
                <span className="text-sm font-semibold">每日目标</span>
                <button
                  type="button"
                  onClick={() => setShowGoalSheet(false)}
                  aria-label="关闭目标设定"
                  className="flex h-8 w-8 items-center justify-center rounded-xl text-[var(--relay-text-muted)] hover:text-[var(--relay-text)]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1.5 text-xs">
                  <span className="text-[var(--relay-text-muted)]">睡眠 (h)</span>
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
                    className="min-h-[42px] w-full rounded-xl border border-[var(--relay-tile-border)] bg-[var(--relay-bg)] px-3 font-mono-tabular text-sm text-[var(--relay-text)] focus:border-[var(--accent-indigo)] focus:outline-none"
                  />
                </label>

                <label className="space-y-1.5 text-xs">
                  <span className="text-[var(--relay-text-muted)]">饮水 (杯)</span>
                  <input
                    type="number"
                    min={4}
                    max={12}
                    value={healthConfig.waterGoalCups}
                    onChange={(e) =>
                      onUpdateConfig({
                        ...healthConfig,
                        waterGoalCups: clamp(Number(e.target.value) || 8, 4, 12),
                      })
                    }
                    className="min-h-[42px] w-full rounded-xl border border-[var(--relay-tile-border)] bg-[var(--relay-bg)] px-3 font-mono-tabular text-sm text-[var(--relay-text)] focus:border-[var(--accent-indigo)] focus:outline-none"
                  />
                </label>

                <label className="space-y-1.5 text-xs">
                  <span className="text-[var(--relay-text-muted)]">入睡</span>
                  <input
                    type="time"
                    value={healthConfig.bedtimeTarget}
                    onChange={(e) =>
                      onUpdateConfig({ ...healthConfig, bedtimeTarget: e.target.value })
                    }
                    className="min-h-[42px] w-full rounded-xl border border-[var(--relay-tile-border)] bg-[var(--relay-bg)] px-3 font-mono-tabular text-sm text-[var(--relay-text)] focus:border-[var(--accent-indigo)] focus:outline-none"
                  />
                </label>

                <label className="space-y-1.5 text-xs">
                  <span className="text-[var(--relay-text-muted)]">起床</span>
                  <input
                    type="time"
                    value={healthConfig.wakeTarget}
                    onChange={(e) =>
                      onUpdateConfig({ ...healthConfig, wakeTarget: e.target.value })
                    }
                    className="min-h-[42px] w-full rounded-xl border border-[var(--relay-tile-border)] bg-[var(--relay-bg)] px-3 font-mono-tabular text-sm text-[var(--relay-text)] focus:border-[var(--accent-indigo)] focus:outline-none"
                  />
                </label>

                <label className="col-span-2 space-y-1.5 text-xs">
                  <span className="text-[var(--relay-text-muted)]">步数目标</span>
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
                    className="min-h-[42px] w-full rounded-xl border border-[var(--relay-tile-border)] bg-[var(--relay-bg)] px-3 font-mono-tabular text-sm text-[var(--relay-text)] focus:border-[var(--accent-indigo)] focus:outline-none"
                  />
                </label>
              </div>

              <button
                type="button"
                onClick={() => setShowGoalSheet(false)}
                className="flex h-11 w-full items-center justify-center rounded-2xl bg-[var(--accent-indigo)] text-xs font-semibold text-[#111318] transition-transform active:scale-[0.98]"
              >
                完成
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
