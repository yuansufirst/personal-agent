import React from 'react';
import { motion } from 'motion/react';
import { Microphone, NavMenuIcon } from './AppIcons';
import type { AgentProfile } from '../types/relay';
import { resolveAvatarSrc } from '../services/avatarPresets';

interface MuseAvatarHeaderProps {
  agentProfile?: AgentProfile;
  isVoiceActive?: boolean;
  onOpenDrawer?: () => void;
  onTapAvatar?: () => void;
  rightSlot?: React.ReactNode;
}

/**
 * Shared Muse-style companion header:
 * - Left: floating circular drawer button on mobile
 * - Center: circular AI avatar + Name pill (tapping starts in-place voice input)
 * - Right: optional compact icon action slot
 */
export const MuseAvatarHeader: React.FC<MuseAvatarHeaderProps> = ({
  agentProfile,
  isVoiceActive = false,
  onOpenDrawer,
  onTapAvatar,
  rightSlot,
}) => {
  const avatarSrc = agentProfile ? resolveAvatarSrc(agentProfile) : undefined;
  const aiName = agentProfile?.name || 'Relay';

  return (
    <div className="relative flex min-h-[76px] items-start justify-center pt-1">
      {onOpenDrawer && (
        <button
          type="button"
          onClick={onOpenDrawer}
          aria-label="菜单"
          className="absolute top-1 left-0 flex h-10 w-10 items-center justify-center rounded-full border border-black/[0.07] bg-white shadow-xs transition-colors hover:bg-zinc-50 active:scale-95 dark:border-white/10 dark:bg-zinc-900 lg:hidden"
        >
          <NavMenuIcon className="h-[18px] w-[18px]" />
        </button>
      )}

      <motion.button
        type="button"
        whileTap={{ scale: 0.94 }}
        onClick={onTapAvatar}
        aria-label="点击语音对话"
        className="group relative flex flex-col items-center focus:outline-none"
      >
        <div className="relative">
          {isVoiceActive && (
            <span className="pointer-events-none absolute -inset-1.5 rounded-full bg-sky-400/25 animate-ping" />
          )}
          {avatarSrc ? (
            <img
              src={avatarSrc}
              alt={aiName}
              className={`relative h-14 w-14 rounded-full object-cover shadow-sm ring-2 transition-all ${
                isVoiceActive
                  ? 'ring-sky-500 shadow-sky-500/25'
                  : 'ring-white group-hover:ring-sky-300/80 dark:ring-zinc-800'
              }`}
            />
          ) : (
            <div
              className={`relative flex h-14 w-14 items-center justify-center rounded-full border bg-white text-sm font-semibold text-zinc-800 shadow-sm dark:bg-zinc-900 dark:text-zinc-100 ${
                isVoiceActive
                  ? 'border-sky-500 ring-2 ring-sky-400/40'
                  : 'border-black/[0.08] dark:border-white/10'
              }`}
            >
              {aiName.slice(0, 2)}
            </div>
          )}

          {/* Subtle mic badge signaling one-tap voice input */}
          <span
            className={`absolute -right-0.5 bottom-0.5 flex h-5 w-5 items-center justify-center rounded-full border shadow-xs transition-colors ${
              isVoiceActive
                ? 'border-sky-500 bg-sky-500 text-white'
                : 'border-black/[0.07] bg-white text-sky-600 dark:border-white/12 dark:bg-zinc-900 dark:text-sky-400'
            }`}
          >
            <Microphone weight={isVoiceActive ? 'fill' : 'duotone'} className="h-3 w-3" />
          </span>
        </div>

        <span className="-mt-1.5 relative z-10 rounded-full border border-black/[0.07] bg-white px-2.5 py-0.5 text-[11px] font-medium text-[var(--relay-text)] shadow-xs dark:border-white/12 dark:bg-zinc-900">
          {aiName}
        </span>
      </motion.button>

      {rightSlot && (
        <div className="absolute top-1 right-0 flex items-center gap-1.5">{rightSlot}</div>
      )}
    </div>
  );
};
