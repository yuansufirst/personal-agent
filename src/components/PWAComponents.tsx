import React, { useState } from 'react';
import { Download, Smartphone, WifiOff, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

interface PWAInstallButtonProps {
  compact?: boolean;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ compact = false }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  const handleClick = async () => {
    if (isInstallable) {
      await install();
    } else {
      setShowGuide(true);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className={
          compact
            ? 'inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-800 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0'
            : 'flex w-full min-h-[44px] items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 dark:bg-blue-600 dark:hover:bg-blue-500 whitespace-nowrap shrink-0'
        }
      >
        <Download className="h-4 w-4 shrink-0" />
        <span>{isInstallable ? '安装到桌面' : '添加到手机桌面'}</span>
      </button>

      {showGuide && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 backdrop-blur-xs sm:items-center sm:p-4"
          onClick={() => setShowGuide(false)}
        >
          <div
            className="w-full max-w-md rounded-t-3xl bg-white p-6 dark:bg-[#131822] sm:rounded-2xl border border-slate-200/80 dark:border-slate-800"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-slate-300 dark:bg-slate-700 sm:hidden" />
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2.5">
                <Smartphone className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  安装 Relay 到手机桌面
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                aria-label="关闭"
                className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-3 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              {isIOS ? (
                <>
                  <p>1. 点击 Safari 底部工具栏的「分享」按钮。</p>
                  <p>2. 向下滑动并选择「添加到主屏幕」，即可全屏以独立 App 形态运行。</p>
                </>
              ) : (
                <>
                  <p>1. 在 Android Chrome / Edge 中点击右上角菜单按钮。</p>
                  <p>2. 选择「安装应用」或「添加到主屏幕」，即可全屏启动并支持离线缓存。</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    提示：部署到你的 Tailscale 节点并启用 Tailscale Serve HTTPS 后，Android Chrome 会自动触发原生一键安装弹窗。
                  </p>
                </>
              )}
            </div>

            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="mt-6 flex h-11 w-full items-center justify-center rounded-xl bg-slate-900 text-sm font-medium text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900"
            >
              知道了
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div className="fixed bottom-20 left-4 right-4 z-50 mx-auto flex max-w-md items-center justify-between gap-3 rounded-xl border border-amber-300/60 bg-amber-50 px-4 py-2.5 text-xs font-medium text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/90 dark:text-amber-100 lg:bottom-6 lg:left-6 lg:right-auto">
      <div className="flex items-center gap-2">
        <WifiOff className="h-4 w-4 shrink-0" />
        <span>当前处于离线状态 · 正在展示本地缓存数据</span>
      </div>
    </div>
  );
};
