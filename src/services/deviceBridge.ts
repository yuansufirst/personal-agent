import { Capacitor, registerPlugin } from '@capacitor/core';
import type {
  DeviceActionItem,
  DeviceCapabilityKey,
  DeviceContextConfig,
} from '../types/relay';

export interface DevicePermissionStatus {
  time: boolean;
  clipboard: boolean;
  calendar: boolean;
  alarm: boolean;
  notifications: boolean;
  sms: boolean;
  location: boolean;
  files: boolean;
  folderLabel?: string;
}

export interface DeviceStatusSnapshot {
  timestampMs: number;
  isoTime: string;
  readableTime: string;
  timeZone: string;
  batteryPercent: number;
  charging: boolean;
  networkType: string;
  vpnActive: boolean;
  deviceModel: string;
  androidVersion: string;
}

export interface DeviceCalendarEvent {
  id: string;
  title: string;
  description: string;
  location: string;
  startMs: number;
  endMs: number;
  allDay: boolean;
  calendarName: string;
}

export interface DeviceSmsItem {
  id: string;
  address: string;
  body: string;
  timestamp: number;
  read: boolean;
  tag: string;
}

export interface DeviceNotificationItem {
  id: string;
  packageName: string;
  appName: string;
  title: string;
  text: string;
  subText: string;
  timestamp: number;
  category: string;
}

export interface DeviceLocationSnapshot {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
  provider: string;
  address: string;
  city: string;
  district: string;
}

export interface DeviceFileEntry {
  documentId: string;
  name: string;
  mimeType: string;
  size: number;
  lastModified: number;
  isDirectory: boolean;
  uri: string;
}

interface NativeDeviceBridgePlugin {
  getPermissionStatus(): Promise<DevicePermissionStatus>;
  requestCapabilityPermission(options: {
    capability: DeviceCapabilityKey;
  }): Promise<{ granted: boolean; capability: string; folderLabel?: string }>;
  getDeviceStatus(): Promise<DeviceStatusSnapshot>;
  readClipboard(): Promise<{ text: string; hasText: boolean; label: string }>;
  writeClipboard(options: { text: string; label?: string }): Promise<{ ok: boolean }>;
  getCalendarEvents(options?: {
    daysAhead?: number;
    limit?: number;
  }): Promise<{ events: DeviceCalendarEvent[]; count: number }>;
  createCalendarEvent(options: {
    title: string;
    startMs: number;
    endMs?: number;
    location?: string;
    description?: string;
    allDay?: boolean;
    reminderMinutes?: number;
  }): Promise<{ ok: boolean; mode: string; eventId?: string }>;
  setAlarm(options: {
    hour: number;
    minute: number;
    message?: string;
    days?: number[];
    skipUi?: boolean;
  }): Promise<{ ok: boolean; hour: number; minute: number }>;
  setTimer(options: {
    seconds: number;
    message?: string;
    skipUi?: boolean;
  }): Promise<{ ok: boolean; seconds: number }>;
  getRecentSms(options?: {
    limit?: number;
    keyword?: string;
  }): Promise<{ messages: DeviceSmsItem[]; count: number }>;
  getNotifications(options?: {
    limit?: number;
  }): Promise<{ enabled: boolean; notifications: DeviceNotificationItem[]; count: number }>;
  clearNotifications(): Promise<{ ok: boolean }>;
  openNotificationAccessSettings(): Promise<{ opened: boolean }>;
  getLocation(): Promise<DeviceLocationSnapshot>;
  pickFolder(): Promise<{ granted: boolean; uri?: string; folderLabel?: string }>;
  listFolderFiles(options?: {
    limit?: number;
  }): Promise<{ folderLabel: string; files: DeviceFileEntry[]; count: number }>;
  readDocumentFile(options: {
    uri: string;
    maxBytes?: number;
  }): Promise<{ content: string; bytesRead: number; truncated: boolean }>;
  writeDocumentFile(options: {
    filename: string;
    content: string;
    mimeType?: string;
  }): Promise<{ ok: boolean; uri: string; filename: string }>;
}

const NativeDeviceBridge = registerPlugin<NativeDeviceBridgePlugin>('DeviceBridge');

