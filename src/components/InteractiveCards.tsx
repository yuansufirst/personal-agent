import React, { useState } from 'react';
import {
  AlarmClock,
  ArrowRight,
  Bell,
  Bookmark,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clipboard,
  Clock,
  Download,
  FileText,
  FolderOpen,
  Loader2,
  MapPin,
  MessageSquarePlus,
  Play,
  Smartphone,
  Terminal,
  XCircle,
} from 'lucide-react';
import type {
  ApprovalAction,
  BriefingItem,
  DeviceActionItem,
  InteractiveCard,
  MapCardItem,
  MeshFileItem,
  ReminderItem,
} from '../types/relay';
import { InteractiveMapCard } from './InteractiveMapCard';
import { AttachmentCategoryIcon, CloudImage } from './CloudMedia';
import {
  getFileTypeMeta,
  isImageAttachment,
  saveAttachmentToLocalDevice,
} from '../services/fileTransfer';

interface CardImageProps {
  src?: string;
  alt: string;
  label: string;
}

export const ResilientCardImage: React.FC<CardImageProps> = ({ src, alt, label }) => {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div className="flex h-32 w-full flex-col items-center justify-center bg-zinc-100 px-4 text-center dark:bg-zinc-900">
        <FileText className="h-5 w-5 text-[var(--relay-text-faint)]" />
        <span className="mt-1.5 text-xs font-medium text-[var(--relay-text-muted)]">
          {label}
        </span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="h-36 w-full object-cover"
    />
  );
};

interface InteractiveCardRendererProps {
  card: InteractiveCard;
  onToggleSaveBriefing: (item: BriefingItem) => void;
  onOpenBriefing: (item: BriefingItem) => void;
  onAskAboutBriefing: (item: BriefingItem) => void;
  onToggleReminder: (item: ReminderItem) => void;
  onSnoozeReminder: (item: ReminderItem) => void;
  onSyncReminder: (item: ReminderItem) => void;
  onResolveApproval: (actionId: string, decision: 'approved' | 'rejected') => void;
  onExecuteDeviceAction?: (action: DeviceActionItem) => void;
  onPreviewFile: (file: MeshFileItem) => void;
  onAskAboutFile: (file: MeshFileItem) => void;
  onAskAboutMap?: (item: MapCardItem) => void;
  serverUrl?: string;
  onOpenLightbox?: (img: { src: string; name: string }) => void;
  onShowToast?: (msg: string) => void;
}

const NODE_LABELS: Record<'cloud' | 'pc' | 'android', string> = {
  cloud: '云服务器',
  pc: '个人电脑 (Tailscale)',
  android: 'Android 手机',
};

