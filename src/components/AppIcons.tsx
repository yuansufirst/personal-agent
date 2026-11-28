import React from 'react';
import {
  Alarm,
  Archive,
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  ArrowsClockwise,
  Article,
  Bell,
  BookmarkSimple,
  BookOpenText,
  Brain,
  CalendarBlank,
  ChatCircleDots,
  ChatTeardropDots,
  CheckCircle,
  ClipboardText,
  Clock,
  CloudCheck,
  Coffee,
  Coins,
  Compass,
  DeviceMobile,
  Drop,
  FileText,
  FolderOpen,
  Footprints,
  GearSix,
  HardDrives,
  Heart,
  Heartbeat,
  Image as PhImage,
  Laptop,
  Lightning,
  List,
  MapPinArea,
  Microphone,
  MoonStars,
  NewspaperClipping,
  PaperPlaneTilt,
  Plus,
  Shapes,
  SlidersHorizontal,
  SneakerMove,
  Sparkle,
  SquaresFour,
  Star,
  Stop,
  Sun,
  Target,
  TerminalWindow,
  Trash,
} from '@phosphor-icons/react';

export interface AppIconProps {
  className?: string;
  active?: boolean;
}

/**
 * Minimalist crisp monochrome icon registry across the app chrome (black & white aesthetic).
 * Colored tactile 3D illustrations are reserved exclusively for Feed cards in Feed3DIcons.tsx.
 */

const monoTone = (active?: boolean) =>
  active
    ? 'text-zinc-950 dark:text-white'
    : 'text-zinc-500 dark:text-zinc-400';

// ── Navigation Icons (Monochrome) ─────────────────────────────────────────────

export const NavChatIcon: React.FC<AppIconProps> = ({ className = 'h-5 w-5', active }) => (
  <ChatTeardropDots
    weight={active ? 'fill' : 'regular'}
    className={`${className} ${monoTone(active)}`}
  />
);

export const NavFeedsIcon: React.FC<AppIconProps> = ({ className = 'h-5 w-5', active }) => (
  <NewspaperClipping
    weight={active ? 'fill' : 'regular'}
    className={`${className} ${monoTone(active)}`}
  />
);

export const NavGoalsIcon: React.FC<AppIconProps> = ({ className = 'h-5 w-5', active }) => (
  <Target
    weight={active ? 'fill' : 'regular'}
    className={`${className} ${monoTone(active)}`}
  />
);

export const NavHealthIcon: React.FC<AppIconProps> = ({ className = 'h-5 w-5', active }) => (
  <Heart
    weight={active ? 'fill' : 'regular'}
    className={`${className} ${monoTone(active)}`}
  />
);

export const NavLibraryIcon: React.FC<AppIconProps> = ({ className = 'h-5 w-5', active }) => (
  <Shapes
    weight={active ? 'fill' : 'regular'}
    className={`${className} ${monoTone(active)}`}
  />
);

export const NavSettingsIcon: React.FC<AppIconProps> = ({ className = 'h-5 w-5' }) => (
  <GearSix weight="regular" className={`${className} text-zinc-700 dark:text-zinc-200`} />
);

export const NavMenuIcon: React.FC<AppIconProps> = ({ className = 'h-5 w-5' }) => (
  <List weight="bold" className={`${className} text-zinc-800 dark:text-zinc-100`} />
);

// ── Feed Utility Icons (Monochrome) ───────────────────────────────────────────

export const FeedPaperIcon: React.FC<AppIconProps> = ({ className = 'h-4 w-4', active }) => (
  <BookOpenText weight={active ? 'fill' : 'regular'} className={`${className} ${active ? 'text-current' : 'text-zinc-600 dark:text-zinc-300'}`} />
);

export const FeedReportIcon: React.FC<AppIconProps> = ({ className = 'h-4 w-4', active }) => (
  <Article weight={active ? 'fill' : 'regular'} className={`${className} ${active ? 'text-current' : 'text-zinc-600 dark:text-zinc-300'}`} />
);

export const FeedReminderIcon: React.FC<AppIconProps> = ({ className = 'h-4 w-4', active }) => (
  <Bell weight={active ? 'fill' : 'regular'} className={`${className} ${active ? 'text-current' : 'text-zinc-600 dark:text-zinc-300'}`} />
);

export const FeedAlertIcon: React.FC<AppIconProps> = ({ className = 'h-4 w-4', active }) => (
  <Lightning weight={active ? 'fill' : 'regular'} className={`${className} ${active ? 'text-current' : 'text-zinc-600 dark:text-zinc-300'}`} />
);

export const FeedSparkleIcon: React.FC<AppIconProps> = ({ className = 'h-4 w-4', active }) => (
  <Sparkle weight={active ? 'fill' : 'regular'} className={`${className} ${active ? 'text-current' : 'text-zinc-600 dark:text-zinc-300'}`} />
);

export const FeedBookmarkIcon: React.FC<AppIconProps> = ({ className = 'h-4 w-4', active }) => (
  <BookmarkSimple
    weight={active ? 'fill' : 'regular'}
    className={`${className} ${active ? 'text-zinc-950 dark:text-white' : 'text-zinc-400 dark:text-zinc-500'}`}
  />
);