export const DEFAULT_DEVICE_CONTEXT_CONFIG: DeviceContextConfig = {
  autoAttachTime: true,
  autoAttachCalendar: false,
  autoAttachClipboard: false,
  autoAttachLocation: false,
  autoAttachNotifications: false,
};

export function hasNativeDeviceBridge(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('DeviceBridge');
}

function formatShortTime(ts: number): string {
  const d = new Date(ts);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${mm}-${dd} ${hh}:${min}`;
}

export async function getDevicePermissions(): Promise<DevicePermissionStatus> {
  if (hasNativeDeviceBridge()) {
    return NativeDeviceBridge.getPermissionStatus();
  }
  return {
    time: true,
    clipboard: typeof navigator !== 'undefined' && Boolean(navigator.clipboard),
    calendar: false,
    alarm: false,
    notifications: false,
    sms: false,
    location: typeof navigator !== 'undefined' && Boolean(navigator.geolocation),
    files: false,
    folderLabel: '',
  };
}

export async function requestDevicePermission(
  capability: DeviceCapabilityKey
): Promise<{ granted: boolean; folderLabel?: string }> {
  if (hasNativeDeviceBridge()) {
    return NativeDeviceBridge.requestCapabilityPermission({ capability });
  }
  if (capability === 'location' && typeof navigator !== 'undefined' && navigator.geolocation) {
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        () => resolve({ granted: true }),
        () => resolve({ granted: false }),
        { timeout: 5000 }
      );
    });
  }
  throw new Error('该系统能力需要在 Android APK 客户端中使用');
}

export async function getDeviceStatusSnapshot(): Promise<DeviceStatusSnapshot> {
  if (hasNativeDeviceBridge()) {
    return NativeDeviceBridge.getDeviceStatus();
  }
  const now = new Date();
  const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  const readable = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate()
  ).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(
    now.getMinutes()
  ).padStart(2, '0')} ${weekdays[now.getDay()]}`;

  return {
    timestampMs: now.getTime(),
    isoTime: now.toISOString(),
    readableTime: readable,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local',
    batteryPercent: -1,
    charging: false,
    networkType: navigator.onLine ? '在线' : '离线',
    vpnActive: false,
    deviceModel: 'Web Browser',
    androidVersion: 'PWA / Web',
  };
}

export async function readDeviceClipboard(): Promise<string> {
  if (hasNativeDeviceBridge()) {
    const res = await NativeDeviceBridge.readClipboard();
    return res.text || '';
  }
  if (typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
    return navigator.clipboard.readText();
  }
  throw new Error('当前环境不支持读取剪贴板');
}

export async function writeDeviceClipboard(text: string, label = 'Relay'): Promise<void> {
  if (hasNativeDeviceBridge()) {
    await NativeDeviceBridge.writeClipboard({ text, label });
    return;
  }
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  throw new Error('当前环境不支持写入剪贴板');
}

export async function getDeviceCalendarEvents(
  daysAhead = 7,
  limit = 25
): Promise<DeviceCalendarEvent[]> {
  if (!hasNativeDeviceBridge()) {
    throw new Error('读取系统日历需要在 Android APK 中运行');
  }
  const res = await NativeDeviceBridge.getCalendarEvents({ daysAhead, limit });
  return res.events || [];
}

export async function createDeviceCalendarEvent(options: {
  title: string;
  startMs: number;
  endMs?: number;
  location?: string;
  description?: string;
  allDay?: boolean;
  reminderMinutes?: number;
}): Promise<{ ok: boolean; mode: string; eventId?: string }> {
  if (!hasNativeDeviceBridge()) {
    throw new Error('写入系统日历需要在 Android APK 中运行');
  }
  return NativeDeviceBridge.createCalendarEvent(options);
}

export async function setDeviceAlarm(options: {
  hour: number;
  minute: number;
  message?: string;
  days?: number[];
  skipUi?: boolean;
}): Promise<void> {
  if (!hasNativeDeviceBridge()) {
    throw new Error('设置系统闹钟需要在 Android APK 中运行');
  }
  await NativeDeviceBridge.setAlarm(options);
}

