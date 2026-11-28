import React, { useEffect, useState } from 'react';
import {
  Archive,
  Check,
  Download,
  FileCode2,
  FileSpreadsheet,
  FileText,
  Film,
  Image as ImageIcon,
  Loader2,
  Music,
  Presentation,
  RefreshCw,
} from 'lucide-react';
import type { ChatAttachment } from '../types/relay';
import {
  fetchCloudBinary,
  getFileTypeMeta,
  isAudioAttachment,
  isImageAttachment,
  isVideoAttachment,
  resolveCloudFileUrl,
  saveAttachmentToLocalDevice,
  type FileCategory,
} from '../services/fileTransfer';

export const AttachmentCategoryIcon: React.FC<{
  category: FileCategory;
  className?: string;
}> = ({ category, className = 'h-4 w-4' }) => {
  switch (category) {
    case 'image':
      return <ImageIcon className={className} />;
    case 'archive':
      return <Archive className={className} />;
    case 'audio':
      return <Music className={className} />;
    case 'video':
      return <Film className={className} />;
    case 'excel':
      return <FileSpreadsheet className={className} />;
    case 'ppt':
      return <Presentation className={className} />;
    case 'code':
      return <FileCode2 className={className} />;
    default:
      return <FileText className={className} />;
  }
};

interface CloudImageProps {
  src?: string;
  receiptId?: string;
  sessionId?: string;
  filePath?: string;
  alt: string;
  serverUrl?: string;
  className?: string;
  onOpenLightbox?: (img: { src: string; name: string }) => void;
  onShowToast?: (msg: string) => void;
  showSaveButton?: boolean;
}

/**
 * Smart image renderer that works for local dataUrls, public HTTPS URLs, and protected
 * DeepSeek Harness cloud URLs / receiptIds (automatically falling back to native OkHttp
 * binary download when Android WebView blocks cross-site <img> requests).
 */
