import React, { useState } from 'react';
import { Bell } from '@phosphor-icons/react/dist/csr/Bell';
import { BookOpen } from '@phosphor-icons/react/dist/csr/BookOpen';
import { Compass } from '@phosphor-icons/react/dist/csr/Compass';
import { Newspaper } from '@phosphor-icons/react/dist/csr/Newspaper';
import { PushPin } from '@phosphor-icons/react/dist/csr/PushPin';
import paper3dUrl from '../assets/images/feed_icon_paper_1795867366696.jpg';
import reminder3dUrl from '../assets/images/feed_icon_reminder_1795867368055.jpg';
import dispatch3dUrl from '../assets/images/feed_icon_dispatch_1795867368132.jpg';
import urgent3dUrl from '../assets/images/feed_icon_urgent_1795867370033.jpg';
import goal3dUrl from '../assets/images/feed_icon_goal_1795867371552.jpg';

export type Feed3DIconKind = 'paper' | 'news' | 'reminder' | 'urgent' | 'goal';

/**
 * Curated matte-clay isometric 3D icon registry strictly for Feed report & reminder cards.
 * Swap any URL in this map to customize the 3D card illustrations.
 */
export const FEED_3D_ICON_LIBRARY: Record<
  Feed3DIconKind,
  { src: string; alt: string }
> = {
  paper: {
    src: paper3dUrl,
    alt: '论文汇报',
  },
  news: {
    src: dispatch3dUrl,
    alt: '动态简报',
  },
  reminder: {
    src: reminder3dUrl,
    alt: '提醒事项',
  },
  urgent: {
    src: urgent3dUrl,
    alt: '重点提醒',
  },
  goal: {
    src: goal3dUrl,
    alt: '目标进度',
  },
};

interface Feed3DIconProps {
  kind: Feed3DIconKind;
  size?: number;
  className?: string;
}

export const Feed3DIcon: React.FC<Feed3DIconProps> = ({
  kind,
  size = 40,
  className = '',
}) => {
  const [failed, setFailed] = useState(false);
  const entry = FEED_3D_ICON_LIBRARY[kind];

  if (failed) {
    const FallbackIcon =
      kind === 'paper'
        ? BookOpen
        : kind === 'news'
          ? Newspaper
          : kind === 'urgent'
            ? PushPin
            : kind === 'goal'
              ? Compass
              : Bell;
    return (
      <span
        style={{ width: size, height: size }}
        className={`flex shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 ${className}`}
      >
        <FallbackIcon weight="regular" className="h-5 w-5" />
      </span>
    );
  }

  return (
    <span
      style={{ width: size, height: size }}
      className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white dark:bg-zinc-100/95 ${className}`}
    >
      <img
        src={entry.src}
        alt={entry.alt}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="h-full w-full object-contain scale-[1.12] mix-blend-multiply select-none"
        draggable={false}
      />
    </span>
  );
};
