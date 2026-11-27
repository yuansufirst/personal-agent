import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Archive,
  ArrowUpRight,
  BookOpen,
  Check,
  ExternalLink,
  FlaskConical,
  GripVertical,
  Lightbulb,
  Link2,
  PenLine,
  Plus,
  RotateCcw,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import type { ResearchItem } from '../types/relay';
import { useGridDragReorder } from '../hooks/useGridDragReorder';

interface ResearchViewProps {
  items: ResearchItem[];
  onAddItem: (item: Omit<ResearchItem, 'id' | 'updatedAt'>) => void;
  onUpdateProgress: (id: string, progress: number) => void;
  onUpdateStatus: (id: string, status: ResearchItem['status']) => void;
  onUpdateItem?: (
    id: string,
    patch: Partial<Pick<ResearchItem, 'title' | 'venueOrSource' | 'url' | 'notes' | 'category'>>
  ) => void;
  onReorderItems?: (nextItems: ResearchItem[]) => void;
  onDeleteItem: (id: string) => void;
  onAskAgent: (item: ResearchItem) => void;
  onShowToast: (msg: string) => void;
}

type FilterKey = 'active' | ResearchItem['status'];

const RESEARCH_PRIORITY_KEY = 'relay_research_priority_v1';

const STAGE_META: Record<
  ResearchItem['status'],
  { label: string; colorVar: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  reading: { label: '阅读', colorVar: 'var(--accent-indigo)', Icon: BookOpen },
  running: { label: '实验', colorVar: 'var(--accent-mint)', Icon: FlaskConical },
  writing: { label: '写作', colorVar: 'var(--accent-amber)', Icon: PenLine },
  archived: { label: '归档', colorVar: 'var(--relay-text-faint)', Icon: Archive },
};

const CATEGORY_META: Record<
  ResearchItem['category'],
  {
    label: string;
    colorVar: string;
    tintVar: string;
    Icon: React.ComponentType<{ className?: string }>;
  }
> = {
  paper: {
    label: '论文',
    colorVar: 'var(--accent-indigo)',
    tintVar: 'var(--tint-blue)',
    Icon: BookOpen,
  },
  experiment: {
    label: '实验',
    colorVar: 'var(--accent-mint)',
    tintVar: 'var(--tint-emerald)',
    Icon: FlaskConical,
  },
  idea: {
    label: '灵感',
    colorVar: 'var(--accent-amber)',
    tintVar: 'var(--tint-amber)',
    Icon: Lightbulb,
  },
};

interface ProgressRingProps {
  value: number;
  color: string;
  size?: number;
  strokeWidth?: number;
  textSize?: string;
}

const ProgressRing: React.FC<ProgressRingProps> = ({
  value,
  color,
  size = 56,
  strokeWidth = 5,
  textSize = 'text-xs',
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
      <span
        className={`absolute font-mono-tabular font-semibold text-[var(--relay-text)] ${textSize}`}
      >
        {value}%
      </span>
    </div>
  );
};

