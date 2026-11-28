import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  DeviceMobile,
  FolderOpen,
  Heart,
  Laptop,
} from './AppIcons';

export type LibraryPopoverDestination = 'devices' | 'health' | 'files' | 'phone';

interface LibraryFloatingPopoverProps {
  open: boolean;
  activeDestination?: LibraryPopoverDestination | null;
  onClose: () => void;
  onSelect: (dest: LibraryPopoverDestination) => void;
  variant?: 'mobile-bottom' | 'desktop-sidebar';
}

const POPOVER_ITEMS: {
  key: LibraryPopoverDestination;
  label: string;
  Icon: React.ComponentType<{ className?: string; weight?: 'regular' | 'fill' | 'bold' }>;
}[] = [
  { key: 'devices', label: '设备', Icon: Laptop },
  { key: 'health', label: '健康', Icon: Heart },
  { key: 'files', label: '文件', Icon: FolderOpen },
  { key: 'phone', label: '手机', Icon: DeviceMobile },
];

/**
 * Compact Muse-style floating Library popover matching the user's sketch
 * (left column, 2nd frame): floats directly above the bottom navigation bar
 * with crisp monochrome icons without obscuring the active screen.
 */
export const LibraryFloatingPopover: React.FC<LibraryFloatingPopoverProps> = ({
  open,
  activeDestination,
  onClose,
  onSelect,
  variant = 'mobile-bottom',
}) => {
  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Transparent click-away layer so underlying screen stays completely visible */}
          <div
            onClick={onClose}
            aria-hidden="true"
            className="fixed inset-0 z-40"
          />

          <motion.div
            role="dialog"
            aria-label="Library 快捷面板"
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 440, damping: 32 }}
            className={
              variant === 'mobile-bottom'
                ? 'fixed inset-x-0 bottom-[74px] z-50 mx-auto w-[calc(100%-28px)] max-w-[440px] pb-safe lg:hidden'
                : 'fixed bottom-20 left-[290px] z-50 hidden w-[320px] lg:block'
            }
          >
            <div className="rounded-[24px] border border-black/[0.08] bg-white/98 p-3.5 shadow-[0_14px_38px_-10px_rgba(15,23,42,0.16),0_2px_6px_rgba(15,23,42,0.05)] backdrop-blur-md dark:border-white/12 dark:bg-[#171B22]/98">
              <div className="grid grid-cols-4 gap-2">
                {POPOVER_ITEMS.map(({ key, label, Icon }) => {
                  const isSelected = activeDestination === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        onSelect(key);
                        onClose();
                      }}
                      aria-label={label}
                      className={`flex min-h-[60px] flex-col items-center justify-center gap-1.5 rounded-[18px] transition-colors active:scale-95 ${
                        isSelected
                          ? 'bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950'
                          : 'bg-zinc-50 text-zinc-800 hover:bg-zinc-100 dark:bg-zinc-800/80 dark:text-zinc-200 dark:hover:bg-zinc-800'
                      }`}
                    >
                      <Icon
                        weight={isSelected ? 'fill' : 'regular'}
                        className="h-[22px] w-[22px]"
                      />
                      <span className="text-[11px] font-medium leading-none">
                        {label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
