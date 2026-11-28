import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, ExternalLink, X } from 'lucide-react';
import type { AgentProfile, BriefingItem, ReminderItem } from '../types/relay';
import { MuseAvatarHeader } from './MuseAvatarHeader';
import { Feed3DIcon } from './Feed3DIcons';
import {
  ArrowsClockwise,
  Clock,
  FeedBookmarkIcon,
  FeedReplyIcon,
} from './AppIcons';

interface ResearchViewProps {
  briefings: BriefingItem[];
  reminders: ReminderItem[];
  agentProfile?: AgentProfile;
  isFetchingDigest?: boolean;
  isVoiceActive?: boolean;
  onOpenDrawer?: () => void;
  onTapAvatar?: () => void;
  onToggleSaveBriefing?: (item: BriefingItem) => void;
  onAskAboutBriefing?: (item: BriefingItem) => void;
  onToggleReminder?: (id: string) => void;
  onSnoozeReminder?: (id: string) => void;
  onAskAboutReminder?: (item: ReminderItem) => void;
  onFetchFreshDigest?: () => void;
}

type FeedFilter = 'all' | 'reports' | 'reminders' | 'saved';

export const ResearchView: React.FC<ResearchViewProps> = ({
  briefings,
  reminders,
  agentProfile,
  isFetchingDigest = false,
  isVoiceActive = false,
  onOpenDrawer,
  onTapAvatar,
  onToggleSaveBriefing,
  onAskAboutBriefing,
  onToggleReminder,
  onSnoozeReminder,
  onAskAboutReminder,
  onFetchFreshDigest,
}) => {
  const [filter, setFilter] = useState<FeedFilter>('all');
  const [readingBrief, setReadingBrief] = useState<BriefingItem | null>(null);

  const activeReminders = useMemo(
    () => reminders.filter((r) => !r.completed),
    [reminders]
  );

  const savedBriefings = useMemo(
    () => briefings.filter((b) => b.saved),
    [briefings]
  );

  const visibleReminders =
    filter === 'all' || filter === 'reminders' ? activeReminders : [];

  const visibleBriefings =
    filter === 'all' || filter === 'reports'
      ? briefings
      : filter === 'saved'
        ? savedBriefings
        : [];

  const totalVisible = visibleReminders.length + visibleBriefings.length;

  return (
    <div className="mx-auto w-full max-w-[680px] px-4 pt-3 pb-28 sm:px-6 lg:pt-7 lg:pb-14 space-y-4">
      {/* Muse Header — tap circular AI avatar for in-place voice */}
      <MuseAvatarHeader
        agentProfile={agentProfile}
        isVoiceActive={isVoiceActive}
        onOpenDrawer={onOpenDrawer}
        onTapAvatar={onTapAvatar}
        rightSlot={
          onFetchFreshDigest ? (
            <button
              type="button"
              onClick={onFetchFreshDigest}
              disabled={isFetchingDigest}
              aria-label="同步最新汇报与提醒"
              title="同步助理汇报"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-black/[0.08] bg-white text-zinc-800 shadow-xs transition-colors hover:bg-zinc-50 active:scale-95 disabled:opacity-45 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-200"
            >
              <ArrowsClockwise
                weight="regular"
                className={`h-[18px] w-[18px] ${isFetchingDigest ? 'animate-spin' : ''}`}
              />
            </button>
          ) : undefined
        }
      />

      {/* Minimal Monochrome Filter Strip */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
        {(
          [
            { key: 'all', label: '全部', count: activeReminders.length + briefings.length },
            { key: 'reports', label: '汇报', count: briefings.length },
            { key: 'reminders', label: '提醒', count: activeReminders.length },
            { key: 'saved', label: '收藏', count: savedBriefings.length },
          ] as { key: FeedFilter; label: string; count: number }[]
        ).map(({ key, label, count }) => {
          const active = filter === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`inline-flex min-h-[34px] shrink-0 items-center gap-1.5 rounded-full px-3.5 text-xs font-medium transition-colors whitespace-nowrap ${
                active
                  ? 'bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950'
                  : 'border border-black/[0.08] bg-white text-zinc-600 hover:text-zinc-950 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
              }`}
            >
              <span>{label}</span>
              {count > 0 && (
                <span className="font-mono-tabular text-[11px] opacity-65">{count}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Feed Cards with Matte-Clay 3D Icons (Title -> Hairline Divider -> Contents) */}
      {totalVisible === 0 ? (
        <div className="muse-card flex flex-col items-center justify-center rounded-[26px] py-16 text-center px-6">
          <Feed3DIcon kind="news" size={52} />
          {onFetchFreshDigest && filter !== 'saved' && (
            <button
              type="button"
              onClick={onFetchFreshDigest}
              disabled={isFetchingDigest}
              className="mt-4 inline-flex min-h-[38px] items-center gap-1.5 rounded-full bg-zinc-950 px-4 text-xs font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950"
            >
              <ArrowsClockwise
                weight="regular"
                className={`h-3.5 w-3.5 ${isFetchingDigest ? 'animate-spin' : ''}`}
              />
              <span>同步</span>
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3.5">
          <AnimatePresence mode="popLayout">
            {/* AI-Pushed Reminder Cards */}
            {visibleReminders.map((rem) => (
              <motion.article
                key={`rem-${rem.id}`}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.18 }}
                className="muse-card rounded-[26px] p-4.5"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <Feed3DIcon
                      kind={rem.priority === 'high' ? 'urgent' : 'reminder'}
                      size={40}
                    />
                    <h2 className="line-clamp-2 text-[15px] font-semibold leading-snug text-[var(--relay-text)]">
                      {rem.title}
                    </h2>
                  </div>

                  {/* Monochrome Quick Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    {onSnoozeReminder && (
                      <button
                        type="button"
                        onClick={() => onSnoozeReminder(rem.id)}
                        aria-label="延后30分钟"
                        title="延后 30 分钟"
                        className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                      >
                        <Clock weight="regular" className="h-[17px] w-[17px]" />
                      </button>
                    )}
                    {onAskAboutReminder && (
                      <button
                        type="button"
                        onClick={() => onAskAboutReminder(rem)}
                        aria-label="追问"
                        title="追问"
                        className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-950 dark:hover:bg-zinc-800"
                      >
                        <FeedReplyIcon className="h-[17px] w-[17px]" />
                      </button>
                    )}
                    {onToggleReminder && (
                      <button
                        type="button"
                        onClick={() => onToggleReminder(rem.id)}
                        aria-label="标记完成"
                        title="完成"
                        className="flex h-8 w-8 items-center justify-center rounded-full border border-zinc-300 text-zinc-700 transition-colors hover:border-zinc-900 hover:bg-zinc-950 hover:text-white dark:border-zinc-700 dark:text-zinc-200 dark:hover:border-white dark:hover:bg-white dark:hover:text-zinc-950"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="my-3 border-t border-black/[0.06] dark:border-white/10" />

                <div className="flex items-center justify-between gap-2 text-[12.5px] text-[var(--relay-text-muted)]">
                  <span className="truncate">
                    {rem.note || rem.dueLabel}
                  </span>
                  <span className="shrink-0 font-mono-tabular text-[11px] text-[var(--relay-text-faint)]">
                    {rem.dueLabel}
                  </span>
                </div>
              </motion.article>
            ))}

            {/* AI-Pushed Paper & News Report Cards */}
            {visibleBriefings.map((brief) => (
              <motion.article
                key={`brief-${brief.id}`}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.18 }}
                onClick={() => setReadingBrief(brief)}
                className="muse-card cursor-pointer rounded-[26px] p-5"
              >
                {/* Header: 3D Clay Icon + Title + Monochrome Bookmark */}
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <Feed3DIcon
                      kind={brief.kind === 'paper' ? 'paper' : 'news'}
                      size={42}
                    />
                    <h2 className="line-clamp-2 text-[15px] font-semibold leading-snug text-[var(--relay-text)]">
                      {brief.title}
                    </h2>
                  </div>

                  {onToggleSaveBriefing && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleSaveBriefing(brief);
                      }}
                      aria-label={brief.saved ? '取消收藏' : '收藏'}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      <FeedBookmarkIcon className="h-[17px] w-[17px]" active={brief.saved} />
                    </button>
                  )}
                </div>

                <div className="my-3 border-t border-black/[0.06] dark:border-white/10" />

                {/* Report Body */}
                <p className="text-[13.5px] leading-relaxed text-[var(--relay-text-muted)] line-clamp-3">
                  {brief.summary}
                </p>

                {/* Minimal Footer */}
                <div
                  className="mt-3.5 flex items-center justify-between gap-2 text-[11px] text-[var(--relay-text-faint)]"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex min-w-0 items-center gap-1.5 truncate">
                    <span className="truncate">{brief.source}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono-tabular">{brief.publishedAt}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono-tabular">{brief.readMinutes}m</span>
                  </div>

                  {onAskAboutBriefing && (
                    <button
                      type="button"
                      onClick={() => onAskAboutBriefing(brief)}
                      aria-label="追问助理"
                      title="追问"
                      className="flex h-8 w-8 items-center justify-center rounded-full border border-black/[0.07] bg-zinc-50 text-zinc-700 transition-colors hover:bg-zinc-100 active:scale-95 dark:border-white/10 dark:bg-zinc-800 dark:text-zinc-200"
                    >
                      <FeedReplyIcon className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </motion.article>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Clean Report Reader Modal */}
      <AnimatePresence>
        {readingBrief && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setReadingBrief(null)}
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/35 p-3 backdrop-blur-xs sm:items-center"
          >
            <motion.div
              initial={{ y: 24, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 20, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="mac-card flex max-h-[82vh] w-full max-w-lg flex-col overflow-hidden rounded-[28px] text-[var(--relay-text)]"
            >
              <div className="flex items-center justify-between border-b border-black/[0.06] px-5 py-3.5 dark:border-white/10">
                <span className="font-mono-tabular text-xs text-[var(--relay-text-muted)]">
                  {readingBrief.source} · {readingBrief.publishedAt}
                </span>
                <div className="flex items-center gap-1">
                  {onToggleSaveBriefing && (
                    <button
                      type="button"
                      onClick={() => {
                        onToggleSaveBriefing(readingBrief);
                        setReadingBrief((prev) => (prev ? { ...prev, saved: !prev.saved } : null));
                      }}
                      aria-label="收藏"
                      className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      <FeedBookmarkIcon className="h-4 w-4" active={readingBrief.saved} />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setReadingBrief(null)}
                    aria-label="关闭"
                    className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--relay-text-muted)] hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3.5">
                <div className="flex items-center gap-3">
                  <Feed3DIcon
                    kind={readingBrief.kind === 'paper' ? 'paper' : 'news'}
                    size={44}
                  />
                  <h2 className="text-[17px] font-semibold leading-snug text-[var(--relay-text)]">
                    {readingBrief.title}
                  </h2>
                </div>
                <p className="text-[13.5px] leading-relaxed text-[var(--relay-text-muted)]">
                  {readingBrief.summary}
                </p>
                {readingBrief.takeaways.length > 0 && (
                  <ul className="list-disc space-y-1.5 pl-4 text-[13px] leading-relaxed text-[var(--relay-text-muted)]">
                    {readingBrief.takeaways.map((point, idx) => (
                      <li key={idx}>{point}</li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="flex items-center justify-between gap-2 border-t border-black/[0.06] px-5 py-3 dark:border-white/10">
                {readingBrief.url ? (
                  <a
                    href={readingBrief.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-9 items-center gap-1.5 rounded-full border border-black/[0.08] px-3.5 text-xs font-medium text-zinc-900 hover:bg-zinc-50 dark:border-white/10 dark:text-zinc-100 dark:hover:bg-zinc-800"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    <span>原文</span>
                  </a>
                ) : (
                  <span />
                )}

                {onAskAboutBriefing && (
                  <button
                    type="button"
                    onClick={() => {
                      const target = readingBrief;
                      setReadingBrief(null);
                      onAskAboutBriefing(target);
                    }}
                    className="inline-flex h-9 items-center gap-1.5 rounded-full bg-zinc-950 px-4 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950"
                  >
                    <span>追问</span>
                  </button>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