export async function setDeviceTimer(options: {
  seconds: number;
  message?: string;
  skipUi?: boolean;
}): Promise<void> {
  if (!hasNativeDeviceBridge()) {
    throw new Error('设置系统倒计时需要在 Android APK 中运行');
  }
  await NativeDeviceBridge.setTimer(options);
}

export async function getDeviceRecentSms(
  limit = 15,
  keyword = ''
): Promise<DeviceSmsItem[]> {
  if (!hasNativeDeviceBridge()) {
    throw new Error('读取系统短信需要在 Android APK 中运行');
  }
  const res = await NativeDeviceBridge.getRecentSms({ limit, keyword });
  return res.messages || [];
}

export async function getDeviceNotifications(
  limit = 25
): Promise<{ enabled: boolean; notifications: DeviceNotificationItem[] }> {
  if (!hasNativeDeviceBridge()) {
    return { enabled: false, notifications: [] };
  }
  const res = await NativeDeviceBridge.getNotifications({ limit });
  return { enabled: res.enabled, notifications: res.notifications || [] };
}

export async function clearDeviceNotifications(): Promise<void> {
  if (!hasNativeDeviceBridge()) return;
  await NativeDeviceBridge.clearNotifications();
}

export async function openDeviceNotificationSettings(): Promise<void> {
  if (!hasNativeDeviceBridge()) {
    throw new Error('通知监听权限仅支持在 Android APK 中开启');
  }
  await NativeDeviceBridge.openNotificationAccessSettings();
}

export async function getDeviceLocation(): Promise<DeviceLocationSnapshot> {
  if (hasNativeDeviceBridge()) {
    return NativeDeviceBridge.getLocation();
  }
  if (typeof navigator !== 'undefined' && navigator.geolocation) {
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (pos) =>
          resolve({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            timestamp: pos.timestamp,
            provider: 'browser-gps',
            address: '',
            city: '',
            district: '',
          }),
        (err) => reject(new Error(err.message || '浏览器定位失败')),
        { enableHighAccuracy: false, timeout: 6000 }
      );
    });
  }
  throw new Error('当前环境不支持定位服务');
}

export async function pickDeviceFolder(): Promise<{
  granted: boolean;
  folderLabel?: string;
}> {
  if (!hasNativeDeviceBridge()) {
    throw new Error('授权手机本地文件夹需要在 Android APK 中运行');
  }
  return NativeDeviceBridge.pickFolder();
}

export async function listDeviceFolderFiles(
  limit = 40
): Promise<{ folderLabel: string; files: DeviceFileEntry[] }> {
  if (!hasNativeDeviceBridge()) {
    throw new Error('浏览手机文件夹需要在 Android APK 中运行');
  }
  const res = await NativeDeviceBridge.listFolderFiles({ limit });
  return { folderLabel: res.folderLabel || '', files: res.files || [] };
}

export async function readDeviceFileText(
  uri: string,
  maxBytes = 65536
): Promise<{ content: string; bytesRead: number; truncated: boolean }> {
  if (!hasNativeDeviceBridge()) {
    throw new Error('读取手机本地文件需要在 Android APK 中运行');
  }
  return NativeDeviceBridge.readDocumentFile({ uri, maxBytes });
}

export async function writeDeviceFileText(
  filename: string,
  content: string,
  mimeType = 'text/markdown'
): Promise<{ ok: boolean; filename: string }> {
  if (!hasNativeDeviceBridge()) {
    throw new Error('写入手机本地文件需要在 Android APK 中运行');
  }
  return NativeDeviceBridge.writeDocumentFile({ filename, content, mimeType });
}

/**
 * Builds a compact, privacy-conscious phone context block for the cloud DSH Agent.
 * Only fetches capabilities explicitly enabled (and already granted) without nagging.
 */