export const FeedReplyIcon: React.FC<AppIconProps> = ({ className = 'h-4 w-4' }) => (
  <ChatCircleDots weight="regular" className={`${className} text-zinc-700 dark:text-zinc-200`} />
);

// ── Goals Category Icons (Monochrome) ─────────────────────────────────────────

export const GoalHealthIcon: React.FC<AppIconProps> = ({ className = 'h-5 w-5' }) => (
  <Heart weight="regular" className={`${className} text-zinc-800 dark:text-zinc-100`} />
);

export const GoalProductivityIcon: React.FC<AppIconProps> = ({ className = 'h-5 w-5' }) => (
  <Laptop weight="regular" className={`${className} text-zinc-800 dark:text-zinc-100`} />
);

export const GoalInterestIcon: React.FC<AppIconProps> = ({ className = 'h-5 w-5' }) => (
  <Compass weight="regular" className={`${className} text-zinc-800 dark:text-zinc-100`} />
);

export const GoalFinanceIcon: React.FC<AppIconProps> = ({ className = 'h-5 w-5' }) => (
  <Coins weight="regular" className={`${className} text-zinc-800 dark:text-zinc-100`} />
);

export const GoalOthersIcon: React.FC<AppIconProps> = ({ className = 'h-5 w-5' }) => (
  <Star weight="regular" className={`${className} text-zinc-800 dark:text-zinc-100`} />
);

// ── Health Metric Icons (Monochrome) ──────────────────────────────────────────

export const HealthSleepIcon: React.FC<AppIconProps> = ({ className = 'h-5 w-5' }) => (
  <MoonStars weight="regular" className={`${className} text-zinc-800 dark:text-zinc-100`} />
);

export const HealthExerciseIcon: React.FC<AppIconProps> = ({ className = 'h-5 w-5' }) => (
  <SneakerMove weight="regular" className={`${className} text-zinc-800 dark:text-zinc-100`} />
);

export const HealthWaterIcon: React.FC<AppIconProps> = ({ className = 'h-5 w-5' }) => (
  <Drop weight="regular" className={`${className} text-zinc-800 dark:text-zinc-100`} />
);

export const HealthStepsIcon: React.FC<AppIconProps> = ({ className = 'h-5 w-5' }) => (
  <Footprints weight="regular" className={`${className} text-zinc-800 dark:text-zinc-100`} />
);

export const HealthFocusIcon: React.FC<AppIconProps> = ({ className = 'h-5 w-5' }) => (
  <Brain weight="regular" className={`${className} text-zinc-800 dark:text-zinc-100`} />
);

export const HealthCaffeineIcon: React.FC<AppIconProps> = ({ className = 'h-5 w-5' }) => (
  <Coffee weight="regular" className={`${className} text-zinc-800 dark:text-zinc-100`} />
);

// ── Chat Composer & Space Utility Icons (Monochrome) ──────────────────────────

export const ComposerImageIcon: React.FC<AppIconProps> = ({ className = 'h-5 w-5' }) => (
  <PhImage weight="regular" className={`${className} text-zinc-800 dark:text-zinc-100`} />
);

export const ComposerFileIcon: React.FC<AppIconProps> = ({ className = 'h-5 w-5' }) => (
  <FolderOpen weight="regular" className={`${className} text-zinc-800 dark:text-zinc-100`} />
);

export const ComposerCardsIcon: React.FC<AppIconProps> = ({ className = 'h-5 w-5' }) => (
  <SquaresFour weight="regular" className={`${className} text-zinc-800 dark:text-zinc-100`} />
);

export const ComposerDeviceIcon: React.FC<AppIconProps> = ({ className = 'h-5 w-5' }) => (
  <DeviceMobile weight="regular" className={`${className} text-zinc-800 dark:text-zinc-100`} />
);

export const ComposerMicIcon: React.FC<AppIconProps> = ({ className = 'h-5 w-5' }) => (
  <Microphone weight="regular" className={`${className} text-zinc-800 dark:text-zinc-100`} />
);

export const SpaceCloudIcon: React.FC<AppIconProps> = ({ className = 'h-5 w-5' }) => (
  <CloudCheck weight="regular" className={`${className} text-zinc-800 dark:text-zinc-100`} />
);

export const SpaceDevicesIcon: React.FC<AppIconProps> = ({ className = 'h-5 w-5' }) => (
  <HardDrives weight="regular" className={`${className} text-zinc-800 dark:text-zinc-100`} />
);

export const SpaceArchiveIcon: React.FC<AppIconProps> = ({ className = 'h-5 w-5' }) => (
  <Archive weight="regular" className={`${className} text-zinc-800 dark:text-zinc-100`} />
);

export {
  Alarm,
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  ArrowsClockwise,
  CalendarBlank,
  CheckCircle,
  ClipboardText,
  Clock,
  DeviceMobile,
  FileText,
  FolderOpen,
  Heart,
  Heartbeat,
  Laptop,
  MapPinArea,
  Microphone,
  PaperPlaneTilt,
  Plus,
  SlidersHorizontal,
  Sparkle,
  Star,
  Stop,
  Sun,
  TerminalWindow,
  Trash,
};
