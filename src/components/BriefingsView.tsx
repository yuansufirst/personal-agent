import React, { useMemo, useState } from 'react';
import {
  Bookmark,
  ExternalLink,
  Laptop,
  MessageSquarePlus,
  RefreshCw,
  X,
} from 'lucide-react';
import type { BriefingItem } from '../types/relay';
import { ResilientCardImage } from './InteractiveCards';

interface BriefingsViewProps {
  items: BriefingItem[];
  onToggleSave: (item: BriefingItem) => void;
  onFetchFreshDigest: () => void;
  onAskAgent: (item: BriefingItem) => void;
  onSendToPC: (item: BriefingItem) => void;
  selectedBriefing: BriefingItem | null;
  onSelectBriefing: (item: BriefingItem | null) => void;
  isFetching: boolean;
}

type FilterKey = 'all' | 'paper' | 'news' | 'saved';

export const BriefingsView: React.FC<BriefingsViewProps> = ({
  items,
  onToggleSave,
  onFetchFreshDigest,
  onAskAgent,
  onSendToPC,
  selectedBriefing,
  onSelectBriefing,
  isFetching,
}) => {
  const [filter, setFilter] = useState<FilterKey>('all');

  const filteredItems = useMemo(() => {
    if (filter === 'all') return items;
    if (filter === 'saved') return items.filter((i) => i.saved);
    return items.filter((i) => i.kind === filter);
  }, [items, filter]);

  const filterTabs: { key: FilterKey; label: string }[] = [
    { key: 'all', label: '全部简报' },
    { key: 'paper', label: '论文精读' },
    { key: 'news', label: '科技新闻' },
    { key: 'saved', label: '已收藏' },
  ];

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-5 pb-28 sm:px-6 lg:py-8 lg:pb-12">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            每日简报与论文
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            由云端 Agent 自动抓取并提炼，支持一键归档到个人电脑或转入对话深读。
          </p>
        </div>

        <button
          type="button"
          onClick={onFetchFreshDigest}
          disabled={isFetching}
          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-60 whitespace-nowrap shrink-0"
        >
          <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
          <span>{isFetching ? '正在抓取简报...' : '立即拉取最新简报'}</span>
        </button>
      </div>

      {/* Interactive segmented filter bar */}
      <div className="mt-6 flex items-center gap-1 overflow-x-auto rounded-xl bg-slate-200/60 p-1 dark:bg-slate-800/70 sm:inline-flex">
        {filterTabs.map((tab) => {
          const active = filter === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setFilter(tab.key)}
              className={`min-h-[38px] flex-1 rounded-lg px-3.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 sm:flex-none ${
                active
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-[#131822] dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Editorial Grid */}
      {filteredItems.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-slate-200/80 bg-white px-6 py-14 text-center dark:border-slate-800 dark:bg-[#131822]">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
            当前分类暂无内容
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            点击右上角「立即拉取最新简报」让云端 Agent 为你抓取。
          </p>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
          {filteredItems.map((item) => (
            <article
              key={item.id}
              className="flex flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white transition-colors hover:border-slate-300 dark:border-slate-800 dark:bg-[#131822] dark:hover:border-slate-700"
            >
              {item.imageUrl && (
                <button
                  type="button"
                  onClick={() => onSelectBriefing(item)}
                  className="block w-full text-left focus-visible:outline-none"
                >
                  <ResilientCardImage
                    src={item.imageUrl}
                    alt={item.title}
                    label={item.kind === 'paper' ? '论文精读' : '每日科技简报'}
                  />
                </button>
              )}

              <div className="flex flex-1 flex-col p-5">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                    <span className="font-medium text-blue-600 dark:text-blue-400">
                      {item.kind === 'paper' ? '论文精读' : '每日新闻'}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{item.source}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono-tabular">{item.publishedAt}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono-tabular">{item.readMinutes} 分钟</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onToggleSave(item)}
                    aria-label={item.saved ? '取消收藏' : '收藏'}
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors ${
                      item.saved
                        ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400'
                        : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200'
                    }`}
                  >
                    <Bookmark className="h-4 w-4" fill={item.saved ? 'currentColor' : 'none'} />
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => onSelectBriefing(item)}
                  className="mt-2 text-left focus-visible:outline-none"
                >
                  <h2 className="text-lg font-semibold leading-snug text-slate-900 hover:text-blue-600 dark:text-slate-100 dark:hover:text-blue-400 transition-colors">
                    {item.title}
                  </h2>
                </button>

                <p className="mt-2.5 flex-1 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                  {item.summary}
                </p>

                <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4 dark:border-slate-800/80">
                  <button
                    type="button"
                    onClick={() => onSelectBriefing(item)}
                    className="inline-flex min-h-[42px] items-center justify-center rounded-xl bg-slate-100 px-4 py-2 text-xs font-medium text-slate-800 transition-colors hover:bg-slate-200/80 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 whitespace-nowrap shrink-0"
                  >
                    阅读精要
                  </button>
                  <button
                    type="button"
                    onClick={() => onSendToPC(item)}
                    className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-slate-200 px-3.5 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
                  >
                    <Laptop className="h-3.5 w-3.5" />
                    <span>存到 PC</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onAskAgent(item)}
                    className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-700 whitespace-nowrap shrink-0"
                  >
                    <MessageSquarePlus className="h-3.5 w-3.5" />
                    <span>追问 Agent</span>
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {/* Full Reader Bottom Sheet / Modal */}
      {selectedBriefing && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/55 backdrop-blur-xs sm:items-center sm:p-4"
          onClick={() => onSelectBriefing(null)}
        >
          <div
            className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl border border-slate-200/80 bg-white dark:border-slate-800 dark:bg-[#131822] sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mt-3 h-1.5 w-10 shrink-0 rounded-full bg-slate-300 dark:bg-slate-700 sm:hidden" />

            <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 dark:border-slate-800/80">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-2 text-xs text-slate-500 dark:text-slate-400">
                  <span className="font-medium text-blue-600 dark:text-blue-400">
                    {selectedBriefing.kind === 'paper' ? '论文精读' : '每日新闻'}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{selectedBriefing.source}</span>
                  {selectedBriefing.identifier && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono-tabular">{selectedBriefing.identifier}</span>
                    </>
                  )}
                </div>
                <h3 className="mt-1 text-lg font-semibold leading-snug text-slate-900 dark:text-slate-100">
                  {selectedBriefing.title}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => onSelectBriefing(null)}
                aria-label="关闭阅读器"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
              {selectedBriefing.imageUrl && (
                <div className="overflow-hidden rounded-xl">
                  <ResilientCardImage
                    src={selectedBriefing.imageUrl}
                    alt={selectedBriefing.title}
                    label={selectedBriefing.source}
                  />
                </div>
              )}

              <div>
                <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                  核心摘要
                </h4>
                <p className="mt-2 text-sm leading-7 text-slate-700 dark:text-slate-200">
                  {selectedBriefing.summary}
                </p>
              </div>

              <div className="border-t border-slate-100 pt-4 dark:border-slate-800/80">
                <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                  结构化要点
                </h4>
                <ul className="mt-3 space-y-3 text-sm leading-relaxed text-slate-700 dark:text-slate-200">
                  {selectedBriefing.takeaways.map((point, idx) => (
                    <li key={idx} className="flex gap-3">
                      <span className="font-mono-tabular text-xs font-semibold text-blue-600 dark:text-blue-400 mt-0.5">
                        0{idx + 1}.
                      </span>
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="border-t border-slate-100 pt-4 dark:border-slate-800/80">
                <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                  与你工作流的关联
                </h4>
                <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                  {selectedBriefing.relevanceNote}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-5 py-4 dark:border-slate-800/80">
              <button
                type="button"
                onClick={() => {
                  onAskAgent(selectedBriefing);
                  onSelectBriefing(null);
                }}
                className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 whitespace-nowrap"
              >
                <MessageSquarePlus className="h-4 w-4" />
                <span>带入对话追问</span>
              </button>
              <button
                type="button"
                onClick={() => onSendToPC(selectedBriefing)}
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
              >
                <Laptop className="h-4 w-4" />
                <span>保存 Markdown 到 PC</span>
              </button>
              <a
                href={selectedBriefing.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-slate-200 px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
              >
                <ExternalLink className="h-4 w-4" />
                <span>原文</span>
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