export const CloudImage: React.FC<CloudImageProps> = ({
  src,
  receiptId,
  sessionId,
  filePath,
  alt,
  serverUrl,
  className = 'max-h-64 max-w-full rounded-2xl object-contain',
  onOpenLightbox,
  onShowToast,
  showSaveButton = true,
}) => {
  const initialSrc = resolveCloudFileUrl(src, serverUrl);
  const [resolvedSrc, setResolvedSrc] = useState<string>(initialSrc);
  const [loadingBinary, setLoadingBinary] = useState<boolean>(!initialSrc && Boolean(receiptId || filePath));
  const [failed, setFailed] = useState(false);
  const [triedBinaryFallback, setTriedBinaryFallback] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const next = resolveCloudFileUrl(src, serverUrl);
    setResolvedSrc(next);
    setFailed(false);
    setTriedBinaryFallback(false);

    if (!next && (receiptId || filePath)) {
      let cancelled = false;
      setLoadingBinary(true);
      void fetchCloudBinary(serverUrl, { receiptId, sessionId, filePath, filename: alt })
        .then((res) => {
          if (!cancelled) {
            setResolvedSrc(res.dataUrl);
            setLoadingBinary(false);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setFailed(true);
            setLoadingBinary(false);
          }
        });
      return () => {
        cancelled = true;
      };
    }
    setLoadingBinary(false);
  }, [src, receiptId, sessionId, filePath, serverUrl, alt]);

  const tryNativeFallback = async () => {
    if (triedBinaryFallback) {
      setFailed(true);
      return;
    }
    setTriedBinaryFallback(true);
    setLoadingBinary(true);
    try {
      const fetched = await fetchCloudBinary(serverUrl, {
        url: src,
        receiptId,
        sessionId,
        filePath,
        filename: alt,
      });
      setResolvedSrc(fetched.dataUrl);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoadingBinary(false);
    }
  };

  const handleSave = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (saving) return;
    setSaving(true);
    try {
      const res = await saveAttachmentToLocalDevice(
        {
          name: alt && /\.[a-z0-9]{2,5}$/i.test(alt) ? alt : `${alt || 'relay-image'}.png`,
          dataUrl: resolvedSrc.startsWith('data:') ? resolvedSrc : undefined,
          url: !resolvedSrc.startsWith('data:') ? resolvedSrc || src : undefined,
          receiptId,
          sessionId,
          filePath,
        },
        serverUrl
      );
      setSaved(true);
      onShowToast?.(`已保存图片「${res.filename}」到 ${res.location}`);
      window.setTimeout(() => setSaved(false), 2200);
    } catch (err) {
      onShowToast?.(err instanceof Error ? err.message : '保存图片失败');
    } finally {
      setSaving(false);
    }
  };

  if (loadingBinary) {
    return (
      <div className="inline-flex h-36 w-52 flex-col items-center justify-center gap-2 rounded-2xl border border-black/[0.08] bg-zinc-100/80 text-xs text-[var(--relay-text-muted)] dark:border-white/12 dark:bg-zinc-900">
        <Loader2 className="h-5 w-5 animate-spin text-[var(--accent-primary)]" />
        <span>正在拉取云端图片…</span>
      </div>
    );
  }

  if (failed || !resolvedSrc) {
    return (
      <div className="inline-flex items-center gap-2.5 rounded-2xl border border-black/[0.08] bg-zinc-50 px-3.5 py-2.5 text-xs text-[var(--relay-text-muted)] dark:border-white/12 dark:bg-zinc-900">
        <ImageIcon className="h-4 w-4 text-[var(--relay-text-faint)] shrink-0" />
        <div className="min-w-0">
          <div className="max-w-[180px] truncate font-medium text-[var(--relay-text)]">
            {alt || '云端图片'}
          </div>
          <div className="text-[11px] text-[var(--relay-text-faint)]">图片加载失败，可重试拉取</div>
        </div>
        <button
          type="button"
          onClick={() => {
            setTriedBinaryFallback(false);
            setFailed(false);
            void tryNativeFallback();
          }}
          className="inline-flex h-7 items-center gap-1 rounded-lg border border-black/[0.08] bg-white px-2 text-[11px] text-[var(--relay-text)] shadow-xs hover:bg-zinc-50 dark:border-white/15 dark:bg-white/8 dark:hover:bg-white/15"
        >
          <RefreshCw className="h-3 w-3" />
          <span>重试</span>
        </button>
      </div>
    );
  }

  return (
    <div className="group/img relative inline-block max-w-full overflow-hidden rounded-2xl border border-black/[0.08] bg-zinc-100/70 dark:border-white/12 dark:bg-zinc-900">
      <button
        type="button"
        onClick={() => onOpenLightbox?.({ src: resolvedSrc, name: alt || '图片预览' })}
        className="block focus:outline-none"
      >
        <img
          src={resolvedSrc}
          alt={alt}
          loading="lazy"
          onError={() => void tryNativeFallback()}
          className={className}
        />
      </button>
      {showSaveButton && (
        <button
          type="button"
          onClick={(e) => void handleSave(e)}
          aria-label="保存图片"
          title="保存图片到手机"
          className="absolute right-2 bottom-2 inline-flex h-7 items-center gap-1 rounded-lg border border-white/25 bg-black/65 px-2 text-[11px] font-medium text-white backdrop-blur-md transition-opacity hover:bg-black/80 sm:opacity-0 sm:group-hover/img:opacity-100"
        >
          {saving ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : saved ? (
            <Check className="h-3 w-3 text-emerald-400" />
          ) : (
            <Download className="h-3 w-3" />
          )}
          <span>{saved ? '已保存' : '保存'}</span>
        </button>
      )}
    </div>
  );
};

interface FileAttachmentCardProps {
  att: ChatAttachment;
  serverUrl?: string;
  compact?: boolean;
  onOpenLightbox?: (img: { src: string; name: string }) => void;
  onShowToast?: (msg: string) => void;
}

/**
 * Universal attachment renderer for BOTH user-sent and cloud-received attachments:
 * supports images, audio, video, PDF, Office docs (Word/Excel/PPT), archives (ZIP/TAR),
 * code/text files, and arbitrary binary files with 1-tap Save/Download.
 */
