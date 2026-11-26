import React, { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  ArrowUpRight,
  BookOpen,
  ExternalLink,
  FlaskConical,
  Lightbulb,
  Plus,
  Trash2,
} from 'lucide-react';
import type { ResearchItem } from '../types/relay';

interface ResearchViewProps {
  items: ResearchItem[];
  onAddItem: (item: Omit<ResearchItem, 'id' | 'updatedAt'>) => void;
  onUpdateProgress: (id: string, progress: number) => void;
  onUpdateStatus: (id: string, status: ResearchItem['status']) => void;
  onDeleteItem: (id: string) => void;
  onAskAgent: (item: ResearchItem) => void;
  onShowToast: (msg: string) => void;
}

type FilterKey = 'all' | ResearchItem['status'];

const STATUS_LABELS: Record<ResearchItem['status'], string> = {
  reading: '阅读中',
  running: '实验推进',
  writing: '撰写中',
  archived: '已归档',
};

const CATEGORY_META: Record<
  ResearchItem['category'],
  { label: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  paper: { label: '论文精读', Icon: BookOpen },
  experiment: { label: '实验课题', Icon: FlaskConical },
  idea: { label: '灵感笔记', Icon: Lightbulb },
};

export const ResearchView: React.FC<ResearchViewProps> = ({
  items,
  onAddItem,
  onUpdateProgress,
  onUpdateStatus,
  onDeleteItem,
  onAskAgent,
  onShowToast,
}) => {
  const [filter, setFilter] = useState<FilterKey>('all');
  const [showForm, setShowForm] = useState(false);

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<ResearchItem['category']>('paper');
  const [status, setStatus] = useState<ResearchItem['status']>('reading');
  const [venueOrSource, setVenueOrSource] = useState('');
  const [url, setUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [progress, setProgress] = useState(20);

  const filtered = useMemo(() => {
    if (filter === 'all') return items;
    return items.filter((i) => i.status === filter);
  }, [items, filter]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanTitle = title.trim();
    if (!cleanTitle) return;
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
    setShowForm(false);
    onShowToast('已添加到科研进度');
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 pb-28 sm:px-6 lg:py-10 lg:pb-14 space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            科研与论文
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            集中记录正在精读的论文、实验进度与灵感想法，随时交给云端助理深入分析。
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="inline-flex min-h-[42px] shrink-0 items-center justify-center gap-1.5 rounded-2xl bg-zinc-950 px-4 text-xs font-medium text-white transition-transform active:scale-[0.97] hover:bg-zinc-800 dark:bg-[#1B6EF3] dark:hover:bg-blue-600 whitespace-nowrap"
        >
          <Plus className="h-4 w-4" />
          <span>{showForm ? '收起表单' : '记录论文 / 进度'}</span>
        </button>
      </div>

      {/* Add Form */}
      {showForm && (
        <motion.form
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          onSubmit={handleSubmit}
          className="mac-card rounded-3xl border border-stone-200/80 p-5 dark:border-zinc-800 space-y-3.5"
        >
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="论文标题或科研课题，例如：Attention Is All You Need / 消融实验 v2"
            className="min-h-[44px] w-full rounded-2xl border border-stone-200/90 bg-[#F8F7F4] px-3.5 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-[#1B6EF3] focus:bg-white focus:outline-none dark:border-zinc-700 dark:bg-[#0E0F12] dark:text-zinc-100"
          />

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as ResearchItem['category'])}
              aria-label="类型"
              className="min-h-[40px] rounded-xl border border-stone-200 bg-[#F8F7F4] px-3 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-[#0E0F12] dark:text-zinc-200"
            >
              <option value="paper">论文精读</option>
              <option value="experiment">实验课题</option>
              <option value="idea">灵感笔记</option>
            </select>

            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as ResearchItem['status'])}
              aria-label="阶段"
              className="min-h-[40px] rounded-xl border border-stone-200 bg-[#F8F7F4] px-3 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-[#0E0F12] dark:text-zinc-200"
            >
              <option value="reading">阅读中</option>
              <option value="running">实验推进</option>
              <option value="writing">撰写中</option>
              <option value="archived">已归档</option>
            </select>

            <input
              type="text"
              value={venueOrSource}
              onChange={(e) => setVenueOrSource(e.target.value)}
              placeholder="出处（如 arXiv / NeurIPS）"
              className="min-h-[40px] rounded-xl border border-stone-200 bg-[#F8F7F4] px-3 text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-[#1B6EF3] focus:outline-none dark:border-zinc-700 dark:bg-[#0E0F12] dark:text-zinc-100"
            />
          </div>

          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="论文或代码仓库链接（可选）"
            className="min-h-[40px] w-full rounded-xl border border-stone-200 bg-[#F8F7F4] px-3.5 text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-[#1B6EF3] focus:outline-none dark:border-zinc-700 dark:bg-[#0E0F12] dark:text-zinc-100"
          />

          <textarea
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="当前进展、核心结论或待验证的假设…"
            className="w-full rounded-2xl border border-stone-200 bg-[#F8F7F4] px-3.5 py-2.5 text-xs leading-relaxed text-zinc-900 placeholder:text-zinc-400 focus:border-[#1B6EF3] focus:outline-none dark:border-zinc-700 dark:bg-[#0E0F12] dark:text-zinc-100"
          />

          <div className="flex items-center justify-between gap-4 pt-1">
            <label className="flex flex-1 items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400">
              <span className="shrink-0">初始进度</span>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={progress}
                onChange={(e) => setProgress(Number(e.target.value))}
                className="flex-1 accent-[#1B6EF3]"
              />
              <span className="w-9 text-right font-mono-tabular font-medium text-zinc-800 dark:text-zinc-200">
                {progress}%
              </span>
            </label>
            <button
              type="submit"
              disabled={!title.trim()}
              className="min-h-[40px] rounded-xl bg-zinc-950 px-5 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-40 dark:bg-[#1B6EF3] dark:hover:bg-blue-600"
            >
              保存记录
            </button>
          </div>
        </motion.form>
      )}

      {/* Segmented Status Filter */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
        {(
          [
            ['all', `全部 · ${items.length}`],
            ['reading', '阅读中'],
            ['running', '实验推进'],
            ['writing', '撰写中'],
            ['archived', '已归档'],
          ] as [FilterKey, string][]
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setFilter(k)}
            className={`min-h-[36px] rounded-2xl px-3.5 py-1.5 text-xs font-medium transition-all whitespace-nowrap ${
              filter === k
                ? 'bg-zinc-950 text-white shadow-xs dark:bg-zinc-100 dark:text-zinc-950'
                : 'text-zinc-600 hover:bg-stone-200/70 dark:text-zinc-400 dark:hover:bg-zinc-800'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Research Items */}
      {filtered.length === 0 ? (
        <div className="mac-card rounded-3xl border border-stone-200/80 px-6 py-16 text-center dark:border-zinc-800">
          <FlaskConical className="mx-auto h-7 w-7 text-stone-300 dark:text-zinc-700" />
          <p className="mt-3 text-sm font-medium text-zinc-700 dark:text-zinc-300">
            暂无科研记录
          </p>
          <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
            点击右上角记录你的论文阅读进度、实验记录或灵感，可随时一键让助理协助梳理。
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map((item, idx) => {
            const { label: catLabel, Icon } = CATEGORY_META[item.category];
            return (
              <motion.article
                key={item.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.24, delay: Math.min(idx * 0.04, 0.2) }}
                whileHover={{ y: -2 }}
                className="mac-card rounded-3xl border border-stone-200/80 p-5 transition-colors hover:border-stone-300/90 dark:border-zinc-800 dark:hover:border-zinc-700"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                      <span className="inline-flex items-center gap-1 font-medium text-[#1B6EF3] dark:text-blue-400">
                        <Icon className="h-3.5 w-3.5" />
                        <span>{catLabel}</span>
                      </span>
                      {item.venueOrSource && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{item.venueOrSource}</span>
                        </>
                      )}
                      <span aria-hidden="true">·</span>
                      <span className="font-mono-tabular">{item.updatedAt}</span>
                    </div>

                    <h2 className="mt-2 text-base font-semibold leading-snug text-zinc-950 dark:text-zinc-50">
                      {item.title}
                    </h2>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <select
                      value={item.status}
                      onChange={(e) =>
                        onUpdateStatus(item.id, e.target.value as ResearchItem['status'])
                      }
                      aria-label="切换阶段"
                      className="min-h-[32px] rounded-xl border border-stone-200/80 bg-[#F8F7F4] px-2 text-[11px] font-medium text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                    >
                      {Object.entries(STATUS_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => onDeleteItem(item.id)}
                      aria-label="删除记录"
                      className="flex h-8 w-8 items-center justify-center rounded-xl text-zinc-400 hover:bg-stone-100 hover:text-rose-600 dark:hover:bg-zinc-800 dark:hover:text-rose-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {item.notes && (
                  <p className="mt-2.5 whitespace-pre-wrap text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
                    {item.notes}
                  </p>
                )}

                {/* Progress Bar + Interactive Slider */}
                <div className="mt-4 space-y-2">
                  <div className="flex items-center justify-between text-[11px] text-zinc-500 dark:text-zinc-400">
                    <span>推进进度</span>
                    <span className="font-mono-tabular font-medium text-zinc-800 dark:text-zinc-200">
                      {item.progress}%
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-stone-200/80 dark:bg-zinc-800">
                    <motion.div
                      className="h-full rounded-full bg-gradient-to-r from-[#1B6EF3] to-sky-400"
                      initial={false}
                      animate={{ width: `${item.progress}%` }}
                      transition={{ type: 'spring', stiffness: 260, damping: 28 }}
                    />
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={item.progress}
                    onChange={(e) => onUpdateProgress(item.id, Number(e.target.value))}
                    aria-label="调整进度百分比"
                    className="w-full cursor-pointer accent-[#1B6EF3]"
                  />
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-stone-200/60 pt-3 dark:border-zinc-800/80">
                  {item.url ? (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-[#1B6EF3] dark:text-zinc-400 dark:hover:text-blue-400"
                    >
                      <span>查看链接</span>
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  ) : (
                    <span />
                  )}

                  <button
                    type="button"
                    onClick={() => onAskAgent(item)}
                    className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl bg-zinc-950 px-3.5 py-1.5 text-xs font-medium text-white transition-transform active:scale-[0.97] hover:bg-zinc-800 dark:bg-[#1B6EF3] dark:hover:bg-blue-600"
                  >
                    <span>交给助理分析推进</span>
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </motion.article>
            );
          })}
        </div>
      )}
    </div>
  );
};