export async function buildAutoContextHeader(
  ctxConfig: DeviceContextConfig
): Promise<string> {
  const sections: string[] = [];

  if (ctxConfig.autoAttachTime) {
    try {
      const status = await getDeviceStatusSnapshot();
      const battery =
        status.batteryPercent >= 0
          ? `，电量 ${status.batteryPercent}%${status.charging ? '（充电中）' : ''}`
          : '';
      sections.push(
        `时间：${status.readableTime}（${status.timeZone}）${battery}，网络：${status.networkType}`
      );
    } catch {
      // ignore
    }
  }

  if (hasNativeDeviceBridge()) {
    let perms: DevicePermissionStatus | null = null;
    try {
      perms = await getDevicePermissions();
    } catch {
      perms = null;
    }

    if (ctxConfig.autoAttachClipboard) {
      try {
        const clip = (await readDeviceClipboard()).trim();
        if (clip) {
          sections.push(`剪贴板：${clip.slice(0, 320)}`);
        }
      } catch {
        // ignore
      }
    }

    if (ctxConfig.autoAttachCalendar && perms?.calendar) {
      try {
        const events = await getDeviceCalendarEvents(3, 8);
        if (events.length > 0) {
          const lines = events
            .map(
              (ev) =>
                `- ${formatShortTime(ev.startMs)} ${ev.title}${ev.location ? ` @ ${ev.location}` : ''}`
            )
            .join('\n');
          sections.push(`近 3 天日程：\n${lines}`);
        }
      } catch {
        // ignore
      }
    }

    if (ctxConfig.autoAttachLocation && perms?.location) {
      try {
        const loc = await getDeviceLocation();
        const place =
          loc.address ||
          `${loc.city}${loc.district}` ||
          `${loc.latitude.toFixed(4)}, ${loc.longitude.toFixed(4)}`;
        sections.push(`当前位置：${place}`);
      } catch {
        // ignore
      }
    }

    if (ctxConfig.autoAttachNotifications && perms?.notifications) {
      try {
        const { notifications } = await getDeviceNotifications(8);
        if (notifications.length > 0) {
          const lines = notifications
            .slice(0, 6)
            .map(
              (n) =>
                `- [${n.appName} ${formatShortTime(n.timestamp)}] ${n.title}${n.text ? `: ${n.text.slice(0, 80)}` : ''}`
            )
            .join('\n');
          sections.push(`最近通知：\n${lines}`);
        }
      } catch {
        // ignore
      }
    }
  }

  if (sections.length === 0) return '';
  return `[手机实时情境]\n${sections.join('\n')}\n[/手机实时情境]\n\n`;
}

/**
 * On-demand snapshot for a single capability (used by the Chat composer quick menu
 * and Device Hub 1-tap send actions).
 */
export async function captureCapabilityContext(
  capability: DeviceCapabilityKey
): Promise<{ title: string; text: string }> {
  switch (capability) {
    case 'time': {
      const s = await getDeviceStatusSnapshot();
      const battery =
        s.batteryPercent >= 0
          ? `${s.batteryPercent}%${s.charging ? '（充电中）' : ''}`
          : '未知';
      return {
        title: '时间与设备状态',
        text: `[手机状态] 当前时间：${s.readableTime}（${s.timeZone}），设备：${s.deviceModel}（${s.androidVersion}），电量：${battery}，网络：${s.networkType}${s.vpnActive ? '（VPN 已连）' : ''}`,
      };
    }
    case 'clipboard': {
      const text = (await readDeviceClipboard()).trim();
      if (!text) throw new Error('当前剪贴板为空');
      return {
        title: '手机剪贴板',
        text: `[手机剪贴板内容]\n${text.slice(0, 3000)}`,
      };
    }
    case 'calendar': {
      const events = await getDeviceCalendarEvents(7, 20);
      if (events.length === 0) {
        return { title: '系统日历', text: '[手机系统日历] 未来 7 天暂无日程安排。' };
      }
      const lines = events.map(
        (e) =>
          `- ${formatShortTime(e.startMs)} ~ ${formatShortTime(e.endMs)}｜${e.title}${e.location ? `（地点：${e.location}）` : ''}`
      );
      return {
        title: `系统日历（${events.length} 条）`,
        text: `[手机未来 7 天日程]\n${lines.join('\n')}`,
      };
    }
    case 'notifications': {
      const { enabled, notifications } = await getDeviceNotifications(20);
      if (!enabled) {
        throw new Error('尚未开启系统「通知使用权」，请先在空间 → 手机接入中授权');
      }
      if (notifications.length === 0) {
        return { title: '系统通知', text: '[手机通知] 近期暂无捕获到的第三方应用通知。' };
      }
      const lines = notifications.map(
        (n) =>
          `- [${n.appName} ${formatShortTime(n.timestamp)}] ${n.title}${n.text ? `：${n.text}` : ''}`
      );
      return {
        title: `系统通知（${notifications.length} 条）`,
        text: `[手机近期应用通知]\n${lines.join('\n')}`,
      };
    }
    case 'sms': {
      const msgs = await getDeviceRecentSms(12);
      if (msgs.length === 0) {
        return { title: '最近短信', text: '[手机短信] 未读取到近期短信。' };
      }
      const lines = msgs.map(
        (m) => `- [${m.tag} · ${m.address} · ${formatShortTime(m.timestamp)}] ${m.body}`
      );
      return {
        title: `最近短信（${msgs.length} 条）`,
        text: `[手机最近短信]\n${lines.join('\n')}`,
      };
    }
    case 'location': {
      const loc = await getDeviceLocation();
      const place = loc.address || `${loc.city} ${loc.district}`.trim() || '未解析到街道名';
      return {
        title: '当前位置',
        text: `[手机当前位置] 地址：${place}；经纬度：${loc.latitude.toFixed(5)}, ${loc.longitude.toFixed(5)}（精度约 ${Math.round(loc.accuracy)}m）`,
      };
    }
    case 'files': {
      const { folderLabel, files } = await listDeviceFolderFiles(25);
      if (files.length === 0) {
        return { title: '手机文件夹', text: `[手机目录 ${folderLabel}] 目录为空。` };
      }
      const lines = files.map(
        (f) =>
          `- ${f.isDirectory ? '[目录]' : '[文件]'} ${f.name}（${Math.max(1, Math.round(f.size / 1024))} KB）`
      );
      return {
        title: `手机目录（${files.length} 项）`,
        text: `[手机已授权目录：${folderLabel}]\n${lines.join('\n')}`,
      };
    }
    default:
      throw new Error('不支持的能力类型');
  }
}