export const ResearchView: React.FC<ResearchViewProps> = ({
  items,
  onAddItem,
  onUpdateProgress,
  onUpdateStatus,
  onUpdateItem,
  onReorderItems,
  onDeleteItem,
  onAskAgent,
  onShowToast,
}) => {
  const [filter, setFilter] = useState<FilterKey>('active');
  const [showAddSheet, setShowAddSheet] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [priorityIds, setPriorityIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(RESEARCH_PRIORITY_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as string[];
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // ignore
    }
    return [];
  });

  // Add form state
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<ResearchItem['category']>('paper');
  const [status, setStatus] = useState<ResearchItem['status']>('reading');
  const [isImportantDraft, setIsImportantDraft] = useState(false);
  const [venueOrSource, setVenueOrSource] = useState('');
  const [url, setUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [progress, setProgress] = useState(20);
  const [pendingPriorityTitle, setPendingPriorityTitle] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(RESEARCH_PRIORITY_KEY, JSON.stringify(priorityIds));
    } catch {
      // ignore
    }
  }, [priorityIds]);

  // Auto-mark newly added item as priority when checked in the Add Sheet
  useEffect(() => {
    if (!pendingPriorityTitle) return;
    const match = items.find((i) => i.title === pendingPriorityTitle);
    if (match) {
      setPriorityIds((prev) => (prev.includes(match.id) ? prev : [...prev, match.id]));
      setPendingPriorityTitle(null);
    }
  }, [items, pendingPriorityTitle]);

  const selectedItem = useMemo(
    () => items.find((i) => i.id === selectedId) ?? null,
    [items, selectedId]
  );

  const stageCounts = useMemo(() => {
    const counts = { reading: 0, running: 0, writing: 0, archived: 0 };
    for (const item of items) {
      counts[item.status] += 1;
    }
    return counts;
  }, [items]);

  const activeCount = stageCounts.reading + stageCounts.running + stageCounts.writing;

  const filtered = useMemo(() => {
    if (filter === 'active') return items.filter((i) => i.status !== 'archived');
    return items.filter((i) => i.status === filter);
  }, [items, filter]);

  const handleReorderFiltered = (reorderedVisible: ResearchItem[]) => {
    if (!onReorderItems) return;
    const visibleIds = new Set(reorderedVisible.map((i) => i.id));
    let ptr = 0;
    const merged = items.map((item) => (visibleIds.has(item.id) ? reorderedVisible[ptr++] : item));
    onReorderItems(merged);
  };

  const { draggingId, startDrag } = useGridDragReorder({
    items: filtered,
    getId: (item) => item.id,
    onReorder: handleReorderFiltered,
  });

  const togglePriority = (id: string) => {
    setPriorityIds((prev) => {
      const exists = prev.includes(id);
      onShowToast(exists ? '已转为普通方形浮贴' : '已标记为重点（横向满宽）');
      return exists ? prev.filter((x) => x !== id) : [...prev, id];
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanTitle = title.trim();
    if (!cleanTitle) return;
    if (isImportantDraft) {
      setPendingPriorityTitle(cleanTitle);
    }
    onAddItem({
      title: cleanTitle,
      category,
      status,
      progress,
      venueOrSource: venueOrSource.trim() || undefined,
      url: url.trim() || undefined,
      notes: notes.trim(),
    });
    setTitle('');
    setVenueOrSource('');
    setUrl('');
    setNotes('');
    setProgress(20);
    setIsImportantDraft(false);
    setShowAddSheet(false);
    onShowToast(isImportantDraft ? '已贴上重点横向浮贴' : '已贴上新科研浮贴');
  };

  const handlePeelOrRestore = (item: ResearchItem) => {
    if (item.status === 'archived') {
      onUpdateStatus(item.id, 'reading');
      onShowToast('已重新贴回看板');
    } else {
      onUpdateProgress(item.id, 100);
      onUpdateStatus(item.id, 'archived');
      if (selectedId === item.id) setSelectedId(null);
      onShowToast('已完成并撕下归档');
    }
  };

  const totalCount = Math.max(1, items.length);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-5 pb-28 sm:px-6 lg:py-8 lg:pb-14 space-y-5">
      {/* FLUSH BOARD HEADER (NOT a tile) */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-2.5 min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-[var(--relay-text)]">科研</h1>
          <span className="font-mono-tabular text-xs text-[var(--relay-text-muted)]">
            {activeCount} 进行 · {stageCounts.archived} 归档
          </span>
        </div>

        <button
          type="button"
          onClick={() => setShowAddSheet(true)}
          aria-label="贴上科研浮贴"
          className="mini-tile inline-flex h-10 items-center gap-1.5 rounded-xl px-3.5 text-xs font-semibold text-[var(--relay-text)] transition-transform active:scale-95"
          style={{ '--tile-tint': 'var(--tint-blue)' } as React.CSSProperties}
        >
          <Plus className="h-4 w-4 text-[var(--accent-indigo)]" />
          <span>贴浮贴</span>
        </button>
      </div>

      {/* FLUSH STAGE DISTRIBUTION BAR */}
      <div className="space-y-3 border-y border-[var(--relay-tile-border)]/45 py-3.5">
        <div className="flex h-2 w-full overflow-hidden rounded-full bg-[var(--relay-track)] gap-0.5">
          {items.length > 0 && (
            <>
              {stageCounts.reading > 0 && (
                <motion.div
                  layout
                  style={{
                    width: `${(stageCounts.reading / totalCount) * 100}%`,
                    backgroundColor: 'var(--accent-indigo)',
                  }}
                  className="h-full rounded-full"
                />
              )}
              {stageCounts.running > 0 && (
                <motion.div
                  layout
                  style={{
                    width: `${(stageCounts.running / totalCount) * 100}%`,
                    backgroundColor: 'var(--accent-mint)',
                  }}
                  className="h-full rounded-full"
                />
              )}
              {stageCounts.writing > 0 && (
                <motion.div
                  layout
                  style={{
                    width: `${(stageCounts.writing / totalCount) * 100}%`,
                    backgroundColor: 'var(--accent-amber)',
                  }}
                  className="h-full rounded-full"
                />
              )}
              {stageCounts.archived > 0 && (
                <motion.div
                  layout
                  style={{
                    width: `${(stageCounts.archived / totalCount) * 100}%`,
                    backgroundColor: 'var(--relay-text-faint)',
                  }}
                  className="h-full rounded-full opacity-55"
                />
              )}
            </>
          )}
        </div>

        {/* Clean Icon-First Segmented Filter */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
          {(
            [
              ['active', '看板', activeCount, null],
              ['reading', '阅读', stageCounts.reading, 'var(--accent-indigo)'],
              ['running', '实验', stageCounts.running, 'var(--accent-mint)'],
              ['writing', '写作', stageCounts.writing, 'var(--accent-amber)'],
              ['archived', '归档', stageCounts.archived, 'var(--relay-text-faint)'],
            ] as [FilterKey, string, number, string | null][]
          ).map(([key, label, count, dotColor]) => {
            const active = filter === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-xl px-3 text-xs font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'mini-tile mini-tile-active text-[var(--relay-text)]'
                    : 'text-[var(--relay-text-muted)] hover:text-[var(--relay-text)]'
                }`}
              >
                {dotColor && (
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: dotColor }}
                  />
                )}
                <span>{label}</span>
                <span className="font-mono-tabular text-[11px] text-[var(--relay-text-faint)]">
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* PRIORITY-DRIVEN MAGNETIC RESEARCH TILE GRID:
          - 重点 (Starred) = col-span-2 (Full horizontal width, high-contrast crimson-red gradient)
          - 普通 (Normal) = col-span-1 (Half-width square tile) */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="mini-tile flex h-14 w-14 items-center justify-center rounded-2xl text-[var(--relay-text-faint)]">
            <FlaskConical className="h-6 w-6" />
          </div>
          <button
            type="button"
            onClick={() => setShowAddSheet(true)}
            className="mini-tile mt-4 inline-flex min-h-[42px] items-center gap-1.5 rounded-xl px-4 text-xs font-medium text-[var(--relay-text)] transition-transform active:scale-95"
          >
            <Plus className="h-4 w-4 text-[var(--accent-indigo)]" />
            <span>{filter === 'archived' ? '暂无已归档浮贴' : '贴上第一张科研浮贴'}</span>
          </button>
        </div>
      ) : (
        <div
          className="grid grid-cols-2 lg:grid-cols-4"
          style={{ gap: 'var(--relay-gap)' }}
        >
          <AnimatePresence mode="popLayout">
            {filtered.map((item, idx) => {
              const cat = CATEGORY_META[item.category];
              const stage = STAGE_META[item.status];
              const CatIcon = cat.Icon;
              const isArchived = item.status === 'archived';
              const isPriority = priorityIds.includes(item.id) && !isArchived;
              const ringColor = isArchived
                ? 'var(--relay-text-faint)'
                : isPriority
                  ? 'var(--accent-coral)'
                  : cat.colorVar;
              const categoryTintVariants: Record<ResearchItem['category'], string[]> = {
                paper: ['var(--tint-blue)', 'var(--tint-cyan)', 'var(--tint-violet)'],
                experiment: ['var(--tint-emerald)', 'var(--tint-teal)', 'var(--tint-cyan)'],
                idea: ['var(--tint-amber)', 'var(--tint-rose)', 'var(--tint-violet)'],
              };
              const tileAngles = ['162deg', '178deg', '194deg', '168deg', '186deg'];
              const paletteCycle = categoryTintVariants[item.category];
              const tileTint = isArchived
                ? '#334155'
                : isPriority
                  ? 'var(--tint-red)'
                  : paletteCycle[idx % paletteCycle.length];
              const tileAngle = tileAngles[idx % tileAngles.length];
              const isDragging = draggingId === item.id;

              return (
                <motion.article
                  key={item.id}
                  data-drag-tile-id={item.id}
                  layout
                  initial={{ opacity: 0, scale: 0.92, y: 10 }}
                  animate={{
                    opacity: isDragging ? 0.95 : 1,
                    scale: isDragging ? 1.03 : 1,
                    y: 0,
                  }}
                  exit={{ opacity: 0, scale: 0.85, y: -14, rotate: -1.5 }}
                  transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                  onClick={() => setSelectedId(item.id)}
                  style={
                    {
                      '--tile-tint': tileTint,
                      '--tile-angle': tileAngle,
                    } as React.CSSProperties
                  }
                  className={`board-tile group flex cursor-pointer flex-col justify-between gap-2.5 ${
                    isPriority ? 'board-tile-priority col-span-2' : 'col-span-1'
                  } ${isDragging ? 'z-30 ring-2 ring-white/75 shadow-2xl' : ''}`}
                >
                  {/* Top Row: Category Icon + Priority Star + Drag Grip */}
                  <div className="flex items-center justify-between gap-1 text-[11px] text-[var(--relay-text-muted)]">
                    <div className="flex min-w-0 items-center gap-1.5 truncate">
                      <span style={{ color: ringColor }} className="shrink-0">
                        <CatIcon className="h-3.5 w-3.5" />
                      </span>
                      <span className="font-medium text-[var(--relay-text)]">{stage.label}</span>
                      {isPriority && item.venueOrSource && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="truncate">{item.venueOrSource}</span>
                        </>
                      )}
                    </div>

                    <div
                      className="flex items-center gap-0.5 shrink-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {!isArchived && (
                        <button
                          type="button"
                          onClick={() => togglePriority(item.id)}
                          aria-label={isPriority ? '取消重点' : '标为重点（横向满宽）'}
                          title={isPriority ? '取消重点' : '标为重点'}
                          className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${
                            isPriority
                              ? 'text-[var(--accent-coral)]'
                              : 'text-[var(--relay-text-faint)] hover:text-[var(--relay-text)]'
                          }`}
                        >
                          <Star className={`h-3.5 w-3.5 ${isPriority ? 'fill-current' : ''}`} />
                        </button>
                      )}
                      <button
                        type="button"
                        onPointerDown={(e) => startDrag(item.id, e)}
                        aria-label="拖动排序"
                        title="按住拖动排序"
                        className="touch-none flex h-7 w-7 cursor-grab items-center justify-center rounded-lg text-[var(--relay-text-faint)] transition-colors hover:bg-white/10 hover:text-[var(--relay-text)] active:cursor-grabbing"
                      >
                        <GripVertical className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Body: Horizontal Wide Hero for 重点 vs Compact Square for 普通 */}
                  {isPriority ? (
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1 space-y-1">
                        <h2 className="line-clamp-2 text-[15px] font-semibold leading-snug text-[var(--relay-text)]">
                          {item.title}
                        </h2>
                        <div className="flex items-center gap-2 text-[11px] text-[var(--relay-text-muted)]">
                          {item.url && <Link2 className="h-3 w-3 shrink-0" />}
                          {item.notes ? (
                            <span className="truncate">{item.notes}</span>
                          ) : (
                            <span className="font-mono-tabular text-[10px] text-[var(--relay-text-faint)]">
                              {item.updatedAt.slice(5)}
                            </span>
                          )}
                        </div>
                      </div>

                      <ProgressRing
                        value={item.progress}
                        color={ringColor}
                        size={58}
                        strokeWidth={5}
                      />
                    </div>
                  ) : (
                    <div className="flex flex-1 flex-col items-start justify-between gap-2">
                      <h2 className="line-clamp-2 text-[13px] font-semibold leading-snug text-[var(--relay-text)]">
                        {item.title}
                      </h2>
                      <div className="flex w-full items-center justify-between gap-2">
                        <ProgressRing
                          value={item.progress}
                          color={ringColor}
                          size={44}
                          strokeWidth={4.5}
                          textSize="text-[10px]"
                        />
                        <span className="truncate font-mono-tabular text-[10px] text-[var(--relay-text-faint)]">
                          {item.venueOrSource || item.updatedAt.slice(5)}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Bottom Micro-Action Strip */}
                  <div
                    className="flex items-center justify-between gap-1 border-t border-white/10 pt-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center gap-1">
                      {!isArchived && (
                        <button
                          type="button"
                          onClick={() =>
                            onUpdateProgress(item.id, Math.min(100, item.progress + 10))
                          }
                          className="flex h-7 items-center justify-center rounded-lg border border-white/12 bg-black/25 px-2 font-mono-tabular text-[10px] font-medium text-[var(--relay-text)] transition-transform active:scale-95"
                        >
                          +10%
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handlePeelOrRestore(item)}
                        aria-label={isArchived ? '贴回看板' : '完成撕下'}
                        title={isArchived ? '贴回看板' : '完成撕下'}
                        className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/12 bg-black/25 text-[var(--relay-text-muted)] transition-colors hover:text-[var(--accent-mint)] active:scale-95"
                      >
                        {isArchived ? (
                          <RotateCcw className="h-3 w-3" />
                        ) : (
                          <Check className="h-3 w-3" />
                        )}
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => onAskAgent(item)}
                      aria-label="交给助理推进"
                      className="inline-flex h-7 items-center gap-0.5 rounded-lg bg-white/12 px-2 text-[10px] font-semibold text-[var(--relay-text)] transition-transform active:scale-95 hover:bg-white/20"
                    >
                      {isPriority && <span>助理</span>}
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </motion.article>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {/* STICK NEW RESEARCH TILE DRAWER */}
      <AnimatePresence>
        {showAddSheet && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowAddSheet(false)}
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 backdrop-blur-sm sm:items-center"
          >
            <motion.form
              initial={{ y: 24, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 20, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 400, damping: 32 }}
              onClick={(e) => e.stopPropagation()}
              onSubmit={handleSubmit}
              className="mac-card w-full max-w-md rounded-[26px] p-5 text-[var(--relay-text)] shadow-2xl space-y-4"
            >
              <div className="flex items-center justify-between pb-3 border-b border-white/12">
                <span className="text-sm font-semibold">新科研浮贴</span>
                <button
                  type="button"
                  onClick={() => setShowAddSheet(false)}
                  aria-label="关闭"
                  className="flex h-8 w-8 items-center justify-center rounded-xl text-[var(--relay-text-muted)] hover:text-[var(--relay-text)]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {(Object.keys(CATEGORY_META) as ResearchItem['category'][]).map((k) => {
                  const meta = CATEGORY_META[k];
                  const Icon = meta.Icon;
                  const active = category === k;
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setCategory(k)}
                      style={{ '--tile-tint': meta.tintVar } as React.CSSProperties}
                      className={`mini-tile flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl text-xs font-medium ${
                        active ? 'mini-tile-active text-[var(--relay-text)]' : 'text-[var(--relay-text-muted)]'
                      }`}
                    >
                      <span style={{ color: meta.colorVar }}>
                        <Icon className="h-4 w-4" />
                      </span>
                      <span>{meta.label}</span>
                    </button>
                  );
                })}
              </div>

              <input
                type="text"
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="标题（论文 / 实验 / 想法）"
                className="min-h-[44px] w-full rounded-xl border border-white/15 bg-black/30 px-3.5 text-sm text-[var(--relay-text)] placeholder:text-[var(--relay-text-faint)] focus:border-white/45 focus:outline-none"
              />

              {/* Priority Toggle (Full Horizontal vs Half-Width Square) */}
              <button
                type="button"
                onClick={() => setIsImportantDraft((v) => !v)}
                style={
                  {
                    '--tile-tint': isImportantDraft ? 'var(--tint-red)' : 'var(--tint-blue)',
                  } as React.CSSProperties
                }
                className={`mini-tile flex min-h-[42px] w-full items-center justify-between rounded-xl px-3.5 text-xs font-medium ${
                  isImportantDraft ? 'mini-tile-active text-[var(--relay-text)]' : 'text-[var(--relay-text-muted)]'
                }`}
              >
                <span className="flex items-center gap-2">
                  <Star
                    className={`h-4 w-4 ${
                      isImportantDraft ? 'fill-current text-[var(--accent-coral)]' : ''
                    }`}
                  />
                  <span>标记为重点</span>
                </span>
                <span className="font-mono-tabular text-[11px] text-[var(--relay-text-faint)]">
                  {isImportantDraft ? '横向满宽' : '半宽方形'}
                </span>
              </button>

              <div className="grid grid-cols-4 gap-1.5">
                {(['reading', 'running', 'writing', 'archived'] as ResearchItem['status'][]).map(
                  (st) => {
                    const active = status === st;
                    return (
                      <button
                        key={st}
                        type="button"
                        onClick={() => setStatus(st)}
                        className={`min-h-[34px] rounded-xl border text-xs font-medium transition-colors ${
                          active
                            ? 'border-white/40 bg-white/15 text-[var(--relay-text)]'
                            : 'border-white/10 bg-black/20 text-[var(--relay-text-muted)]'
                        }`}
                      >
                        {STAGE_META[st].label}
                      </button>
                    );
                  }
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  value={venueOrSource}
                  onChange={(e) => setVenueOrSource(e.target.value)}
                  placeholder="出处 (arXiv / ICLR)"
                  className="min-h-[40px] rounded-xl border border-white/12 bg-black/30 px-3 text-xs text-[var(--relay-text)] placeholder:text-[var(--relay-text-faint)] focus:border-white/40 focus:outline-none"
                />
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="链接 (可选)"
                  className="min-h-[40px] rounded-xl border border-white/12 bg-black/30 px-3 text-xs text-[var(--relay-text)] placeholder:text-[var(--relay-text-faint)] focus:border-white/40 focus:outline-none"
                />
              </div>

              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="简短笔记（可选）"
                className="w-full rounded-xl border border-white/12 bg-black/30 px-3 py-2 text-xs text-[var(--relay-text)] placeholder:text-[var(--relay-text-faint)] focus:border-white/40 focus:outline-none"
              />

              <div className="flex items-center gap-3">
                <ProgressRing
                  value={progress}
                  color={CATEGORY_META[category].colorVar}
                  size={44}
                  strokeWidth={4}
                  textSize="text-[10px]"
                />
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={progress}
                  onChange={(e) => setProgress(Number(e.target.value))}
                  aria-label="初始进度"
                  className="relay-slider flex-1 cursor-pointer"
                />
              </div>

              <button
                type="submit"
                disabled={!title.trim()}
                className="flex h-11 w-full items-center justify-center rounded-2xl bg-white text-xs font-semibold text-[#0D1017] transition-transform active:scale-[0.98] disabled:opacity-40"
              >
                贴到看板
              </button>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* RESEARCH TILE DETAIL & EDIT DRAWER */}
      <AnimatePresence>
        {selectedItem && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSelectedId(null)}
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 backdrop-blur-sm sm:items-center"
          >
            <motion.div
              initial={{ y: 24, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 20, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 400, damping: 32 }}
              onClick={(e) => e.stopPropagation()}
              className="mac-card w-full max-w-md rounded-[26px] p-5 text-[var(--relay-text)] shadow-2xl space-y-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-[11px] text-[var(--relay-text-muted)]">
                    <span style={{ color: CATEGORY_META[selectedItem.category].colorVar }}>
                      {CATEGORY_META[selectedItem.category].label}
                    </span>
                    {selectedItem.venueOrSource && (
                      <>
                        <span>·</span>
                        <span>{selectedItem.venueOrSource}</span>
                      </>
                    )}
                    <span>·</span>
                    <span className="font-mono-tabular">{selectedItem.updatedAt}</span>
                  </div>
                  <h2 className="mt-1 text-base font-semibold leading-snug text-[var(--relay-text)]">
                    {selectedItem.title}
                  </h2>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => togglePriority(selectedItem.id)}
                    aria-label="切换重点"
                    className={`flex h-8 w-8 items-center justify-center rounded-xl border border-white/12 ${
                      priorityIds.includes(selectedItem.id)
                        ? 'bg-[var(--tint-red)]/25 text-[var(--accent-coral)]'
                        : 'text-[var(--relay-text-muted)]'
                    }`}
                  >
                    <Star
                      className={`h-4 w-4 ${
                        priorityIds.includes(selectedItem.id) ? 'fill-current' : ''
                      }`}
                    />
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedId(null)}
                    aria-label="关闭详情"
                    className="flex h-8 w-8 items-center justify-center rounded-xl text-[var(--relay-text-muted)] hover:text-[var(--relay-text)]"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-4 rounded-2xl border border-white/12 bg-black/25 p-3.5">
                <ProgressRing
                  value={selectedItem.progress}
                  color={CATEGORY_META[selectedItem.category].colorVar}
                  size={64}
                  strokeWidth={5.5}
                  textSize="text-sm"
                />
                <div className="flex-1 space-y-2.5">
                  <div className="flex items-center justify-between text-[11px] text-[var(--relay-text-muted)]">
                    <span>推进进度</span>
                    <span className="font-mono-tabular text-[var(--relay-text)]">
                      {selectedItem.progress}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={selectedItem.progress}
                    onChange={(e) => onUpdateProgress(selectedItem.id, Number(e.target.value))}
                    aria-label="调整进度"
                    className="relay-slider w-full cursor-pointer"
                  />
                </div>
              </div>

              <div className="grid grid-cols-4 gap-1.5">
                {(['reading', 'running', 'writing', 'archived'] as ResearchItem['status'][]).map(
                  (st) => {
                    const active = selectedItem.status === st;
                    return (
                      <button
                        key={st}
                        type="button"
                        onClick={() => onUpdateStatus(selectedItem.id, st)}
                        className={`min-h-[36px] rounded-xl border text-xs font-medium transition-colors ${
                          active
                            ? 'border-white/40 bg-white/15 text-[var(--relay-text)]'
                            : 'border-white/10 bg-black/20 text-[var(--relay-text-muted)]'
                        }`}
                      >
                        {STAGE_META[st].label}
                      </button>
                    );
                  }
                )}
              </div>

              <div className="space-y-2">
                <textarea
                  rows={4}
                  value={selectedItem.notes}
                  onChange={(e) => onUpdateItem?.(selectedItem.id, { notes: e.target.value })}
                  placeholder="记录关键结论、实验现象或待办…"
                  className="w-full rounded-2xl border border-white/12 bg-black/30 px-3.5 py-2.5 text-xs leading-relaxed text-[var(--relay-text)] placeholder:text-[var(--relay-text-faint)] focus:border-white/40 focus:outline-none"
                />
                {selectedItem.url && (
                  <a
                    href={selectedItem.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--accent-sky)] hover:underline"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    <span className="truncate">{selectedItem.url}</span>
                  </a>
                )}
              </div>

              <div className="flex items-center gap-2 pt-2 border-t border-white/12">
                <button
                  type="button"
                  onClick={() => {
                    onDeleteItem(selectedItem.id);
                    setSelectedId(null);
                  }}
                  aria-label="删除"
                  className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/12 text-[var(--relay-text-muted)] hover:text-[var(--accent-coral)]"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => handlePeelOrRestore(selectedItem)}
                  className="flex h-10 items-center justify-center gap-1.5 rounded-xl border border-white/12 px-3.5 text-xs font-medium text-[var(--relay-text)]"
                >
                  {selectedItem.status === 'archived' ? (
                    <>
                      <RotateCcw className="h-3.5 w-3.5" />
                      <span>贴回</span>
                    </>
                  ) : (
                    <>
                      <Check className="h-3.5 w-3.5 text-[var(--accent-mint)]" />
                      <span>撕下归档</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onAskAgent(selectedItem);
                    setSelectedId(null);
                  }}
                  className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-white px-4 text-xs font-semibold text-[#0D1017] transition-transform active:scale-[0.98]"
                >
                  <span>交给助理分析</span>
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