export const InteractiveCardRenderer: React.FC<InteractiveCardRendererProps> = ({
  card,
  onToggleSaveBriefing,
  onOpenBriefing,
  onAskAboutBriefing,
  onToggleReminder,
  onSnoozeReminder,
  onSyncReminder,
  onResolveApproval,
  onExecuteDeviceAction,
  onPreviewFile,
  onAskAboutFile,
  onAskAboutMap,
  serverUrl,
  onOpenLightbox,
  onShowToast,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [downloadingFile, setDownloadingFile] = useState(false);
  const [downloadedFile, setDownloadedFile] = useState(false);

  if (card.type === 'map') {
    return <InteractiveMapCard item={card.data} onAskAboutMap={onAskAboutMap} />;
  }

  if (card.type === 'goal') {
    const goal = card.data;
    const total = goal.milestones.length;
    const doneCount = goal.milestones.filter((m) => m.done).length;
    return (
      <div className="muse-card rounded-[22px] p-4 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[14px] font-semibold text-[var(--relay-text)]">
              {goal.title}
            </div>
            <div className="mt-0.5 text-[11px] text-[var(--relay-text-faint)]">
              已同步至 Goals{total > 0 ? ` · ${doneCount}/${total}` : ''}
            </div>
          </div>
          <CheckCircle2 className="h-4 w-4 shrink-0 text-zinc-900 dark:text-zinc-100" />
        </div>
        {goal.milestones.length > 0 && (
          <div className="space-y-1 border-t border-black/[0.06] pt-2.5 dark:border-white/10">
            {goal.milestones.map((m) => (
              <div
                key={m.id}
                className="flex items-center gap-2 text-xs text-[var(--relay-text-muted)]"
              >
                <span
                  className={`h-3.5 w-3.5 shrink-0 rounded border flex items-center justify-center ${
                    m.done
                      ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950'
                      : 'border-zinc-300 dark:border-zinc-600'
                  }`}
                >
                  {m.done && <Check className="h-2.5 w-2.5" />}
                </span>
                <span className={m.done ? 'line-through opacity-60' : ''}>{m.text}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (card.type === 'briefing') {
    const item = card.data;
    return (
      <div
        style={
          {
            '--tile-tint': item.kind === 'paper' ? 'var(--tint-blue)' : 'var(--tint-violet)',
            '--tile-angle': '166deg',
          } as React.CSSProperties
        }
        className="board-tile !p-0"
      >
        {item.imageUrl && (
          <div className="overflow-hidden rounded-t-[inherit] border-b border-[var(--relay-tile-border)]">
            <ResilientCardImage
              src={item.imageUrl}
              alt={item.title}
              label={item.kind === 'paper' ? '论文精读卡片' : '每日科技简报'}
            />
          </div>
        )}
        <div className="p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[var(--relay-text-muted)]">
              <span className="font-medium text-[var(--accent-sky)]">
                {item.kind === 'paper' ? '论文精读' : '每日新闻'}
              </span>
              <span aria-hidden="true">·</span>
              <span>{item.source}</span>
              {item.identifier && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono-tabular">{item.identifier}</span>
                </>
              )}
              <span aria-hidden="true">·</span>
              <span className="font-mono-tabular">{item.readMinutes} 分钟</span>
            </div>
            <button
              type="button"
              onClick={() => onToggleSaveBriefing(item)}
              aria-label={item.saved ? '取消收藏' : '收藏到简报'}
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors ${
                item.saved
                  ? 'bg-amber-500/15 text-[var(--accent-amber)]'
                  : 'text-[var(--relay-text-faint)] hover:bg-black/[0.05] hover:text-[var(--relay-text)] dark:hover:bg-white/10'
              }`}
            >
              <Bookmark className="h-4 w-4" fill={item.saved ? 'currentColor' : 'none'} />
            </button>
          </div>

          <h4 className="mt-2 text-[15px] font-semibold leading-snug text-[var(--relay-text)]">
            {item.title}
          </h4>

          <p className="mt-2 text-xs leading-relaxed text-[var(--relay-text-muted)]">
            {item.summary}
          </p>

          {expanded && (
            <div className="mt-3.5 space-y-2 border-t border-[var(--relay-tile-border)] pt-3">
              <div className="text-[11px] font-semibold text-[var(--relay-text)]">
                关键要点
              </div>
              <ul className="space-y-1.5 text-xs leading-relaxed text-[var(--relay-text-muted)]">
                {item.takeaways.map((point, idx) => (
                  <li key={idx} className="flex gap-2">
                    <span className="mt-0.5 font-mono-tabular text-[11px] font-medium text-[var(--accent-sky)]">
                      0{idx + 1}.
                    </span>
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
              {item.relevanceNote && (
                <p className="pt-1 text-[11px] leading-relaxed text-[var(--relay-text-faint)]">
                  关联建议：{item.relevanceNote}
                </p>
              )}
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--relay-tile-border)] pt-3">
            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-zinc-100 px-3 py-1.5 text-xs font-medium text-[var(--relay-text)] transition-colors hover:bg-zinc-200/80 whitespace-nowrap shrink-0 dark:bg-white/10 dark:hover:bg-white/16"
            >
              {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              <span>{expanded ? '收起要点' : '展开要点'}</span>
            </button>
            <button
              type="button"
              onClick={() => onOpenBriefing(item)}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-black/[0.09] px-3 py-1.5 text-xs font-medium text-[var(--relay-text)] transition-colors hover:bg-zinc-50 whitespace-nowrap shrink-0 dark:border-white/15 dark:hover:bg-white/10"
            >
              <span>全文精读</span>
            </button>
            <button
              type="button"
              onClick={() => onAskAboutBriefing(item)}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-500 whitespace-nowrap shrink-0"
            >
              <MessageSquarePlus className="h-3.5 w-3.5" />
              <span>深入解读</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (card.type === 'reminder') {
    const item = card.data;
    return (
      <div
        style={
          {
            '--tile-tint': 'var(--tint-amber)',
            '--tile-angle': '176deg',
          } as React.CSSProperties
        }
        className="board-tile"
      >
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={() => onToggleReminder(item)}
            aria-label={item.completed ? '标记为未完成' : '标记为已完成'}
            className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border transition-colors ${
              item.completed
                ? 'border-emerald-500 bg-emerald-500 text-white'
                : 'border-black/20 bg-zinc-50 hover:border-amber-500 dark:border-white/25 dark:bg-zinc-900'
            }`}
          >
            {item.completed && <Check className="h-3.5 w-3.5" />}
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 text-xs text-[var(--relay-text-muted)]">
              <span className="font-medium text-[var(--accent-amber)]">日常提醒</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono-tabular">{item.dueLabel}</span>
              {item.repeat && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{item.repeat}</span>
                </>
              )}
              <span aria-hidden="true">·</span>
              <span>
                {item.channel === 'ntfy'
                  ? 'ntfy 推送'
                  : item.channel === 'browser'
                    ? '浏览器通知'
                    : '通知栏提醒'}
              </span>
            </div>
            <h4
              className={`mt-1.5 text-sm font-semibold leading-snug ${
                item.completed
                  ? 'text-[var(--relay-text-faint)] line-through'
                  : 'text-[var(--relay-text)]'
              }`}
            >
              {item.title}
            </h4>
            {item.note && (
              <p className="mt-1.5 text-xs leading-relaxed text-[var(--relay-text-muted)]">
                {item.note}
              </p>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--relay-tile-border)] pt-3">
          <button
            type="button"
            onClick={() => onToggleReminder(item)}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-zinc-900 px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-zinc-800 whitespace-nowrap shrink-0 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>{item.completed ? '已完成' : '标记完成'}</span>
          </button>
          <button
            type="button"
            onClick={() => onSnoozeReminder(item)}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-black/[0.09] bg-zinc-50 px-3 py-1.5 text-xs font-medium text-[var(--relay-text)] transition-colors hover:bg-zinc-100 whitespace-nowrap shrink-0 dark:border-white/15 dark:bg-white/6 dark:hover:bg-white/12"
          >
            <Clock className="h-3.5 w-3.5" />
            <span>延后 30 分钟</span>
          </button>
          <button
            type="button"
            onClick={() => onSyncReminder(item)}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-amber-500/14 px-3 py-1.5 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-500/22 whitespace-nowrap shrink-0 dark:text-amber-300"
          >
            <span>同步到目标提醒</span>
          </button>
        </div>
      </div>
    );
  }

  if (card.type === 'approval') {
    const item: ApprovalAction = card.data;
    const isPcTarget =
      item.targetDevice.toLowerCase().includes('pc') ||
      item.targetDevice.includes('电脑') ||
      item.targetDevice.includes('工作站') ||
      item.targetDevice.includes('100.');

    return (
      <div
        style={
          {
            '--tile-tint': 'var(--tint-rose)',
            '--tile-angle': '184deg',
          } as React.CSSProperties
        }
        className="board-tile"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 text-[var(--relay-text-muted)]">
            <Terminal className="h-3.5 w-3.5 text-[var(--accent-rose)]" />
            <span className="font-medium text-amber-600 dark:text-amber-300">
              {item.status === 'pending'
                ? '等待确认执行'
                : item.status === 'approved'
                  ? '已批准并下发'
                  : '已拒绝执行'}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono-tabular">{item.targetDevice}</span>
          </div>
        </div>

        <h4 className="mt-2 text-sm font-semibold text-[var(--relay-text)]">
          {item.title}
        </h4>

        <pre className="mt-2.5 overflow-x-auto rounded-xl border border-black/[0.08] bg-zinc-900 px-3.5 py-2.5 font-mono-tabular text-xs leading-relaxed text-zinc-100 dark:border-white/10">
          {item.commandPreview}
        </pre>

        <p className="mt-2.5 text-xs leading-relaxed text-[var(--relay-text-muted)]">
          {item.impactNote}
        </p>

        {item.resultOutput && (
          <div className="mt-3 border-t border-[var(--relay-tile-border)] pt-2.5 text-xs font-medium text-[var(--accent-mint)]">
            执行反馈：{item.resultOutput}
          </div>
        )}

        {item.status === 'pending' ? (
          <div className="mt-4 flex items-center gap-2 border-t border-[var(--relay-tile-border)] pt-3">
            <button
              type="button"
              onClick={() => onResolveApproval(item.id, 'approved')}
              className="inline-flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-500 whitespace-nowrap"
            >
              <CheckCircle2 className="h-4 w-4" />
              <span>批准执行</span>
            </button>
            <button
              type="button"
              onClick={() => onResolveApproval(item.id, 'rejected')}
              className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl border border-black/[0.09] bg-zinc-50 px-4 py-2 text-xs font-medium text-[var(--relay-text)] transition-colors hover:bg-zinc-100 whitespace-nowrap shrink-0 dark:border-white/15 dark:bg-white/6 dark:hover:bg-white/12"
            >
              <XCircle className="h-4 w-4" />
              <span>拒绝</span>
            </button>
          </div>
        ) : (
          <div className="mt-3.5 flex items-center gap-1.5 border-t border-[var(--relay-tile-border)] pt-3 text-xs font-medium">
            {item.status === 'approved' ? (
              <span className="inline-flex items-center gap-1.5 text-[var(--accent-mint)]">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {isPcTarget
                  ? '已通过云端 → Tailscale 下发至电脑执行'
                  : '已通过 Cloudflare Tunnel 下发执行'}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-[var(--relay-text-muted)]">
                <XCircle className="h-3.5 w-3.5" />
                本次操作已取消
              </span>
            )}
          </div>
        )}
      </div>
    );
  }

  if (card.type === 'device-action') {
    const item = card.data;
    const isReadAction =
      item.action.startsWith('read_') ||
      item.action === 'get_location' ||
      item.action === 'list_files';

    const ActionIcon =
      item.action === 'set_alarm' || item.action === 'set_timer'
        ? AlarmClock
        : item.action === 'add_calendar_event' || item.action === 'read_calendar'
          ? Calendar
          : item.action === 'write_clipboard' || item.action === 'read_clipboard'
            ? Clipboard
            : item.action === 'get_location'
              ? MapPin
              : item.action === 'read_notifications' || item.action === 'send_notification'
                ? Bell
                : item.action === 'save_file' || item.action === 'list_files'
                  ? FolderOpen
                  : Smartphone;

    return (
      <div
        style={
          {
            '--tile-tint': 'var(--tint-violet)',
            '--tile-angle': '172deg',
          } as React.CSSProperties
        }
        className="board-tile"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-sky-50 text-[var(--accent-sky)] dark:bg-white/10">
            <ActionIcon className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-medium text-[var(--accent-sky)]">
              Android 手机原生动作 · {item.action}
            </div>
            <h4 className="mt-0.5 text-sm font-semibold text-[var(--relay-text)]">
              {item.title}
            </h4>
            {item.summary && (
              <p className="mt-0.5 text-xs leading-relaxed text-[var(--relay-text-muted)]">
                {item.summary}
              </p>
            )}
          </div>
        </div>

        <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--relay-tile-border)] pt-3">
          {item.status === 'executed' ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--accent-mint)]">
              <CheckCircle2 className="h-4 w-4" />
              <span>{item.resultText || '已在手机上执行完成'}</span>
            </span>
          ) : item.status === 'failed' ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--accent-rose)]">
              <XCircle className="h-4 w-4" />
              <span>{item.resultText || '执行失败'}</span>
            </span>
          ) : (
            <span className="text-[11px] text-[var(--relay-text-faint)]">
              {isReadAction ? '点击授权读取并自动回传给云端助理' : '确认参数无误后点击立即在手机执行'}
            </span>
          )}

          {item.status !== 'executed' && onExecuteDeviceAction && (
            <button
              type="button"
              onClick={() => onExecuteDeviceAction(item)}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-1.5 text-xs font-medium text-white transition-transform active:scale-95 hover:bg-blue-500 whitespace-nowrap shrink-0"
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              <span>{isReadAction ? '读取并回传' : '立即执行'}</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  // File card
  const file = card.data;
  const fileMeta = getFileTypeMeta(file.name, file.mimeType || '');
  const isImageFile = isImageAttachment({
    name: file.name,
    mimeType: file.mimeType || '',
    dataUrl: file.dataUrl,
    url: file.downloadUrl,
  });
  const canDownloadFile = Boolean(
    file.dataUrl ||
      file.base64Data ||
      file.downloadUrl ||
      file.receiptId ||
      file.previewText ||
      (file.path && file.path.startsWith('/'))
  );

  const handleDownloadFile = async () => {
    if (downloadingFile) return;
    setDownloadingFile(true);
    try {
      const res = await saveAttachmentToLocalDevice(
        {
          name: file.name,
          mimeType: file.mimeType,
          dataUrl: file.dataUrl,
          base64Data: file.base64Data,
          textContent: file.previewText,
          url: file.downloadUrl,
          receiptId: file.receiptId,
          filePath: file.path,
        },
        serverUrl
      );
      setDownloadedFile(true);
      onShowToast?.(`已保存「${res.filename}」到 ${res.location}`);
      window.setTimeout(() => setDownloadedFile(false), 2200);
    } catch (err) {
      onShowToast?.(err instanceof Error ? err.message : '下载文件失败');
    } finally {
      setDownloadingFile(false);
    }
  };

  return (
    <div
      style={
        {
          '--tile-tint': fileMeta.tintVar || 'var(--tint-emerald)',
          '--tile-angle': '162deg',
        } as React.CSSProperties
      }
      className="board-tile"
    >
      <div className="flex items-start gap-3">
        <div
          className={`flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-xl bg-zinc-100 dark:bg-zinc-900 ${fileMeta.accentClass}`}
        >
          <AttachmentCategoryIcon category={fileMeta.category} className="h-4 w-4" />
          <span className="mt-0.5 text-[8px] font-bold tracking-wider leading-none">
            {fileMeta.badge}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 text-xs text-[var(--relay-text-muted)]">
            <span>{NODE_LABELS[file.sourceNode]}</span>
            {file.targetNode && (
              <>
                <ArrowRight className="h-3 w-3" />
                <span>{NODE_LABELS[file.targetNode]}</span>
              </>
            )}
            <span aria-hidden="true">·</span>
            <span className="font-mono-tabular">{file.size}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono-tabular">{file.updatedAt}</span>
          </div>
          <h4 className="mt-1 truncate text-sm font-semibold text-[var(--relay-text)]">
            {file.name}
          </h4>
          {file.path && (
            <p className="mt-0.5 truncate font-mono-tabular text-xs text-[var(--relay-text-faint)]">
              {file.path}
            </p>
          )}
        </div>
      </div>

      {isImageFile && (file.dataUrl || file.downloadUrl || file.receiptId) && (
        <div className="mt-3">
          <CloudImage
            src={file.dataUrl || file.downloadUrl}
            receiptId={file.receiptId}
            filePath={file.path}
            alt={file.name}
            serverUrl={serverUrl}
            className="max-h-60 max-w-full rounded-xl object-contain"
            onOpenLightbox={onOpenLightbox}
            onShowToast={onShowToast}
          />
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--relay-tile-border)] pt-3">
        {canDownloadFile && (
          <button
            type="button"
            onClick={() => void handleDownloadFile()}
            disabled={downloadingFile}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            {downloadingFile ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : downloadedFile ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            <span>{downloadedFile ? '已保存' : '下载保存到手机'}</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => onPreviewFile(file)}
          className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-black/[0.09] bg-zinc-50 px-3.5 py-1.5 text-xs font-medium text-[var(--relay-text)] transition-colors hover:bg-zinc-100 whitespace-nowrap shrink-0 dark:border-white/15 dark:bg-white/6 dark:hover:bg-white/12"
        >
          <span>预览内容</span>
        </button>
        <button
          type="button"
          onClick={() => onAskAboutFile(file)}
          className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-500 whitespace-nowrap shrink-0"
        >
          <MessageSquarePlus className="h-3.5 w-3.5" />
          <span>让 Agent 读取总结</span>
        </button>
      </div>
    </div>
  );
};