/**
 * Executes a structured `relay-action` card emitted by the cloud DSH Agent.
 * Returns a human-readable execution result AND optional follow-up text to send back to the Agent.
 */
export async function executeDeviceAction(
  item: DeviceActionItem
): Promise<{ ok: boolean; resultText: string; replyToAgent?: string }> {
  const p = item.params || {};

  switch (item.action) {
    case 'set_alarm': {
      const hour = Number(p.hour);
      const minute = Number(p.minute ?? 0);
      const message = String(p.message || item.title || 'Relay 闹钟');
      const days = Array.isArray(p.days) ? p.days.map(Number).filter((n) => !Number.isNaN(n)) : undefined;
      await setDeviceAlarm({ hour, minute, message, days, skipUi: p.skipUi !== false });
      const hh = String(hour).padStart(2, '0');
      const mm = String(minute).padStart(2, '0');
      return { ok: true, resultText: `已创建系统闹钟：${hh}:${mm}（${message}）` };
    }
    case 'set_timer': {
      const seconds =
        Number(p.seconds) || (Number(p.minutes) ? Number(p.minutes) * 60 : 300);
      const message = String(p.message || item.title || 'Relay 倒计时');
      await setDeviceTimer({ seconds, message, skipUi: p.skipUi !== false });
      return {
        ok: true,
        resultText: `已启动系统倒计时：${Math.round(seconds / 60) >= 1 ? `${(seconds / 60).toFixed(seconds % 60 === 0 ? 0 : 1)} 分钟` : `${seconds} 秒`}（${message}）`,
      };
    }
    case 'add_calendar_event': {
      const title = String(p.title || item.title || 'Relay 日程');
      const startMs =
        typeof p.startMs === 'number'
          ? p.startMs
          : typeof p.startTime === 'string'
            ? Date.parse(p.startTime)
            : Date.now() + 3600_000;
      const endMs =
        typeof p.endMs === 'number'
          ? p.endMs
          : typeof p.endTime === 'string'
            ? Date.parse(p.endTime)
            : startMs + 3600_000;
      const res = await createDeviceCalendarEvent({
        title,
        startMs: Number.isNaN(startMs) ? Date.now() + 3600_000 : startMs,
        endMs: Number.isNaN(endMs) ? undefined : endMs,
        location: p.location ? String(p.location) : '',
        description: p.description ? String(p.description) : '',
        allDay: Boolean(p.allDay),
        reminderMinutes: typeof p.reminderMinutes === 'number' ? p.reminderMinutes : 15,
      });
      return {
        ok: true,
        resultText:
          res.mode === 'direct'
            ? `已直接写入系统日历：「${title}」`
            : `已唤起系统日历确认添加：「${title}」`,
      };
    }
    case 'write_clipboard': {
      const text = String(p.text || '');
      if (!text) throw new Error('写入剪贴板的内容为空');
      await writeDeviceClipboard(text, 'Relay');
      return { ok: true, resultText: `已复制到手机剪贴板（${text.length} 字）` };
    }
    case 'save_file': {
      const filename = String(p.filename || `relay-${Date.now()}.md`);
      const content = String(p.content || '');
      const mimeType = String(p.mimeType || 'text/markdown');
      await writeDeviceFileText(filename, content, mimeType);
      return { ok: true, resultText: `已保存文件到手机目录：${filename}` };
    }
    case 'read_clipboard': {
      const snap = await captureCapabilityContext('clipboard');
      return { ok: true, resultText: '已读取手机剪贴板并回传给助理', replyToAgent: snap.text };
    }
    case 'read_calendar': {
      const snap = await captureCapabilityContext('calendar');
      return { ok: true, resultText: '已读取系统日程并回传给助理', replyToAgent: snap.text };
    }
    case 'read_notifications': {
      const snap = await captureCapabilityContext('notifications');
      return { ok: true, resultText: '已读取手机通知并回传给助理', replyToAgent: snap.text };
    }
    case 'read_sms': {
      const snap = await captureCapabilityContext('sms');
      return { ok: true, resultText: '已读取近期短信并回传给助理', replyToAgent: snap.text };
    }
    case 'get_location': {
      const snap = await captureCapabilityContext('location');
      return { ok: true, resultText: '已获取当前位置并回传给助理', replyToAgent: snap.text };
    }
    case 'list_files': {
      const snap = await captureCapabilityContext('files');
      return { ok: true, resultText: '已列出手机授权目录并回传给助理', replyToAgent: snap.text };
    }
    default:
      throw new Error(`未知设备动作类型：${String(item.action)}`);
  }
}

