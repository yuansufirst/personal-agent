import React, { useCallback, useEffect, useState } from 'react';
import {
  AlarmClock,
  ArrowUpRight,
  Bell,
  Calendar,
  Check,
  Clipboard,
  Clock,
  Copy,
  FileText,
  FolderOpen,
  MapPin,
  MessageSquareText,
  RefreshCw,
  Send,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type { DeviceCapabilityKey, DeviceContextConfig } from '../types/relay';
import {
  AGENT_DEVICE_PROTOCOL_PROMPT,
  captureCapabilityContext,
  clearDeviceNotifications,
  createDeviceCalendarEvent,
  getDeviceCalendarEvents,
  getDeviceLocation,
  getDeviceNotifications,
  getDevicePermissions,
  getDeviceRecentSms,
  getDeviceStatusSnapshot,
  hasNativeDeviceBridge,
  listDeviceFolderFiles,
  openDeviceNotificationSettings,
  pickDeviceFolder,
  readDeviceClipboard,
  readDeviceFileText,
  requestDevicePermission,
  setDeviceAlarm,
  setDeviceTimer,
  writeDeviceClipboard,
  type DeviceCalendarEvent,
  type DeviceFileEntry,
  type DeviceLocationSnapshot,
  type DeviceNotificationItem,
  type DevicePermissionStatus,
  type DeviceSmsItem,
  type DeviceStatusSnapshot,
} from '../services/deviceBridge';

interface DeviceHubViewProps {
  contextConfig: DeviceContextConfig;
  onUpdateContextConfig: (next: DeviceContextConfig) => void;
  onSendContextToAgent: (promptText: string) => void;
  onShowToast: (msg: string) => void;
}

function formatTs(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(
    2,
    '0'
  )} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const DeviceHubView: React.FC<DeviceHubViewProps> = ({
  contextConfig,
  onUpdateContextConfig,
  onSendContextToAgent,
  onShowToast,
}) => {
  const isNative = hasNativeDeviceBridge();

  const [perms, setPerms] = useState<DevicePermissionStatus>({
    time: true,
    clipboard: true,
    calendar: false,
    alarm: isNative,
    notifications: false,
    sms: false,
    location: false,
    files: false,
    folderLabel: '',
  });

  const [statusSnap, setStatusSnap] = useState<DeviceStatusSnapshot | null>(null);
  const [clipboardText, setClipboardText] = useState<string>('');
  const [calendarEvents, setCalendarEvents] = useState<DeviceCalendarEvent[]>([]);
  const [notifications, setNotifications] = useState<DeviceNotificationItem[]>([]);
  const [smsList, setSmsList] = useState<DeviceSmsItem[]>([]);
  const [locationSnap, setLocationSnap] = useState<DeviceLocationSnapshot | null>(null);
  const [folderFiles, setFolderFiles] = useState<DeviceFileEntry[]>([]);
  const [folderLabel, setFolderLabel] = useState<string>('');

  // Quick Alarm & Calendar inputs
  const [alarmTime, setAlarmTime] = useState('07:30');
  const [alarmLabel, setAlarmLabel] = useState('起床');
  const [eventTitle, setEventTitle] = useState('');
  const [eventTime, setEventTime] = useState('15:00');
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [copiedPrompt, setCopiedPrompt] = useState(false);

  const refreshOverview = useCallback(async () => {
    setLoadingKey('overview');
    try {
      const [p, s] = await Promise.all([getDevicePermissions(), getDeviceStatusSnapshot()]);
      setPerms(p);
      setStatusSnap(s);
      if (p.folderLabel) setFolderLabel(p.folderLabel);
      if (p.notifications && isNative) {
        const res = await getDeviceNotifications(15);
        setNotifications(res.notifications);
      }
    } catch {
      // ignore initial read issues
    } finally {
      setLoadingKey(null);
    }
  }, [isNative]);

  useEffect(() => {
    void refreshOverview();
  }, [refreshOverview]);

  const handleRequestPerm = async (cap: DeviceCapabilityKey) => {
    setLoadingKey(cap);
    try {
      if (cap === 'notifications') {
        await openDeviceNotificationSettings();
        onShowToast('请在系统设置中勾选开启「Relay 通知感知服务」，返回后刷新状态');
        return;
      }
      if (cap === 'files') {
        const res = await pickDeviceFolder();
        if (res.granted) {
          setPerms((prev) => ({ ...prev, files: true, folderLabel: res.folderLabel }));
          setFolderLabel(res.folderLabel || '');
          const listed = await listDeviceFolderFiles(30);
          setFolderFiles(listed.files);
          onShowToast(`已授权手机目录：${res.folderLabel || '文件夹'}`);
        }
        return;
      }
      const res = await requestDevicePermission(cap);
      setPerms((prev) => ({ ...prev, [cap]: res.granted }));
      onShowToast(res.granted ? '权限已授予' : '未授予权限，可前往系统设置开启');
    } catch (err) {
      onShowToast(err instanceof Error ? err.message : '申请权限失败');
    } finally {
      setLoadingKey(null);
    }
  };

  const handleReadClipboard = async () => {
    setLoadingKey('clipboard');
    try {
      const text = await readDeviceClipboard();
      setClipboardText(text);
      onShowToast(text ? '已读取手机剪贴板' : '剪贴板当前为空');
    } catch (err) {
      onShowToast(err instanceof Error ? err.message : '读取剪贴板失败');
    } finally {
      setLoadingKey(null);
    }
  };

  const handleLoadCalendar = async () => {
    setLoadingKey('calendar');
    try {
      const events = await getDeviceCalendarEvents(7, 20);
      setCalendarEvents(events);
      setPerms((prev) => ({ ...prev, calendar: true }));
      onShowToast(`已读取未来 7 天共 ${events.length} 条系统日程`);
    } catch (err) {
      onShowToast(err instanceof Error ? err.message : '读取系统日历失败');
    } finally {
      setLoadingKey(null);
    }
  };

  const handleAddQuickCalendarEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = eventTitle.trim();
    if (!title) return;
    setLoadingKey('calendar-add');
    try {
      const [hh, mm] = eventTime.split(':').map(Number);
      const start = new Date();
      start.setHours(Number.isNaN(hh) ? 15 : hh, Number.isNaN(mm) ? 0 : mm, 0, 0);
      if (start.getTime() < Date.now() - 5 * 60_000) {
        start.setDate(start.getDate() + 1);
      }
      const res = await createDeviceCalendarEvent({
        title,
        startMs: start.getTime(),
        endMs: start.getTime() + 3600_000,
        reminderMinutes: 15,
      });
      setEventTitle('');
      onShowToast(
        res.mode === 'direct' ? `已写入系统日历：「${title}」` : `已打开系统日历添加「${title}」`
      );
      void handleLoadCalendar();
    } catch (err) {
      onShowToast(err instanceof Error ? err.message : '写入日历失败');
    } finally {
      setLoadingKey(null);
    }
  };

  const handleSetQuickAlarm = async (e: React.FormEvent) => {
    e.preventDefault();
    const [hh, mm] = alarmTime.split(':').map(Number);
    if (Number.isNaN(hh) || Number.isNaN(mm)) return;
    setLoadingKey('alarm');
    try {
      await setDeviceAlarm({
        hour: hh,
        minute: mm,
        message: alarmLabel.trim() || 'Relay 提醒',
        skipUi: true,
      });
      onShowToast(`已创建系统闹钟 ${alarmTime}（${alarmLabel.trim() || 'Relay 提醒'}）`);
    } catch (err) {
      onShowToast(err instanceof Error ? err.message : '设置闹钟失败');
    } finally {
      setLoadingKey(null);
    }
  };

  const handleQuickTimer = async (minutes: number) => {
    setLoadingKey('alarm');
    try {
      await setDeviceTimer({ seconds: minutes * 60, message: `Relay ${minutes} 分钟倒计时`, skipUi: true });
      onShowToast(`已启动系统 ${minutes} 分钟倒计时`);
    } catch (err) {
      onShowToast(err instanceof Error ? err.message : '启动倒计时失败');
    } finally {
      setLoadingKey(null);
    }
  };

  const handleLoadNotifications = async () => {
    setLoadingKey('notifications');
    try {
      const res = await getDeviceNotifications(25);
      setPerms((prev) => ({ ...prev, notifications: res.enabled }));
      setNotifications(res.notifications);
      if (!res.enabled) {
        onShowToast('尚未开启系统「通知使用权」，请先点击右侧开启');
      } else {
        onShowToast(`已刷新 ${res.notifications.length} 条系统通知`);
      }
    } catch (err) {
      onShowToast(err instanceof Error ? err.message : '读取通知失败');
    } finally {
      setLoadingKey(null);
    }
  };

  const handleLoadSms = async () => {
    setLoadingKey('sms');
    try {
      const list = await getDeviceRecentSms(15);
      setPerms((prev) => ({ ...prev, sms: true }));
      setSmsList(list);
      onShowToast(`已读取最近 ${list.length} 条短信`);
    } catch (err) {
      onShowToast(err instanceof Error ? err.message : '读取短信失败');
    } finally {
      setLoadingKey(null);
    }
  };

  const handleLoadLocation = async () => {
    setLoadingKey('location');
    try {
      const loc = await getDeviceLocation();
      setPerms((prev) => ({ ...prev, location: true }));
      setLocationSnap(loc);
      onShowToast('已更新当前位置');
    } catch (err) {
      onShowToast(err instanceof Error ? err.message : '获取定位失败');
    } finally {
      setLoadingKey(null);
    }
  };

  const handleLoadFiles = async () => {
    setLoadingKey('files');
    try {
      const res = await listDeviceFolderFiles(30);
      setFolderLabel(res.folderLabel);
      setFolderFiles(res.files);
      setPerms((prev) => ({ ...prev, files: true, folderLabel: res.folderLabel }));
      onShowToast(`已加载目录「${res.folderLabel}」内 ${res.files.length} 项`);
    } catch (err) {
      onShowToast(err instanceof Error ? err.message : '读取目录失败');
    } finally {
      setLoadingKey(null);
    }
  };

  const handleReadAndSendFile = async (file: DeviceFileEntry) => {
    if (file.isDirectory) {
      onShowToast('暂支持直接读取授权根目录下的文本/笔记文件');
      return;
    }
    setLoadingKey(`file-${file.documentId}`);
    try {
      const res = await readDeviceFileText(file.uri, 65536);
      const prompt = `我从手机本地目录读取了文件「${file.name}」${res.truncated ? '（已截取前 64KB）' : ''}，请帮我分析总结：\n\n\`\`\`\n${res.content}\n\`\`\``;
      onSendContextToAgent(prompt);
    } catch (err) {
      onShowToast(err instanceof Error ? err.message : '读取文件失败');
    } finally {
      setLoadingKey(null);
    }
  };

  const handleSendCapabilityToAgent = async (cap: DeviceCapabilityKey, followUp: string) => {
    setLoadingKey(`send-${cap}`);
    try {
      const snap = await captureCapabilityContext(cap);
      onSendContextToAgent(`${snap.text}\n\n${followUp}`);
    } catch (err) {
      onShowToast(err instanceof Error ? err.message : '采集设备上下文失败');
    } finally {
      setLoadingKey(null);
    }
  };

  const handleCopyProtocolPrompt = async () => {
    try {
      await writeDeviceClipboard(AGENT_DEVICE_PROTOCOL_PROMPT, 'Relay Agent Protocol');
      setCopiedPrompt(true);
      onShowToast('已复制云端 DSH Agent 手机接入协议，可直接发给你的助理');
      window.setTimeout(() => setCopiedPrompt(false), 2000);
    } catch {
      onShowToast('复制失败，请稍后重试');
    }
  };

  const autoContextToggles: {
    key: keyof DeviceContextConfig;
    label: string;
    hint: string;
  }[] = [
    { key: 'autoAttachTime', label: '本地时间与电量', hint: '极轻负载，推荐常开' },
    { key: 'autoAttachCalendar', label: '近 3 天系统日程', hint: '对话时自动感知会议安排' },
    { key: 'autoAttachClipboard', label: '当前剪贴板', hint: '自动带上刚复制的文本' },
    { key: 'autoAttachLocation', label: '当前位置', hint: '出行与本地场景感知' },
    { key: 'autoAttachNotifications', label: '近期应用通知', hint: '借鉴 Today 主动情境感知' },
  ];

  return (
    <div className="space-y-5">
      {/* Live Device Telemetry & Environment Banner */}
      <div className="mac-card rounded-3xl p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-[#1B6EF3] dark:bg-blue-950/50 dark:text-blue-400">
              <Smartphone className="h-5 w-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                  Android 端侧感知与执行桥
                </h2>
                <span
                  className={`rounded-lg px-2 py-0.5 text-[11px] font-medium ${
                    isNative
                      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400'
                      : 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400'
                  }`}
                >
                  {isNative ? 'APK 原生桥已激活' : '网页预览模式（完整权限需装 APK）'}
                </span>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                借鉴 Today 的端云协同理念：由你按需授权手机系统能力，所有数据仅保存在本机或直连你的私人云端 DSH Agent。
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void refreshOverview()}
            disabled={loadingKey === 'overview'}
            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-3 text-xs font-medium text-zinc-700 hover:bg-stone-50 dark:border-zinc-700 dark:bg-[#181A20] dark:text-zinc-200"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loadingKey === 'overview' ? 'animate-spin' : ''}`} />
            <span>刷新状态</span>
          </button>
        </div>

        {statusSnap && (
          <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <div className="rounded-2xl bg-[#F8F7F4] px-3 py-2.5 dark:bg-[#0E0F12]">
              <div className="text-[11px] text-zinc-400">本地时间</div>
              <div className="mt-0.5 truncate font-mono-tabular text-xs font-medium text-zinc-900 dark:text-zinc-100">
                {statusSnap.readableTime}
              </div>
            </div>
            <div className="rounded-2xl bg-[#F8F7F4] px-3 py-2.5 dark:bg-[#0E0F12]">
              <div className="text-[11px] text-zinc-400">设备型号</div>
              <div className="mt-0.5 truncate text-xs font-medium text-zinc-900 dark:text-zinc-100">
                {statusSnap.deviceModel}
              </div>
            </div>
            <div className="rounded-2xl bg-[#F8F7F4] px-3 py-2.5 dark:bg-[#0E0F12]">
              <div className="text-[11px] text-zinc-400">电量状态</div>
              <div className="mt-0.5 font-mono-tabular text-xs font-medium text-zinc-900 dark:text-zinc-100">
                {statusSnap.batteryPercent >= 0
                  ? `${statusSnap.batteryPercent}%${statusSnap.charging ? ' · 充电中' : ''}`
                  : '浏览器环境'}
              </div>
            </div>
            <div className="rounded-2xl bg-[#F8F7F4] px-3 py-2.5 dark:bg-[#0E0F12]">
              <div className="text-[11px] text-zinc-400">网络通道</div>
              <div className="mt-0.5 truncate text-xs font-medium text-zinc-900 dark:text-zinc-100">
                {statusSnap.networkType}
                {statusSnap.vpnActive ? ' · VPN' : ''}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Today-Style Auto-Context Injection Toggles */}
      <div className="mac-card rounded-3xl p-5 space-y-3.5">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[#1B6EF3] dark:text-blue-400" />
          <h3 className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">
            自动情境注入（发消息时无感携带给云端助理）
          </h3>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {autoContextToggles.map(({ key, label, hint }) => {
            const active = contextConfig[key];
            return (
              <button
                key={key}
                type="button"
                onClick={() =>
                  onUpdateContextConfig({
                    ...contextConfig,
                    [key]: !active,
                  })
                }
                className={`flex min-h-[50px] items-center justify-between gap-3 rounded-2xl border px-3.5 py-2.5 text-left transition-all ${
                  active
                    ? 'border-[#1B6EF3]/60 bg-blue-50/40 dark:border-blue-500/50 dark:bg-blue-950/20'
                    : 'border-stone-200/80 bg-[#F8F7F4]/70 dark:border-zinc-800 dark:bg-[#0E0F12]/60'
                }`}
              >
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                    {label}
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-zinc-400">{hint}</div>
                </div>
                <span
                  className={`flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors ${
                    active ? 'bg-[#1B6EF3] justify-end' : 'bg-stone-300 dark:bg-zinc-700 justify-start'
                  }`}
                >
                  <span className="h-4 w-4 rounded-full bg-white shadow-xs" />
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Capability Grid */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* 1. Clipboard */}
        <div className="mac-card rounded-3xl p-5 flex flex-col justify-between space-y-3.5">
          <div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-stone-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
                  <Clipboard className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">剪贴板读写</h3>
                  <p className="text-[11px] text-zinc-400">快速读取刚复制的链接、文字或摘要</p>
                </div>
              </div>
              <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">可用</span>
            </div>

            {clipboardText && (
              <div className="mt-3 rounded-2xl bg-[#F8F7F4] p-3 text-xs leading-relaxed text-zinc-700 line-clamp-3 dark:bg-[#0E0F12] dark:text-zinc-300">
                {clipboardText}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => void handleReadClipboard()}
              disabled={loadingKey === 'clipboard'}
              className="min-h-[36px] rounded-xl border border-stone-200 bg-white px-3 text-xs font-medium text-zinc-700 hover:bg-stone-50 dark:border-zinc-700 dark:bg-[#181A20] dark:text-zinc-200"
            >
              读取剪贴板
            </button>
            <button
              type="button"
              onClick={() =>
                void handleSendCapabilityToAgent(
                  'clipboard',
                  '请帮我整理、翻译或根据这段剪贴板内容提取下一步待办。'
                )
              }
              className="inline-flex min-h-[36px] items-center gap-1 rounded-xl bg-zinc-950 px-3 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-[#1B6EF3] dark:hover:bg-blue-600"
            >
              <span>发给助理处理</span>
              <ArrowUpRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* 2. System Alarm & Timer */}
        <div className="mac-card rounded-3xl p-5 flex flex-col justify-between space-y-3.5">
          <div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-stone-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
                  <AlarmClock className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">系统闹钟与倒计时</h3>
                  <p className="text-[11px] text-zinc-400">直连 Android 系统时钟，准时响铃</p>
                </div>
              </div>
              <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">系统内置</span>
            </div>

            <form onSubmit={(e) => void handleSetQuickAlarm(e)} className="mt-3 flex items-center gap-2">
              <input
                type="time"
                value={alarmTime}
                onChange={(e) => setAlarmTime(e.target.value)}
                aria-label="闹钟时间"
                className="min-h-[38px] rounded-xl border border-stone-200 bg-[#F8F7F4] px-2.5 font-mono-tabular text-xs text-zinc-900 dark:border-zinc-700 dark:bg-[#0E0F12] dark:text-zinc-100"
              />
              <input
                type="text"
                value={alarmLabel}
                onChange={(e) => setAlarmLabel(e.target.value)}
                placeholder="标签"
                className="min-h-[38px] min-w-0 flex-1 rounded-xl border border-stone-200 bg-[#F8F7F4] px-2.5 text-xs text-zinc-900 dark:border-zinc-700 dark:bg-[#0E0F12] dark:text-zinc-100"
              />
              <button
                type="submit"
                className="min-h-[38px] shrink-0 rounded-xl bg-zinc-950 px-3 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-[#1B6EF3]"
              >
                设闹钟
              </button>
            </form>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {[15, 25, 45].map((mins) => (
              <button
                key={mins}
                type="button"
                onClick={() => void handleQuickTimer(mins)}
                className="inline-flex min-h-[34px] items-center gap-1 rounded-xl border border-stone-200 bg-white px-2.5 text-[11px] font-medium text-zinc-600 hover:border-[#1B6EF3]/50 hover:text-[#1B6EF3] dark:border-zinc-700 dark:bg-[#181A20] dark:text-zinc-300"
              >
                <Clock className="h-3 w-3" />
                <span>{mins} 分钟倒计时</span>
              </button>
            ))}
          </div>
        </div>

        {/* 3. Calendar & Schedule */}
        <div className="mac-card rounded-3xl p-5 space-y-3.5 md:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-stone-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
                <Calendar className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">系统日历与日程</h3>
                <p className="text-[11px] text-zinc-400">读写手机本地日程，让助理直接安排和防冲突</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {!perms.calendar ? (
                <button
                  type="button"
                  onClick={() => void handleRequestPerm('calendar')}
                  className="min-h-[34px] rounded-xl bg-[#1B6EF3] px-3 text-xs font-medium text-white hover:bg-blue-600"
                >
                  授权日历
                </button>
              ) : (
                <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">已授权</span>
              )}
              <button
                type="button"
                onClick={() => void handleLoadCalendar()}
                className="min-h-[34px] rounded-xl border border-stone-200 bg-white px-3 text-xs font-medium text-zinc-700 hover:bg-stone-50 dark:border-zinc-700 dark:bg-[#181A20] dark:text-zinc-200"
              >
                读取未来 7 天
              </button>
              <button
                type="button"
                onClick={() =>
                  void handleSendCapabilityToAgent(
                    'calendar',
                    '请结合我未来 7 天的系统日程，帮我梳理重点安排与潜在时间冲突。'
                  )
                }
                className="inline-flex min-h-[34px] items-center gap-1 rounded-xl bg-zinc-950 px-3 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-[#1B6EF3]"
              >
                <span>发给助理</span>
                <ArrowUpRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <form onSubmit={(e) => void handleAddQuickCalendarEvent(e)} className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={eventTitle}
              onChange={(e) => setEventTitle(e.target.value)}
              placeholder="快速写入系统日程，例如：实验室组会…"
              className="min-h-[38px] min-w-[180px] flex-1 rounded-xl border border-stone-200 bg-[#F8F7F4] px-3 text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-[#1B6EF3] focus:outline-none dark:border-zinc-700 dark:bg-[#0E0F12] dark:text-zinc-100"
            />
            <input
              type="time"
              value={eventTime}
              onChange={(e) => setEventTime(e.target.value)}
              aria-label="日程开始时间"
              className="min-h-[38px] rounded-xl border border-stone-200 bg-[#F8F7F4] px-2.5 font-mono-tabular text-xs text-zinc-900 dark:border-zinc-700 dark:bg-[#0E0F12] dark:text-zinc-100"
            />
            <button
              type="submit"
              disabled={!eventTitle.trim()}
              className="min-h-[38px] rounded-xl border border-stone-200 bg-white px-3.5 text-xs font-medium text-zinc-800 hover:bg-stone-50 disabled:opacity-40 dark:border-zinc-700 dark:bg-[#181A20] dark:text-zinc-100"
            >
              写入系统日历
            </button>
          </form>

          {calendarEvents.length > 0 && (
            <div className="divide-y divide-stone-100 rounded-2xl border border-stone-200/70 bg-[#F8F7F4]/70 dark:divide-zinc-800 dark:border-zinc-800 dark:bg-[#0E0F12]/70">
              {calendarEvents.slice(0, 6).map((ev) => (
                <div key={`${ev.id}-${ev.startMs}`} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium text-zinc-900 dark:text-zinc-100">
                      {ev.title || '（无标题日程）'}
                    </div>
                    <div className="mt-0.5 font-mono-tabular text-[11px] text-zinc-400">
                      {formatTs(ev.startMs)}
                      {ev.location ? ` · ${ev.location}` : ''}
                    </div>
                  </div>
                  <span className="shrink-0 text-[10px] text-zinc-400">{ev.calendarName}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 4. System Notification Listener (Today's Signature Feature) */}
        <div className="mac-card rounded-3xl p-5 space-y-3.5 md:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-blue-50 text-[#1B6EF3] dark:bg-blue-950/50 dark:text-blue-400">
                <Bell className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                  系统通知感知（借鉴 Today 核心能力）
                </h3>
                <p className="text-[11px] text-zinc-400">
                  本地缓存微信、钉钉、快递、航班等第三方通知，一键汇总给云端助理
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void handleRequestPerm('notifications')}
                className={`min-h-[34px] rounded-xl px-3 text-xs font-medium ${
                  perms.notifications
                    ? 'border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-400'
                    : 'bg-[#1B6EF3] text-white hover:bg-blue-600'
                }`}
              >
                {perms.notifications ? '通知使用权已开启' : '去开启通知使用权'}
              </button>
              <button
                type="button"
                onClick={() => void handleLoadNotifications()}
                className="min-h-[34px] rounded-xl border border-stone-200 bg-white px-3 text-xs font-medium text-zinc-700 hover:bg-stone-50 dark:border-zinc-700 dark:bg-[#181A20] dark:text-zinc-200"
              >
                刷新通知
              </button>
              {notifications.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      void handleSendCapabilityToAgent(
                        'notifications',
                        '请帮我过滤掉广告和无关提醒，提炼出需要我立即处理或关注的重要通知并列出待办。'
                      )
                    }
                    className="inline-flex min-h-[34px] items-center gap-1 rounded-xl bg-zinc-950 px-3 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-[#1B6EF3]"
                  >
                    <span>汇总给助理</span>
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await clearDeviceNotifications();
                      setNotifications([]);
                      onShowToast('已清空本地通知缓存');
                    }}
                    aria-label="清空通知缓存"
                    className="flex h-8 w-8 items-center justify-center rounded-xl text-zinc-400 hover:bg-stone-100 hover:text-rose-600 dark:hover:bg-zinc-800"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
            </div>
          </div>

          {notifications.length > 0 ? (
            <div className="divide-y divide-stone-100 rounded-2xl border border-stone-200/70 bg-[#F8F7F4]/70 dark:divide-zinc-800 dark:border-zinc-800 dark:bg-[#0E0F12]/70">
              {notifications.slice(0, 6).map((n) => (
                <div key={n.id} className="px-3.5 py-2.5">
                  <div className="flex items-center justify-between gap-2 text-[11px] text-zinc-400">
                    <span className="font-medium text-zinc-600 dark:text-zinc-300">{n.appName}</span>
                    <span className="font-mono-tabular">{formatTs(n.timestamp)}</span>
                  </div>
                  <div className="mt-0.5 text-xs font-medium text-zinc-900 dark:text-zinc-100">
                    {n.title}
                  </div>
                  {n.text && (
                    <div className="mt-0.5 line-clamp-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                      {n.text}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl bg-[#F8F7F4]/70 px-4 py-3 text-xs text-zinc-400 dark:bg-[#0E0F12]/60">
              {perms.notifications
                ? '已连接系统通知监听，新收到的第三方应用通知会自动记录在这里。'
                : '开启系统「通知使用权」后，即可像 Today 一样自动捕捉重要微信/航班/快递通知。'}
            </div>
          )}
        </div>

        {/* 5. SMS Inbox */}
        <div className="mac-card rounded-3xl p-5 flex flex-col justify-between space-y-3.5">
          <div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-stone-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
                  <MessageSquareText className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">短信识别</h3>
                  <p className="text-[11px] text-zinc-400">自动归类快递、航班、账单与验证码</p>
                </div>
              </div>
              {perms.sms && (
                <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">已授权</span>
              )}
            </div>

            {smsList.length > 0 && (
              <div className="mt-3 space-y-2">
                {smsList.slice(0, 3).map((m) => (
                  <div
                    key={m.id}
                    className="rounded-2xl bg-[#F8F7F4] px-3 py-2 text-xs dark:bg-[#0E0F12]"
                  >
                    <div className="flex items-center justify-between text-[11px] text-zinc-400">
                      <span className="font-medium text-[#1B6EF3] dark:text-blue-400">
                        {m.tag} · {m.address}
                      </span>
                      <span className="font-mono-tabular">{formatTs(m.timestamp)}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-[11px] text-zinc-600 dark:text-zinc-300">
                      {m.body}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {!perms.sms && (
              <button
                type="button"
                onClick={() => void handleRequestPerm('sms')}
                className="min-h-[36px] rounded-xl bg-[#1B6EF3] px-3 text-xs font-medium text-white hover:bg-blue-600"
              >
                授权短信
              </button>
            )}
            <button
              type="button"
              onClick={() => void handleLoadSms()}
              className="min-h-[36px] rounded-xl border border-stone-200 bg-white px-3 text-xs font-medium text-zinc-700 hover:bg-stone-50 dark:border-zinc-700 dark:bg-[#181A20] dark:text-zinc-200"
            >
              读取最近短信
            </button>
            <button
              type="button"
              onClick={() =>
                void handleSendCapabilityToAgent(
                  'sms',
                  '请帮我从最近短信里提取重要的取件码、行程班次或账单日期（忽略营销垃圾短信）。'
                )
              }
              className="inline-flex min-h-[36px] items-center gap-1 rounded-xl bg-zinc-950 px-3 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-[#1B6EF3]"
            >
              <span>提取要点</span>
              <ArrowUpRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* 6. Geolocation */}
        <div className="mac-card rounded-3xl p-5 flex flex-col justify-between space-y-3.5">
          <div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-stone-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
                  <MapPin className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">地理位置</h3>
                  <p className="text-[11px] text-zinc-400">按需获取实时坐标与地址，辅助出行与周边规划</p>
                </div>
              </div>
              {perms.location && (
                <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">已授权</span>
              )}
            </div>

            {locationSnap && (
              <div className="mt-3 rounded-2xl bg-[#F8F7F4] p-3 text-xs dark:bg-[#0E0F12]">
                <div className="font-medium text-zinc-900 dark:text-zinc-100">
                  {locationSnap.address ||
                    `${locationSnap.city} ${locationSnap.district}`.trim() ||
                    '已获取坐标'}
                </div>
                <div className="mt-1 font-mono-tabular text-[11px] text-zinc-400">
                  {locationSnap.latitude.toFixed(5)}, {locationSnap.longitude.toFixed(5)} · 精度{' '}
                  {Math.round(locationSnap.accuracy)}m
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {!perms.location && (
              <button
                type="button"
                onClick={() => void handleRequestPerm('location')}
                className="min-h-[36px] rounded-xl bg-[#1B6EF3] px-3 text-xs font-medium text-white hover:bg-blue-600"
              >
                授予定位
              </button>
            )}
            <button
              type="button"
              onClick={() => void handleLoadLocation()}
              disabled={loadingKey === 'location'}
              className="min-h-[36px] rounded-xl border border-stone-200 bg-white px-3 text-xs font-medium text-zinc-700 hover:bg-stone-50 dark:border-zinc-700 dark:bg-[#181A20] dark:text-zinc-200"
            >
              {loadingKey === 'location' ? '定位中…' : '获取当前位置'}
            </button>
            <button
              type="button"
              onClick={() =>
                void handleSendCapabilityToAgent(
                  'location',
                  '结合我当前所在位置，帮我查一下附近天气或给出接下来的出行建议。'
                )
              }
              className="inline-flex min-h-[36px] items-center gap-1 rounded-xl bg-zinc-950 px-3 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-[#1B6EF3]"
            >
              <span>结合位置提问</span>
              <ArrowUpRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* 7. Android Filesystem (SAF) */}
        <div className="mac-card rounded-3xl p-5 space-y-3.5 md:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-stone-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
                <FolderOpen className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                  安卓本地文件系统（SAF 安全授权目录）
                </h3>
                <p className="text-[11px] text-zinc-400">
                  {folderLabel
                    ? `当前已授权目录：${folderLabel}`
                    : '授权手机中的下载/文档/笔记目录，支持直接读取发给助理或写入新文档'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleRequestPerm('files')}
                className="min-h-[34px] rounded-xl bg-[#1B6EF3] px-3 text-xs font-medium text-white hover:bg-blue-600"
              >
                {perms.files ? '更换目录' : '选择手机文件夹'}
              </button>
              {perms.files && (
                <button
                  type="button"
                  onClick={() => void handleLoadFiles()}
                  className="min-h-[34px] rounded-xl border border-stone-200 bg-white px-3 text-xs font-medium text-zinc-700 hover:bg-stone-50 dark:border-zinc-700 dark:bg-[#181A20] dark:text-zinc-200"
                >
                  浏览文件
                </button>
              )}
            </div>
          </div>

          {folderFiles.length > 0 && (
            <div className="divide-y divide-stone-100 rounded-2xl border border-stone-200/70 bg-[#F8F7F4]/70 dark:divide-zinc-800 dark:border-zinc-800 dark:bg-[#0E0F12]/70">
              {folderFiles.slice(0, 8).map((f) => (
                <div
                  key={f.documentId}
                  className="flex items-center justify-between gap-3 px-3.5 py-2.5"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    {f.isDirectory ? (
                      <FolderOpen className="h-4 w-4 shrink-0 text-amber-500" />
                    ) : (
                      <FileText className="h-4 w-4 shrink-0 text-zinc-400" />
                    )}
                    <div className="min-w-0">
                      <div className="truncate text-xs font-medium text-zinc-900 dark:text-zinc-100">
                        {f.name}
                      </div>
                      <div className="font-mono-tabular text-[11px] text-zinc-400">
                        {f.isDirectory ? '文件夹' : formatBytes(f.size)} · {formatTs(f.lastModified)}
                      </div>
                    </div>
                  </div>
                  {!f.isDirectory && (
                    <button
                      type="button"
                      onClick={() => void handleReadAndSendFile(f)}
                      disabled={loadingKey === `file-${f.documentId}`}
                      className="shrink-0 rounded-xl px-2.5 py-1.5 text-xs font-medium text-[#1B6EF3] hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/40"
                    >
                      发给助理
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Cloud DSH Agent Bidirectional Protocol Card */}
      <div className="mac-card rounded-3xl p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <h3 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
              让云端 DSH Agent 学会直接调用手机（双向闭环）
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleCopyProtocolPrompt()}
              className="inline-flex min-h-[34px] items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-3 text-xs font-medium text-zinc-700 hover:bg-stone-50 dark:border-zinc-700 dark:bg-[#181A20] dark:text-zinc-200"
            >
              {copiedPrompt ? (
                <Check className="h-3.5 w-3.5 text-emerald-600" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              <span>{copiedPrompt ? '已复制协议' : '复制协议提示词'}</span>
            </button>
            <button
              type="button"
              onClick={() =>
                onSendContextToAgent(
                  `请把以下手机端能力协议记住并写入你的长期记忆/技能规范，之后需要帮我设闹钟、写日历、复制内容或读取手机日程/通知/位置时直接按格式输出即可：\n\n${AGENT_DEVICE_PROTOCOL_PROMPT}`
                )
              }
              className="inline-flex min-h-[34px] items-center gap-1.5 rounded-xl bg-zinc-950 px-3 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-[#1B6EF3]"
            >
              <Send className="h-3.5 w-3.5" />
              <span>一键教给云端助理</span>
            </button>
          </div>
        </div>
        <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
          点击「一键教给云端助理」后，你的 DSH Agent 在回复中输出 <code className="rounded bg-stone-100 px-1 py-0.5 font-mono-tabular text-[11px] dark:bg-zinc-800">```relay-action```</code> 即可在对话里渲染原生执行卡片，一键为你设闹钟、写系统日历、写入剪贴板、保存文件，或请求回传通知/短信/定位。
        </p>
      </div>
    </div>
  );
};
