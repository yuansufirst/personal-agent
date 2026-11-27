import React, { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Camera,
  Check,
  ChevronRight,
  Link2,
  Moon,
  Smartphone,
  Sun,
  X,
} from 'lucide-react';
import type { AgentProfile, ConnectionConfig } from '../types/relay';
import { AVATAR_PRESETS, resolveAvatarSrc } from '../services/avatarPresets';
import { GranularDotMatrix } from './GranularDotMatrix';

interface SettingsModalProps {
  open: boolean;
  profile: AgentProfile;
  darkMode: boolean;
  config: ConnectionConfig;
  onClose: () => void;
  onUpdateProfile: (next: AgentProfile) => void;
  onToggleDarkMode: (dark: boolean) => void;
  onOpenConnection: () => void;
  onOpenDeviceHub: () => void;
  onShowToast: (msg: string) => void;
}

async function compressSquareAvatar(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('解析图片失败'));
      img.onload = () => {
        const size = 256;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(String(reader.result || ''));
          return;
        }
        const minSide = Math.min(img.width, img.height);
        const sx = (img.width - minSide) / 2;
        const sy = (img.height - minSide) / 2;
        ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  open,
  profile,
  darkMode,
  config,
  onClose,
  onUpdateProfile,
  onToggleDarkMode,
  onOpenConnection,
  onOpenDeviceHub,
  onShowToast,
}) => {
  const [nameDraft, setNameDraft] = useState(profile.name);
  const [subtitleDraft, setSubtitleDraft] = useState(profile.subtitle);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    if (open) {
      setNameDraft(profile.name);
      setSubtitleDraft(profile.subtitle);
    }
  }, [open, profile.name, profile.subtitle]);

  const currentAvatarSrc = resolveAvatarSrc(profile);

  const handleSaveName = () => {
    const cleanName = nameDraft.trim() || 'Relay';
    const cleanSubtitle = subtitleDraft.trim() || '私人 AI 助理';
    if (cleanName !== profile.name || cleanSubtitle !== profile.subtitle) {
      onUpdateProfile({
        ...profile,
        name: cleanName,
        subtitle: cleanSubtitle,
      });
      onShowToast('已更新助理名称与简介');
    }
  };

  const handleUploadAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const dataUrl = await compressSquareAvatar(file);
      onUpdateProfile({
        ...profile,
        avatarId: 'custom',
        customAvatarUrl: dataUrl,
      });
      onShowToast('已更换自定义助理头像');
    } catch (err) {
      onShowToast(err instanceof Error ? err.message : '上传头像失败');
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 28, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            onClick={(e) => e.stopPropagation()}
            className="board-backdrop flex max-h-[88vh] w-full max-w-md flex-col overflow-hidden rounded-t-[28px] border border-[var(--relay-tile-border)] text-[var(--relay-text)] shadow-2xl sm:rounded-[28px]"
          >
            <div className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-white/25 sm:hidden" />

            {/* Flush Header */}
            <div className="flex items-center justify-between border-b border-[var(--relay-tile-border)]/50 px-5 py-3.5">
              <h2 className="text-[15px] font-semibold tracking-tight text-[var(--relay-text)]">
                设置
              </h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="关闭设置"
                className="flex h-9 w-9 items-center justify-center rounded-xl text-[var(--relay-text-muted)] transition-colors hover:bg-white/10 hover:text-[var(--relay-text)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
              {/* Profile Hero Granular Magnetic Tile */}
              <section
                className="settings-grain-tile rounded-[22px] p-4"
                style={
                  {
                    '--tile-tint': 'var(--tint-blue)',
                    '--tile-angle': '172deg',
                  } as React.CSSProperties
                }
              >
                <GranularDotMatrix pitch={8.5} bandStart={0.44} bandEnd={0.86} />
                <div className="relative z-10 space-y-3.5">
                  <div className="flex items-center gap-3.5">
                    <div className="relative shrink-0">
                      <img
                        src={currentAvatarSrc}
                        alt={profile.name}
                        className="h-14 w-14 rounded-full object-cover ring-2 ring-white/40 shadow-md"
                      />
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => void handleUploadAvatar(e)}
                      />
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        aria-label="上传自定义头像"
                        className="absolute -right-1 -bottom-1 flex h-6 w-6 items-center justify-center rounded-full bg-white text-[#0D1017] shadow-md transition-transform hover:scale-105"
                      >
                        <Camera className="h-3 w-3" />
                      </button>
                    </div>

                    <div className="min-w-0 flex-1 space-y-2">
                      <input
                        type="text"
                        value={nameDraft}
                        onChange={(e) => setNameDraft(e.target.value)}
                        onBlur={handleSaveName}
                        onKeyDown={(e) => e.key === 'Enter' && handleSaveName()}
                        placeholder="助理名称"
                        className="min-h-[38px] w-full rounded-xl border border-white/15 bg-black/45 px-3 py-1.5 text-sm font-medium text-[var(--relay-text)] backdrop-blur-xs focus:border-white/45 focus:outline-none"
                      />
                      <input
                        type="text"
                        value={subtitleDraft}
                        onChange={(e) => setSubtitleDraft(e.target.value)}
                        onBlur={handleSaveName}
                        onKeyDown={(e) => e.key === 'Enter' && handleSaveName()}
                        placeholder="简介"
                        className="min-h-[34px] w-full rounded-xl border border-white/12 bg-black/45 px-3 py-1 text-xs text-[var(--relay-text-muted)] backdrop-blur-xs focus:border-white/40 focus:outline-none"
                      />
                    </div>
                  </div>

                  {/* 4 Avatar Preset Mini Tiles */}
                  <div className="grid grid-cols-4 gap-2">
                    {AVATAR_PRESETS.map((preset) => {
                      const selected = profile.avatarId === preset.id;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => {
                            onUpdateProfile({ ...profile, avatarId: preset.id });
                            onShowToast(`已切换为「${preset.label}」头像`);
                          }}
                          className={`flex flex-col items-center gap-1.5 rounded-2xl border p-2 backdrop-blur-xs transition-all active:scale-95 ${
                            selected
                              ? 'border-white/50 bg-black/45 shadow-sm'
                              : 'border-white/12 bg-black/30 opacity-85 hover:opacity-100'
                          }`}
                        >
                          <div className="relative">
                            <img
                              src={preset.src}
                              alt={preset.label}
                              className="h-9 w-9 rounded-full object-cover"
                            />
                            {selected && (
                              <span className="absolute -right-0.5 -bottom-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-white text-[#0D1017]">
                                <Check className="h-2.5 w-2.5" />
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] font-medium text-[var(--relay-text-muted)]">
                            {preset.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </section>

              {/* Appearance 2-Tile Pair with Transition-Zone Black Square Matrix */}
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => onToggleDarkMode(false)}
                  style={
                    {
                      '--tile-tint': 'var(--tint-amber)',
                      '--tile-angle': '164deg',
                    } as React.CSSProperties
                  }
                  className={`settings-grain-tile flex min-h-[76px] flex-col items-center justify-center gap-1.5 rounded-[20px] p-3 text-xs font-medium active:scale-95 ${
                    !darkMode
                      ? 'mini-tile-active text-[var(--relay-text)]'
                      : 'text-[var(--relay-text-muted)]'
                  }`}
                >
                  <GranularDotMatrix pitch={9} />
                  <Sun className="relative z-10 h-5 w-5 text-[var(--accent-amber)]" />
                  <span className="relative z-10">浅色柔纸</span>
                </button>
                <button
                  type="button"
                  onClick={() => onToggleDarkMode(true)}
                  style={
                    {
                      '--tile-tint': 'var(--tint-violet)',
                      '--tile-angle': '192deg',
                    } as React.CSSProperties
                  }
                  className={`settings-grain-tile flex min-h-[76px] flex-col items-center justify-center gap-1.5 rounded-[20px] p-3 text-xs font-medium active:scale-95 ${
                    darkMode
                      ? 'mini-tile-active text-[var(--relay-text)]'
                      : 'text-[var(--relay-text-muted)]'
                  }`}
                >
                  <GranularDotMatrix pitch={9} />
                  <Moon className="relative z-10 h-5 w-5 text-[var(--accent-indigo)]" />
                  <span className="relative z-10">暗夜底辉</span>
                </button>
              </div>

              {/* Channel & Device Capability Granular Magnetic Tiles */}
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenConnection();
                }}
                style={
                  {
                    '--tile-tint': 'var(--tint-cyan)',
                    '--tile-angle': '184deg',
                  } as React.CSSProperties
                }
                className="settings-grain-tile flex min-h-[70px] w-full items-center justify-between gap-3 rounded-[20px] px-4 py-3 text-left active:scale-[0.98]"
              >
                <GranularDotMatrix pitch={9} />
                <div className="relative z-10 flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-black/45 text-[var(--accent-sky)] backdrop-blur-xs">
                    <Link2 className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-[var(--relay-text)]">
                      {config.mode === 'sandbox'
                        ? '本地体验模式'
                        : config.mode === 'dsh-bridge'
                          ? 'DeepSeek Harness · 通道'
                          : 'OpenAI 兼容接口'}
                    </div>
                    <div className="mt-0.5 truncate font-mono-tabular text-[11px] text-[var(--relay-text-muted)]">
                      {config.serverUrl || '配置服务器地址'}
                    </div>
                  </div>
                </div>
                <ChevronRight className="relative z-10 h-4 w-4 shrink-0 text-[var(--relay-text-faint)]" />
              </button>

              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenDeviceHub();
                }}
                style={
                  {
                    '--tile-tint': 'var(--tint-emerald)',
                    '--tile-angle': '168deg',
                  } as React.CSSProperties
                }
                className="settings-grain-tile flex min-h-[70px] w-full items-center justify-between gap-3 rounded-[20px] px-4 py-3 text-left active:scale-[0.98]"
              >
                <GranularDotMatrix pitch={9} />
                <div className="relative z-10 flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-black/45 text-[var(--accent-mint)] backdrop-blur-xs">
                    <Smartphone className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-[var(--relay-text)]">
                      手机系统能力接入
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-[var(--relay-text-muted)]">
                      剪贴板 · 日历 · 闹钟 · 通知 · 定位 · 文件
                    </div>
                  </div>
                </div>
                <ChevronRight className="relative z-10 h-4 w-4 shrink-0 text-[var(--relay-text-faint)]" />
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