/**
 * Copyable skill prompt so the user's cloud DSH Agent immediately understands
 * how to read phone context and emit executable `relay-action` cards.
 */
export const AGENT_DEVICE_PROTOCOL_PROMPT = `你现在通过 Relay Android 客户端与我的手机相连。
当你需要操作我的手机或请求实时手机数据时，可以在回复中输出一个 \`\`\`relay-action\`\`\` JSON 代码块，Relay 客户端会自动渲染为可一键执行的原生卡片：

支持的 action 类型：
1. 设系统闹钟：{"action":"set_alarm","title":"明早起床闹钟","summary":"07:30 · 起床","params":{"hour":7,"minute":30,"message":"起床","skipUi":true}}
2. 设系统倒计时：{"action":"set_timer","title":"番茄钟倒计时","summary":"25 分钟 · 专注阅读","params":{"seconds":1500,"message":"专注阅读","skipUi":true}}
3. 写入系统日历：{"action":"add_calendar_event","title":"组会讨论","summary":"明天 15:00-16:00","params":{"title":"组会讨论","startTime":"2026-11-28T15:00:00+08:00","endTime":"2026-11-28T16:00:00+08:00","location":"会议室 A","reminderMinutes":15}}
4. 写入手机剪贴板：{"action":"write_clipboard","title":"复制回复内容","summary":"一键写入手机剪贴板","params":{"text":"要复制的文本"}}
5. 保存文档到手机：{"action":"save_file","title":"保存摘要到手机","summary":"写入已授权文件夹","params":{"filename":"summary.md","content":"# 摘要..."}}
6. 请求读取手机数据（我点击后会自动回传）：action 可选 "read_clipboard" | "read_calendar" | "read_notifications" | "read_sms" | "get_location" | "list_files"，params 为 {}。

同时，当我的消息开头附带 [手机实时情境] 块时，请直接结合其中的本地时间、日程、位置、通知或剪贴板内容来回答。`;