export const FileAttachmentCard: React.FC<FileAttachmentCardProps> = ({
  att,
  serverUrl,
  compact = false,
  onOpenLightbox,
  onShowToast,
}) => {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [mediaSrc, setMediaSrc] = useState<string>(
    att.dataUrl || resolveCloudFileUrl(att.url, serverUrl)
  );
  const [loadingMedia, setLoadingMedia] = useState(false);

  const meta = getFileTypeMeta(att.name, att.mimeType);
  const isImage = isImageAttachment(att);
  const isAudio = isAudioAttachment(att);
  const isVideo = isVideoAttachment(att);

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const res = await saveAttachmentToLocalDevice(att, serverUrl);
      setSaved(true);
      onShowToast?.(`已保存「${res.filename}」到 ${res.location}`);
      window.setTimeout(() => setSaved(false), 2200);
    } catch (err) {
      onShowToast?.(err instanceof Error ? err.message : '保存文件失败');
    } finally {
      setSaving(false);
    }
  };

  const handleLoadRemoteMedia = async () => {
    if (loadingMedia) return;
    setLoadingMedia(true);
    try {
      const fetched = await fetchCloudBinary(serverUrl, {
        url: att.url,
        receiptId: att.receiptId,
        sessionId: att.sessionId,
        filePath: att.filePath,
        filename: att.name,
        mimeType: att.mimeType,
      });
      setMediaSrc(fetched.dataUrl);
    } catch (err) {
      onShowToast?.(err instanceof Error ? err.message : '拉取云端媒体失败');
    } finally {
      setLoadingMedia(false);
    }
  };

  if (isImage) {
    return (
      <CloudImage
        src={att.dataUrl || att.url}
        receiptId={att.receiptId}
        sessionId={att.sessionId}
        filePath={att.filePath}
        alt={att.name}
        serverUrl={serverUrl}
        className={compact ? 'max-h-52 max-w-[240px] object-cover' : 'max-h-72 max-w-full object-contain'}
        onOpenLightbox={onOpenLightbox}
        onShowToast={onShowToast}
      />
    );
  }

  const canDownload = Boolean(
    att.rawFile || att.dataUrl || att.base64Data || att.textContent || att.url || att.receiptId || att.filePath
  );

  return (
    <div className="mini-tile max-w-full rounded-2xl px-3 py-2.5 text-xs text-[var(--relay-text)]">
      <div className="flex items-center gap-2.5">
        <div
          className={`flex h-9 w-9 shrink-0 flex-col items-center justify-center rounded-xl bg-zinc-100 dark:bg-zinc-800 ${meta.accentClass}`}
        >
          <AttachmentCategoryIcon category={meta.category} className="h-4 w-4" />
          <span className="mt-0.5 text-[8px] font-bold tracking-wider leading-none">
            {meta.badge}
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="max-w-[210px] truncate font-medium text-[var(--relay-text)]">
            {att.name}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 font-mono-tabular text-[10px] text-[var(--relay-text-faint)]">
            <span>{att.size || '文件'}</span>
            {att.filePath && (
              <>
                <span aria-hidden="true">·</span>
                <span className="max-w-[130px] truncate">{att.filePath}</span>
              </>
            )}
          </div>
        </div>

        {canDownload && (
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            aria-label={`保存 ${att.name}`}
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-xl border border-black/[0.08] bg-zinc-50 px-2.5 text-[11px] font-medium text-[var(--relay-text)] transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-white/15 dark:bg-white/10 dark:hover:bg-white/18"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : saved ? (
              <Check className="h-3.5 w-3.5 text-emerald-500" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            <span>{saved ? '已保存' : '保存'}</span>
          </button>
        )}
      </div>

      {isAudio && (
        <div className="mt-2 border-t border-black/[0.06] pt-2 dark:border-white/10">
          {mediaSrc ? (
            <audio
              controls
              src={mediaSrc}
              onError={() => {
                if (!mediaSrc.startsWith('data:')) void handleLoadRemoteMedia();
              }}
              className="h-8 w-full max-w-[280px]"
            />
          ) : (
            <button
              type="button"
              onClick={() => void handleLoadRemoteMedia()}
              disabled={loadingMedia}
              className="text-[11px] text-[var(--accent-primary)] hover:underline"
            >
              {loadingMedia ? '正在加载音频…' : '点击加载播放音频'}
            </button>
          )}
        </div>
      )}

      {isVideo && (
        <div className="mt-2 border-t border-black/[0.06] pt-2 dark:border-white/10">
          {mediaSrc ? (
            <video
              controls
              playsInline
              src={mediaSrc}
              onError={() => {
                if (!mediaSrc.startsWith('data:')) void handleLoadRemoteMedia();
              }}
              className="max-h-56 w-full rounded-xl bg-zinc-900"
            />
          ) : (
            <button
              type="button"
              onClick={() => void handleLoadRemoteMedia()}
              disabled={loadingMedia}
              className="text-[11px] text-[var(--accent-primary)] hover:underline"
            >
              {loadingMedia ? '正在加载视频…' : '点击加载播放视频'}
            </button>
          )}
        </div>
      )}
    </div>
  );
};
