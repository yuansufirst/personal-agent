import React, { useState } from 'react';
import {
  ArrowRight,
  Bookmark,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  FileText,
  MessageSquarePlus,
  Terminal,
  XCircle,
} from 'lucide-react';
import type {
  ApprovalAction,
  BriefingItem,
  InteractiveCard,
  MeshFileItem,
  ReminderItem,
} from '../types/relay';

interface CardImageProps {
  src?: string;
  alt: string;
  label: string;
}

export const ResilientCardImage: React.FC<CardImageProps> = ({ src, alt, label }) => {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div className="flex h-36 w-full flex-col items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200/70 px-4 text-center dark:from-slate-800/80 dark:to-slate-900">
        <FileText className="h-6 w-6 text-slate-400 dark:text-slate-500" />
        <span className="mt-2 text-xs font-medium text-slate-500 dark:text-slate-400">
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
      className="h-40 w-full object-cover"
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
  onPreviewFile: (file: MeshFileItem) => void;
  onAskAboutFile: (file: MeshFileItem) => void;
}

const NODE_LABELS: Record<'cloud' | 'pc' | 'android', string> = {
  cloud: '云服务器',
  pc: '个人电脑',
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
  onPreviewFile,
  onAskAboutFile,
}) => {
  const [expanded, setExpanded] = useState(false);

  if (card.type === 'briefing') {
    const item = card.data;
    return (
      <div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white transition-colors dark:border-slate-800 dark:bg-[#131822]">
        {item.imageUrl && (
          <ResilientCardImage
            src={item.imageUrl}
            alt={item.title}
            label={item.kind === 'paper' ? '论文精读卡片' : '每日科技简报'}
          />
        )}
        <div className="p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
              <span className="font-medium text-blue-600 dark:text-blue-400">
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
                  ? 'text-blue-600 bg-blue-50 dark:bg-blue-950/60 dark:text-blue-400'
                  : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200'
              }`}
            >
              <Bookmark className="h-4 w-4" fill={item.saved ? 'currentColor' : 'none'} />
            </button>
          </div>

          <h4 className="mt-2 text-base font-semibold leading-snug text-slate-900 dark:text-slate-100">
            {item.title}
          </h4>

          <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            {item.summary}
          </p>

          {expanded && (
            <div className="mt-4 space-y-2.5 border-t border-slate-100 pt-3.5 dark:border-slate-800/80">
              <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                关键要点
              </div>
              <ul className="space-y-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                {item.takeaways.map((point, idx) => (
                  <li key={idx} className="flex gap-2.5">
                    <span className="font-mono-tabular text-xs font-medium text-blue-600 dark:text-blue-400 mt-0.5">
                      0{idx + 1}.
                    </span>
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
              <p className="pt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                关联建议：{item.relevanceNote}
              </p>
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3.5 dark:border-slate-800/80">
            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-slate-100 px-3.5 py-2 text-xs font-medium text-slate-800 transition-colors hover:bg-slate-200/80 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 whitespace-nowrap shrink-0"
            >
              {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              <span>{expanded ? '收起要点' : '展开要点'}</span>
            </button>
            <button
              type="button"
              onClick={() => onOpenBriefing(item)}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-slate-200 px-3.5 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <span>全文精读</span>
            </button>
            <button
              type="button"
              onClick={() => onAskAboutBriefing(item)}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-700 whitespace-nowrap shrink-0"
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
      <div className="rounded-2xl border border-slate-200/90 bg-white p-4 sm:p-5 dark:border-slate-800 dark:bg-[#131822]">
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={() => onToggleReminder(item)}
            aria-label={item.completed ? '标记为未完成' : '标记为已完成'}
            className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border transition-colors ${
              item.completed
                ? 'border-emerald-600 bg-emerald-600 text-white'
                : 'border-slate-300 bg-white hover:border-blue-500 dark:border-slate-600 dark:bg-slate-900'
            }`}
          >
            {item.completed && <Check className="h-3.5 w-3.5" />}
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 text-xs text-slate-500 dark:text-slate-400">
              <span className="font-medium text-blue-600 dark:text-blue-400">日常提醒</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono-tabular">{item.dueLabel}</span>
              {item.repeat && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{item.repeat}</span>
                </>
              )}
              <span aria-hidden="true">·</span>
              <span>{item.channel === 'ntfy' ? 'ntfy 推送' : item.channel === 'browser' ? '浏览器通知' : '应用内'}</span>
            </div>
            <h4
              className={`mt-1.5 text-sm font-semibold leading-snug ${
                item.completed
                  ? 'text-slate-400 line-through dark:text-slate-500'
                  : 'text-slate-900 dark:text-slate-100'
              }`}
            >
              {item.title}
            </h4>
            {item.note && (
              <p className="mt-1.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                {item.note}
              </p>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3.5 dark:border-slate-800/80">
          <button
            type="button"
            onClick={() => onToggleReminder(item)}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 whitespace-nowrap shrink-0"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>{item.completed ? '已完成' : '标记完成'}</span>
          </button>
          <button
            type="button"
            onClick={() => onSnoozeReminder(item)}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-slate-200 px-3.5 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            <Clock className="h-3.5 w-3.5" />
            <span>延后 30 分钟</span>
          </button>
          <button
            type="button"
            onClick={() => onSyncReminder(item)}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-blue-50 px-3.5 py-2 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-100 dark:bg-blue-950/60 dark:text-blue-300 dark:hover:bg-blue-950 whitespace-nowrap shrink-0"
          >
            <span>同步到提醒页</span>
          </button>
        </div>
      </div>
    );
  }

  if (card.type === 'approval') {
    const item: ApprovalAction = card.data;
    return (
      <div className="rounded-2xl border border-slate-200/90 bg-white p-4 sm:p-5 dark:border-slate-800 dark:bg-[#131822]">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
            <Terminal className="h-3.5 w-3.5 text-slate-500" />
            <span className="font-medium text-amber-700 dark:text-amber-400">
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

        <h4 className="mt-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
          {item.title}
        </h4>

        <pre className="mt-2.5 overflow-x-auto rounded-xl bg-slate-950 px-3.5 py-2.5 font-mono-tabular text-xs leading-relaxed text-slate-100 dark:bg-[#0B0E14]">
          {item.commandPreview}
        </pre>

        <p className="mt-2.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          {item.impactNote}
        </p>

        {item.resultOutput && (
          <div className="mt-3 border-t border-slate-100 pt-2.5 text-xs font-medium text-emerald-700 dark:border-slate-800/80 dark:text-emerald-400">
            执行反馈：{item.resultOutput}
          </div>
        )}

        {item.status === 'pending' ? (
          <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-3.5 dark:border-slate-800/80">
            <button
              type="button"
              onClick={() => onResolveApproval(item.id, 'approved')}
              className="inline-flex min-h-[42px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-700 whitespace-nowrap"
            >
              <CheckCircle2 className="h-4 w-4" />
              <span>批准执行</span>
            </button>
            <button
              type="button"
              onClick={() => onResolveApproval(item.id, 'rejected')}
              className="inline-flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <XCircle className="h-4 w-4" />
              <span>拒绝</span>
            </button>
          </div>
        ) : (
          <div className="mt-3.5 flex items-center gap-1.5 border-t border-slate-100 pt-3 text-xs font-medium dark:border-slate-800/80">
            {item.status === 'approved' ? (
              <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5" />
                已通过 Tailscale 下发执行
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                <XCircle className="h-3.5 w-3.5" />
                本次操作已取消
              </span>
            )}
          </div>
        )}
      </div>
    );
  }

  // File card
  const file = card.data;
  return (
    <div className="rounded-2xl border border-slate-200/90 bg-white p-4 sm:p-5 dark:border-slate-800 dark:bg-[#131822]">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
          <FileText className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 text-xs text-slate-500 dark:text-slate-400">
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
          <h4 className="mt-1 truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
            {file.name}
          </h4>
          <p className="mt-0.5 truncate font-mono-tabular text-xs text-slate-500 dark:text-slate-400">
            {file.path}
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3.5 dark:border-slate-800/80">
        <button
          type="button"
          onClick={() => onPreviewFile(file)}
          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-slate-200 px-3.5 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
        >
          <span>预览内容</span>
        </button>
        <button
          type="button"
          onClick={() => onAskAboutFile(file)}
          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-700 whitespace-nowrap shrink-0"
        >
          <MessageSquarePlus className="h-3.5 w-3.5" />
          <span>让 Agent 读取总结</span>
        </button>
      </div>
    </div>
  );
};
