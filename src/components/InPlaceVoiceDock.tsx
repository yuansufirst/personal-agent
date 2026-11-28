import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Loader2, X } from 'lucide-react';
import { ArrowUp, ArrowUpRight, Trash } from './AppIcons';

interface InPlaceVoiceDockProps {
  listening: boolean;
  transcribing: boolean;
  formattedTime: string;
  transcript: string;
  onCancel: () => void;
  onConfirmSend: () => void;
  /** Optional floating mini-reply card shown right on current tab after sending via voice */
  miniReply?: {
    prompt: string;
    reply: string;
    streaming: boolean;
  } | null;
  onDismissMiniReply?: () => void;
  onOpenChat?: () => void;
}

/**
 * Floating Muse Voice Bar + Mini Reply Pill rendered directly over the current tab
 * (Feeds / Goals / Health / Library) so tapping the circular AI avatar works in-place.
 */
export const InPlaceVoiceDock: React.FC<InPlaceVoiceDockProps> = ({
  listening,
  transcribing,
  formattedTime,
  transcript,
  onCancel,
  onConfirmSend,
  miniReply,
  onDismissMiniReply,
  onOpenChat,
}) => {
  const activeVoice = listening || transcribing;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[74px] z-40 px-4 lg:bottom-6 lg:left-[276px]">
      <div className="mx-auto max-w-[520px] space-y-2">
        {/* Mini AI reply overlay on current tab (non-intrusive, stays on current screen) */}
        <AnimatePresence>
          {!activeVoice && miniReply && (
            <motion.div
              initial={{ opacity: 0, y: 12, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.97 }}
              transition={{ duration: 0.18 }}
              className="pointer-events-auto mac-card rounded-[24px] p-3.5 text-[var(--relay-text)]"
            >
              <div className="flex items-start justify-between gap-2.5">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="truncate text-[11px] font-medium text-[var(--relay-text-faint)]">
                    “{miniReply.prompt}”
                  </div>
                  <div className="line-clamp-3 text-[13px] leading-relaxed text-[var(--relay-text)]">
                    {miniReply.reply ? (
                      miniReply.reply
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-[var(--relay-text-muted)]">
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-500" />
                        <span>…</span>
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {onOpenChat && (
                    <button
                      type="button"
                      onClick={() => {
                        onDismissMiniReply?.();
                        onOpenChat();
                      }}
                      aria-label="在对话中查看"
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-100 text-zinc-700 hover:bg-zinc-200/80 dark:bg-zinc-800 dark:text-zinc-200"
                    >
                      <ArrowUpRight weight="bold" className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {onDismissMiniReply && (
                    <button
                      type="button"
                      onClick={onDismissMiniReply}
                      aria-label="关闭"
                      className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Live Voice Recording Capsule Bar */}
        <AnimatePresence>
          {activeVoice && (
            <motion.div
              initial={{ opacity: 0, y: 14, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              className="pointer-events-auto space-y-2"
            >
              {transcript.trim() && (
                <div className="rounded-2xl border border-black/[0.07] bg-white px-3.5 py-2 text-xs leading-relaxed text-[var(--relay-text)] shadow-sm dark:border-white/10 dark:bg-zinc-900">
                  {transcript}
                </div>
              )}

              <div className="chat-composer-glass flex min-h-[54px] items-center gap-2.5 rounded-full px-3 py-1.5">
                <button
                  type="button"
                  onClick={onCancel}
                  aria-label="取消语音"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 active:scale-95 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                >
                  <Trash weight="duotone" className="h-[18px] w-[18px]" />
                </button>

                <span className="font-mono-tabular w-9 shrink-0 text-[13px] font-medium text-zinc-500 dark:text-zinc-400">
                  {formattedTime}
                </span>

                <div className="flex flex-1 items-center justify-center gap-[3px] overflow-hidden px-1">
                  {[10, 14, 18, 22, 16, 24, 20, 14, 18, 12, 15, 10].map((h, idx) => (
                    <span
                      key={`vbar-${idx}`}
                      style={{
                        height: `${h}px`,
                        animationDelay: `${idx * 75}ms`,
                      }}
                      className={`w-[2.5px] shrink-0 rounded-full bg-zinc-800 dark:bg-zinc-200 ${
                        listening ? 'voice-wave-bar' : 'opacity-40'
                      }`}
                    />
                  ))}
                  {Array.from({ length: 12 }).map((_, idx) => (
                    <span
                      key={`vdot-${idx}`}
                      className="h-[2.5px] w-[2.5px] shrink-0 rounded-full bg-zinc-400/80 dark:bg-zinc-500"
                    />
                  ))}
                </div>

                {transcribing && (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-zinc-500 dark:text-zinc-400" />
                )}

                <button
                  type="button"
                  onClick={onConfirmSend}
                  aria-label="发送语音"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-200/90 text-sky-700 transition-all hover:bg-sky-300/90 active:scale-95 dark:bg-sky-500/25 dark:text-sky-300 dark:hover:bg-sky-500/35"
                >
                  <ArrowUp weight="bold" className="h-[18px] w-[18px]" />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};
