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
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 backdrop-blur-sm sm:items-center sm:p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 28, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            onClick={(e) => e.stopPropagation()}
            className="mac-card flex max-h-[88vh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl border border-stone-200/80 dark:border-zinc-800 sm:rounded-3xl"
          >
            <div className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-stone-300 dark:bg-zinc-700 sm:hidden" />

            <div className="flex items-center justify-between border-b border-stone-200/70 px-5 py-3.5 dark:border-zinc-800/80">
              <h2 className="text-[15px] font-semibold text-zinc-950 dark:text-zinc-50">
                设置与个性化
              </h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="关闭设置"
                className="flex h-9 w-9 items-center justify-center rounded-xl text-zinc-500 transition-colors hover:bg-stone-200/60 dark:hover:bg-zinc-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
              {/* Section 1: Assistant Avatar & Name */}
              <section className="space-y-3.5">
                <div className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                  助理形象与名称
                </div>

                <div className="flex items-center gap-3.5">
                  <div className="relative shrink-0">
                    <img
                      src={currentAvatarSrc}
                      alt={profile.name}
                      className="h-14 w-14 rounded-full object-cover ring-2 ring-white shadow-sm dark:ring-zinc-800"
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
                      className="absolute -right-1 -bottom-1 flex h-6 w-6 items-center justify-center rounded-full bg-zinc-950 text-white shadow-sm transition-transform hover:scale-105 dark:bg-[#1B6EF3]"
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
                      placeholder="助理名称（如 Relay、Muse）"
                      className="min-h-[38px] w-full rounded-xl border border-stone-200/90 bg-[#F8F7F4] px-3 py-1.5 text-sm font-medium text-zinc-900 focus:border-[#1B6EF3] focus:bg-white focus:outline-none dark:border-zinc-700 dark:bg-[#0E0F12] dark:text-zinc-100"
                    />
                    <input
                      type="text"
                      value={subtitleDraft}
                      onChange={(e) => setSubtitleDraft(e.target.value)}
                      onBlur={handleSaveName}
                      onKeyDown={(e) => e.key === 'Enter' && handleSaveName()}
                      placeholder="一句话简介"
                      className="min-h-[34px] w-full rounded-xl border border-stone-200/90 bg-[#F8F7F4] px-3 py-1 text-xs text-zinc-600 focus:border-[#1B6EF3] focus:bg-white focus:outline-none dark:border-zinc-700 dark:bg-[#0E0F12] dark:text-zinc-300"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-2 pt-1">
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
                        className={`flex flex-col items-center gap-1.5 rounded-2xl border p-2 transition-all ${
                          selected
                            ? 'border-[#1B6EF3] bg-blue-50/50 dark:bg-blue-950/30'
                            : 'border-stone-200/80 bg-white/60 hover:border-stone-300 dark:border-zinc-800 dark:bg-zinc-900/60'
                        }`}
                      >
                        <div className="relative">
                          <img
                            src={preset.src}
                            alt={preset.label}
                            className="h-10 w-10 rounded-full object-cover"
                          />
                          {selected && (
                            <span className="absolute -right-0.5 -bottom-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-[#1B6EF3] text-white">
                              <Check className="h-2.5 w-2.5" />
                            </span>
                          )}
                        </div>
                        <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-300">
                          {preset.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>

              {/* Section 2: Appearance Light/Dark */}
              <section className="space-y-2.5 border-t border-stone-200/70 pt-5 dark:border-zinc-800/80">
                <div className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                  外观主题
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => onToggleDarkMode(false)}
                    className={`flex min-h-[48px] items-center justify-center gap-2 rounded-2xl border px-3 py-2.5 text-xs font-medium transition-all ${
                      !darkMode
                        ? 'border-[#1B6EF3] bg-white text-zinc-950 shadow-xs dark:bg-zinc-800 dark:text-zinc-50'
                        : 'border-stone-200/80 bg-[#F8F7F4]/70 text-zinc-500 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-400'
                    }`}
                  >
                    <Sun className="h-4 w-4 text-amber-500" />
                    <span>浅色暖白</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onToggleDarkMode(true)}
                    className={`flex min-h-[48px] items-center justify-center gap-2 rounded-2xl border px-3 py-2.5 text-xs font-medium transition-all ${
                      darkMode
                        ? 'border-[#1B6EF3] bg-[#1C1F26] text-zinc-50 shadow-xs'
                        : 'border-stone-200/80 bg-[#F8F7F4]/70 text-zinc-500 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-400'
                    }`}
                  >
                    <Moon className="h-4 w-4 text-blue-400" />
                    <span>深色曜石</span>
                  </button>
                </div>
              </section>

              {/* Section 3: Connection & Tailscale Protocol */}
              <section className="space-y-2.5 border-t border-stone-200/70 pt-5 dark:border-zinc-800/80">
                <div className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                  云端通道与协议
                </div>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenConnection();
                  }}
                  className="flex min-h-[54px] w-full items-center justify-between gap-3 rounded-2xl border border-stone-200/90 bg-white/80 px-4 py-3 text-left transition-colors hover:border-[#1B6EF3]/60 dark:border-zinc-800 dark:bg-[#181A20] dark:hover:border-blue-500/60"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-[#1B6EF3] dark:bg-blue-950/50 dark:text-blue-400">
                      <Link2 className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                        {config.mode === 'sandbox'
                          ? '本地体验模式'
                          : config.mode === 'dsh-bridge'
                            ? 'DeepSeek Harness · Tailscale'
                            : 'OpenAI 兼容接口'}
                      </div>
                      <div className="mt-0.5 truncate font-mono-tabular text-[11px] text-zinc-400">
                        {config.serverUrl || '点击配置服务器地址与会话参数'}
                      </div>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-zinc-400" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenDeviceHub();
                  }}
                  className="flex min-h-[54px] w-full items-center justify-between gap-3 rounded-2xl border border-stone-200/90 bg-white/80 px-4 py-3 text-left transition-colors hover:border-[#1B6EF3]/60 dark:border-zinc-800 dark:bg-[#181A20] dark:hover:border-blue-500/60"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400">
                      <Smartphone className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                        手机系统能力与权限接入
                      </div>
                      <div className="mt-0.5 truncate text-[11px] text-zinc-400">
                        剪贴板 · 日历 · 闹钟 · 通知监听 · 短信 · 定位 · 文件
                      </div>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-zinc-400" />
                </button>
              </section>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
