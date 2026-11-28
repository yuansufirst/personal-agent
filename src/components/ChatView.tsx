import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Check,
  ChevronDown,
  Copy,
  Download,
  Loader2,
  MessageSquareText,
  Paperclip,
  Search,
  X,
} from 'lucide-react';
import {
  ArrowDown,
  ArrowUp,
  ArrowsClockwise,
  CalendarBlank,
  ClipboardText,
  Clock,
  ComposerCardsIcon,
  ComposerDeviceIcon,
  ComposerFileIcon,
  ComposerImageIcon,
  ComposerMicIcon,
  FeedReminderIcon,
  FileText,
  FolderOpen,
  MapPinArea,
  Microphone,
  NavMenuIcon,
  PaperPlaneTilt,
  Plus,
  Sparkle,
  Stop,
  TerminalWindow,
  Trash,
} from './AppIcons';
import type {
  AgentProfile,
  BriefingItem,
  ChatAttachment,
  ChatMessage,
  ConnectionConfig,
  DeviceActionItem,
  DeviceCapabilityKey,
  MapCardItem,
  MeshFileItem,
  ReminderItem,
  SessionRecord,
} from '../types/relay';
import { SLASH_COMMANDS } from '../data/initialData';
import { InteractiveCardRenderer } from './InteractiveCards';
import { MarkdownMessage } from './MarkdownMessage';
import { AgentTraceBlock } from './AgentTraceBlock';
import { resolveAvatarSrc } from '../services/avatarPresets';
import { startVoiceRecognition, type SpeechSessionHandle } from '../services/nativeSpeech';
import { captureCapabilityContext } from '../services/deviceBridge';
import {
  INTERACTIVE_CARD_TRIGGERS,
  RELAY_CARDS_PROTOCOL_PROMPT,
  type CardQuickTrigger,
} from '../services/cardProtocol';
import {
  TEXT_FILE_EXT_REGEX,
  formatFileBytes,
  getFileTypeMeta,
  inferMimeTypeFromName,
  saveAttachmentToLocalDevice,
} from '../services/fileTransfer';
import { AttachmentCategoryIcon, FileAttachmentCard } from './CloudMedia';

interface ChatViewProps {
  messages: ChatMessage[];
  sessions: SessionRecord[];
  activeSession?: SessionRecord;
  agentProfile: AgentProfile;
  isLoadingSessions: boolean;
  isLoadingHistory: boolean;
  config: ConnectionConfig;
  isStreaming: boolean;
  onSendMessage: (text: string, attachments?: ChatAttachment[]) => void;
  onStopStreaming: () => void;
  onNewSession: () => void;
  onSelectSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onRefreshSessions: () => void;
  onBindSessionId: (remoteSessionId: string) => void;
  onOpenSettings: () => void;
  onOpenDrawer?: () => void;
  onToggleSaveBriefing: (item: BriefingItem) => void;
  onOpenBriefing: (item: BriefingItem) => void;
  onAskAboutBriefing: (item: BriefingItem) => void;
  onToggleReminder: (item: ReminderItem) => void;
  onSnoozeReminder: (item: ReminderItem) => void;
  onSyncReminder: (item: ReminderItem) => void;
  onResolveApproval: (actionId: string, decision: 'approved' | 'rejected') => void;
  onExecuteDeviceAction?: (action: DeviceActionItem) => void;
  onOpenDeviceHub?: () => void;
  onPreviewFile: (file: MeshFileItem) => void;
  onAskAboutFile: (file: MeshFileItem) => void;
  onAskAboutMap?: (item: MapCardItem) => void;
  onPreviewFiveCards?: () => void;
  onShowToast: (msg: string) => void;
}

const SANDBOX_QUICK_STARTERS = [
  '我想去上海外滩，查一下高德地图路线',
  '推送今天的 AI 论文简报',
  '提醒我今晚 9 点复盘周报',
  '读取电脑最新周报文件',
  '准备在电脑整理下载目录',
];

// File transfer helpers imported from ../services/fileTransfer

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('读取文本文件失败'));
    reader.readAsText(file);
  });
}

/**
 * Optional gentler image compression (only used when the user explicitly turns on "省流压缩").
 * Default behavior is original-quality upload (原图直传) without any downscaling or re-encoding.
 */
async function compressImageOptional(
  file: File
): Promise<{ file: File; dataUrl: string; mimeType: string; sizeBytes: number }> {
  const mime = file.type || inferMimeTypeFromName(file.name, 'image/jpeg');
  if (file.size <= 300_000 && (mime === 'image/jpeg' || mime === 'image/webp')) {
    return {
      file,
      dataUrl: file.size <= 160_000 ? await readFileAsDataUrl(file) : URL.createObjectURL(file),
      mimeType: mime,
      sizeBytes: file.size,
    };
  }

  const rawDataUrl = await readFileAsDataUrl(file);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const maxDim = 1600;
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const scale = Math.min(maxDim / width, maxDim / height);
        width = Math.max(1, Math.round(width * scale));
        height = Math.max(1, Math.round(height * scale));
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve({ file, dataUrl: URL.createObjectURL(file), mimeType: mime, sizeBytes: file.size });
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (!blob || blob.size >= file.size) {
            resolve({ file, dataUrl: URL.createObjectURL(file), mimeType: mime, sizeBytes: file.size });
            return;
          }
          const outName = file.name
            ? file.name.replace(/\.[a-z0-9]+$/i, '.jpg')
            : `image-${Date.now()}.jpg`;
          const compressedFile = new File([blob], outName, { type: 'image/jpeg' });
          resolve({
            file: compressedFile,
            dataUrl: URL.createObjectURL(compressedFile),
            mimeType: 'image/jpeg',
            sizeBytes: compressedFile.size,
          });
        },
        'image/jpeg',
        0.82
      );
    };
    img.onerror = () =>
      resolve({ file, dataUrl: URL.createObjectURL(file), mimeType: mime, sizeBytes: file.size });
    img.src = rawDataUrl;
  });
}

async function buildChatAttachment(file: File, compressImages: boolean): Promise<ChatAttachment> {
  const mimeType = file.type || inferMimeTypeFromName(file.name, 'application/octet-stream');

  if (mimeType.startsWith('image/')) {
    if (compressImages) {
      const compressed = await compressImageOptional(file);
      return {
        name: compressed.file.name || file.name || `image-${Date.now()}.jpg`,
        size: formatFileBytes(compressed.sizeBytes),
        sizeBytes: compressed.sizeBytes,
        mimeType: compressed.mimeType,
        dataUrl: compressed.dataUrl,
        rawFile: compressed.file,
        direction: 'upload',
      };
    }

    // Default: Original quality passthrough (原图直传, zero re-encoding or downscaling)
    const previewUrl =
      file.size <= 160_000 ? await readFileAsDataUrl(file) : URL.createObjectURL(file);
    return {
      name: file.name || `image-${Date.now()}.jpg`,
      size: formatFileBytes(file.size),
      sizeBytes: file.size,
      mimeType: mimeType || 'image/jpeg',
      dataUrl: previewUrl,
      rawFile: file,
      direction: 'upload',
    };
  }

  const size = formatFileBytes(file.size);

  if (file.size <= 1_000_000 && (mimeType.startsWith('text/') || TEXT_FILE_EXT_REGEX.test(file.name))) {
    const textContent = await readFileAsText(file);
    return {
      name: file.name,
      size,
      sizeBytes: file.size,
      mimeType: mimeType || inferMimeTypeFromName(file.name, 'text/plain'),
      textContent: textContent.slice(0, 120_000),
      rawFile: file,
      direction: 'upload',
    };
  }

  // Binary files (PDF, Word, Excel, PPT, ZIP, audio, video, large files):
  // Keep native File handle directly so multi-MB files stream as raw bytes without base64 memory bloat
  return {
    name: file.name,
    size,
    sizeBytes: file.size,
    mimeType,
    dataUrl:
      mimeType.startsWith('audio/') || mimeType.startsWith('video/')
        ? URL.createObjectURL(file)
        : undefined,
    rawFile: file,
    direction: 'upload',
  };
}

export const ChatView: React.FC<ChatViewProps> = ({
  messages,
  sessions,
  activeSession,
  agentProfile,
  isLoadingSessions,
  isLoadingHistory,
  config,
  isStreaming,
  onSendMessage,
  onStopStreaming,
  onNewSession,
  onSelectSession,
  onDeleteSession,
  onRefreshSessions,
  onBindSessionId,
  onOpenDrawer,
  onToggleSaveBriefing,
  onOpenBriefing,
  onAskAboutBriefing,
  onToggleReminder,
  onSnoozeReminder,
  onSyncReminder,
  onResolveApproval,
  onExecuteDeviceAction,
  onOpenDeviceHub,
  onPreviewFile,
  onAskAboutFile,
  onAskAboutMap,
  onPreviewFiveCards,
  onShowToast,
}) => {
  const [trayOpen, setTrayOpen] = useState(false);
  const [traySubPanel, setTraySubPanel] = useState<'none' | 'cards' | 'device'>('none');
  const [compressImages, setCompressImages] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [savingLightbox, setSavingLightbox] = useState(false);
  const [pendingCardTrigger, setPendingCardTrigger] = useState<CardQuickTrigger | null>(null);
  const [capturingCap, setCapturingCap] = useState<DeviceCapabilityKey | null>(null);

  const handleSelectCardTrigger = (trigger: CardQuickTrigger) => {
    setTrayOpen(false);
    setTraySubPanel('none');
    setPendingCardTrigger(trigger);
    setInput((prev) => (prev.trim() ? prev : trigger.promptPrefix));
    textareaRef.current?.focus();
  };

  const handleTeachCardProtocol = () => {
    setTrayOpen(false);
    setTraySubPanel('none');
    onSendMessage(RELAY_CARDS_PROTOCOL_PROMPT);
    onShowToast('已将 5 种交互卡片协议发给云端助理');
  };

  const handleInjectDeviceContext = async (cap: DeviceCapabilityKey) => {
    setCapturingCap(cap);
    try {
      const snap = await captureCapabilityContext(cap);
      setInput((prev) => (prev.trim() ? `${prev.trim()}\n\n${snap.text}` : snap.text));
      setTrayOpen(false);
      setTraySubPanel('none');
      onShowToast(`已插入「${snap.title}」到输入框`);
      textareaRef.current?.focus();
    } catch (err) {
      onShowToast(err instanceof Error ? err.message : '获取手机上下文失败');
    } finally {
      setCapturingCap(null);
    }
  };

  const safeSession: SessionRecord = activeSession || {
    id: 'fallback',
    title: '新会话',
    updatedAt: '',
    source: 'local',
    messages: [],
  };

  const avatarSrc = resolveAvatarSrc(agentProfile);

  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [processingFiles, setProcessingFiles] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [voiceSeconds, setVoiceSeconds] = useState(0);
  const [sessionSheetOpen, setSessionSheetOpen] = useState(false);
  const [sessionSearch, setSessionSearch] = useState('');
  const [manualSessionInput, setManualSessionInput] = useState('');
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const [lightboxImage, setLightboxImage] = useState<{ src: string; name: string } | null>(null);
  const [showScrollDown, setShowScrollDown] = useState(false);

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const isNearBottomRef = useRef<boolean>(true);
  const didInitialScrollRef = useRef<boolean>(false);
  const prevSessionIdRef = useRef<string>(safeSession.id);
  const prevMsgCountRef = useRef<number>(messages.length);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const speechSessionRef = useRef<SpeechSessionHandle | null>(null);
  const voiceBaseInputRef = useRef<string>('');
  const voiceDiscardRef = useRef<boolean>(false);
  const voiceAutoSendRef = useRef<boolean>(false);
  const latestInputRef = useRef<string>('');

  useEffect(() => {
    latestInputRef.current = input;
  }, [input]);

  // Live MM:SS voice recording timer
  useEffect(() => {
    if (!listening) return;
    setVoiceSeconds(0);
    const id = window.setInterval(() => {
      setVoiceSeconds((s) => s + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, [listening]);

  const formattedVoiceTime = useMemo(() => {
    const mins = Math.floor(voiceSeconds / 60);
    const secs = voiceSeconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }, [voiceSeconds]);

  const showSlashMenu = input.startsWith('/') && !input.includes(' ');
  const matchingCommands = showSlashMenu
    ? SLASH_COMMANDS.filter((c) => c.cmd.startsWith(input.toLowerCase()))
    : [];

  const filteredSheetSessions = useMemo(() => {
    const q = sessionSearch.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        (s.remoteSessionId && s.remoteSessionId.toLowerCase().includes(q))
    );
  }, [sessions, sessionSearch]);

  const handleStreamScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isNearBottomRef.current = distanceToBottom < 140;
    setShowScrollDown(distanceToBottom > 240);
  };

  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    const el = scrollContainerRef.current;
    if (!el) return;
    if (behavior === 'auto') {
      el.scrollTop = el.scrollHeight;
    } else {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }
    isNearBottomRef.current = true;
    setShowScrollDown(false);
  };

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    const sessionChanged = prevSessionIdRef.current !== safeSession.id;
    const msgCountIncreased = messages.length > prevMsgCountRef.current;
    prevSessionIdRef.current = safeSession.id;
    prevMsgCountRef.current = messages.length;

    if (!didInitialScrollRef.current) {
      didInitialScrollRef.current = true;
      el.scrollTop = el.scrollHeight;
      isNearBottomRef.current = true;
      setShowScrollDown(false);
      return;
    }

    if (sessionChanged) {
      el.scrollTop = el.scrollHeight;
      isNearBottomRef.current = true;
      setShowScrollDown(false);
      return;
    }

    if (msgCountIncreased || (isStreaming && isNearBottomRef.current)) {
      bottomRef.current?.scrollIntoView({ behavior: isStreaming ? 'auto' : 'smooth' });
    }
  }, [safeSession.id, messages, isStreaming]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    if (!input) {
      el.style.height = '40px';
      return;
    }
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
  }, [input]);

  useEffect(() => {
    return () => {
      speechSessionRef.current?.stop();
    };
  }, []);

  const appendFiles = async (fileList: File[]) => {
    if (fileList.length === 0) return;
    setProcessingFiles(true);
    try {
      const processed: ChatAttachment[] = [];
      for (const file of fileList) {
        if (file.size > 100 * 1024 * 1024) {
          onShowToast(`${file.name} 超过 100 MB 限制，已跳过`);
          continue;
        }
        const att = await buildChatAttachment(file, compressImages);
        processed.push(att);
      }
      if (processed.length > 0) {
        setAttachments((prev) => [...prev, ...processed]);
      }
    } catch (err) {
      onShowToast(err instanceof Error ? err.message : '读取附件失败');
    } finally {
      setProcessingFiles(false);
    }
  };

  const handleAttachFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    setTrayOpen(false);
    setTraySubPanel('none');
    await appendFiles(selected);
  };

  const handleSaveLightboxImage = async () => {
    if (!lightboxImage || savingLightbox) return;
    setSavingLightbox(true);
    try {
      const res = await saveAttachmentToLocalDevice(
        {
          name:
            lightboxImage.name && /\.[a-z0-9]{2,5}$/i.test(lightboxImage.name)
              ? lightboxImage.name
              : `${lightboxImage.name || 'relay-image'}.png`,
          dataUrl: lightboxImage.src.startsWith('data:') ? lightboxImage.src : undefined,
          url: !lightboxImage.src.startsWith('data:') ? lightboxImage.src : undefined,
        },
        config.serverUrl
      );
      onShowToast(`已保存图片「${res.filename}」到 ${res.location}`);
    } catch (err) {
      onShowToast(err instanceof Error ? err.message : '保存图片失败');
    } finally {
      setSavingLightbox(false);
    }
  };

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData?.items || []);
    const pastedFiles: File[] = [];
    for (const item of items) {
      if (item.kind === 'file') {
        const f = item.getAsFile();
        if (f) pastedFiles.push(f);
      }
    }
    if (pastedFiles.length > 0) {
      e.preventDefault();
      await appendFiles(pastedFiles);
    }
  };

  const dispatchMessageText = (textOverride?: string) => {
    const trimmed = (textOverride ?? latestInputRef.current).trim();
    if ((!trimmed && attachments.length === 0) || processingFiles) return;

    if (trimmed === '/new') {
      onNewSession();
      setInput('');
      return;
    }

    const rawBody =
      trimmed ||
      (attachments.some((a) => a.mimeType.startsWith('image/'))
        ? '请查看这张图片'
        : '请查看这些附件');

    const finalPayload =
      pendingCardTrigger && config.mode !== 'sandbox'
        ? `${rawBody}\n\n[卡片格式提示] ${pendingCardTrigger.protocolHint}`
        : rawBody;

    onSendMessage(finalPayload, attachments.length > 0 ? attachments : undefined);
    setInput('');
    setAttachments([]);
    setPendingCardTrigger(null);
    setTrayOpen(false);
    setTraySubPanel('none');
  };

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (listening) {
      speechSessionRef.current?.stop();
      speechSessionRef.current = null;
      setListening(false);
    }
    dispatchMessageText();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleCopyMessage = async (msgId: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedMsgId(msgId);
      window.setTimeout(() => setCopiedMsgId((prev) => (prev === msgId ? null : prev)), 1800);
    } catch {
      onShowToast('复制失败，请手动长按选择文本');
    }
  };

  const handleStartVoice = async () => {
    if (listening || transcribing) return;
    setTrayOpen(false);
    setTraySubPanel('none');
    voiceDiscardRef.current = false;
    voiceAutoSendRef.current = false;
    voiceBaseInputRef.current = input.trim();

    const session = await startVoiceRecognition(
      {
        onTranscript: (transcript, isFinal) => {
          if (voiceDiscardRef.current) return;
          const prefix = voiceBaseInputRef.current;
          const combined = prefix ? `${prefix} ${transcript}` : transcript;
          setInput(combined);
          if (isFinal) {
            voiceBaseInputRef.current = combined;
            speechSessionRef.current = null;
            if (voiceAutoSendRef.current && combined.trim()) {
              voiceAutoSendRef.current = false;
              dispatchMessageText(combined);
            }
          }
        },
        onStateChange: (active) => {
          setListening(active);
        },
        onError: (msg) => {
          speechSessionRef.current = null;
          voiceAutoSendRef.current = false;
          setListening(false);
          if (!voiceDiscardRef.current) {
            onShowToast(msg);
          }
        },
      },
      {
        serverUrl: config.serverUrl,
        onBusyChange: (busy) => {
          if (voiceDiscardRef.current) {
            setTranscribing(false);
            return;
          }
          setTranscribing(busy);
        },
      }
    );

    if (session) {
      speechSessionRef.current = session;
    }
  };

  const handleCancelVoice = () => {
    voiceDiscardRef.current = true;
    voiceAutoSendRef.current = false;
    speechSessionRef.current?.stop();
    speechSessionRef.current = null;
    setListening(false);
    setTranscribing(false);
    setVoiceSeconds(0);
    setInput(voiceBaseInputRef.current);
  };

  const handleConfirmSendVoice = () => {
    voiceDiscardRef.current = false;
    voiceAutoSendRef.current = true;
    if (listening) {
      speechSessionRef.current?.stop();
      speechSessionRef.current = null;
      setListening(false);
      // If browser/native speech already populated interim text synchronously, send after brief grace tick
      window.setTimeout(() => {
        if (voiceAutoSendRef.current && !transcribing && latestInputRef.current.trim()) {
          voiceAutoSendRef.current = false;
          dispatchMessageText(latestInputRef.current);
        }
      }, 260);
    } else if (!transcribing && latestInputRef.current.trim()) {
      voiceAutoSendRef.current = false;
      dispatchMessageText(latestInputRef.current);
    }
  };

  const handleOpenSessionPicker = () => {
    setSessionSheetOpen(true);
    if (config.mode === 'dsh-bridge' && sessions.filter((s) => s.source === 'remote').length === 0) {
      onRefreshSessions();
    }
  };

  const handleManualBindSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = manualSessionInput.trim();
    if (!trimmed) return;
    onBindSessionId(trimmed);
    setManualSessionInput('');
    setSessionSheetOpen(false);
  };

  const activeShortId = safeSession.remoteSessionId
    ? safeSession.remoteSessionId.slice(0, 8)
    : undefined;

  const isVoiceMode = listening || transcribing;
  const hasDraftToSend = input.trim().length > 0 || attachments.length > 0;

  return (
    <div
      className="relative flex h-full flex-col bg-transparent"
      onDragOver={(e) => {
        if (e.dataTransfer?.types?.includes('Files')) {
          e.preventDefault();
          if (!isDraggingOver) setIsDraggingOver(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setIsDraggingOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setIsDraggingOver(false);
        const dropped = Array.from(e.dataTransfer?.files || []);
        if (dropped.length > 0) {
          void appendFiles(dropped);
        }
      }}
    >
      {isDraggingOver && (
        <div className="pointer-events-none absolute inset-3 z-40 flex flex-col items-center justify-center rounded-3xl border-2 border-dashed border-[#1B6EF3]/60 bg-white/90 backdrop-blur-md dark:bg-zinc-900/90">
          <FolderOpen weight="duotone" className="h-9 w-9 text-[#1B6EF3]" />
          <p className="mt-2 text-sm font-semibold text-[var(--relay-text)]">松手添加</p>
        </div>
      )}

      {/* Minimal Floating Muse Top Header */}
      <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-1.5 sm:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          {onOpenDrawer && (
            <button
              type="button"
              onClick={onOpenDrawer}
              aria-label="菜单"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-black/[0.08] bg-white shadow-xs transition-colors hover:bg-zinc-50 active:scale-95 dark:border-white/10 dark:bg-zinc-900 lg:hidden"
            >
              <NavMenuIcon className="h-[18px] w-[18px]" />
            </button>
          )}
          <button
            type="button"
            onClick={handleOpenSessionPicker}
            className="flex min-h-[38px] min-w-0 items-center gap-1.5 rounded-full px-3 py-1 text-left transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
          >
            <span className="max-w-[180px] truncate text-[14px] font-semibold tracking-tight text-[var(--relay-text)] sm:max-w-[320px]">
              {safeSession.title}
            </span>
            {activeShortId && (
              <>
                <span aria-hidden="true" className="text-zinc-300 dark:text-zinc-700">
                  ·
                </span>
                <span className="font-mono-tabular text-[11px] text-[var(--relay-text-faint)]">
                  {activeShortId}
                </span>
              </>
            )}
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--relay-text-faint)]" />
          </button>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {config.mode === 'dsh-bridge' && (
            <button
              type="button"
              onClick={onRefreshSessions}
              disabled={isLoadingSessions}
              aria-label="同步会话"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-black/[0.07] bg-white text-[#0284C7] shadow-xs transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:border-white/10 dark:bg-zinc-900 dark:text-sky-400"
            >
              <ArrowsClockwise
                weight="duotone"
                className={`h-4 w-4 ${isLoadingSessions ? 'animate-spin' : ''}`}
              />
            </button>
          )}

          {/* Circular AI Avatar Shortcut — tap to start voice input right here */}
          <button
            type="button"
            onClick={() => (isVoiceMode ? handleCancelVoice() : void handleStartVoice())}
            aria-label="点击语音对话"
            className="relative flex h-9 w-9 items-center justify-center rounded-full focus:outline-none active:scale-95"
          >
            {listening && (
              <span className="pointer-events-none absolute -inset-1 rounded-full bg-sky-400/25 animate-ping" />
            )}
            <img
              src={avatarSrc}
              alt={agentProfile.name}
              className={`relative h-9 w-9 rounded-full object-cover shadow-xs ring-2 transition-all ${
                isVoiceMode ? 'ring-sky-500' : 'ring-white dark:ring-zinc-800'
              }`}
            />
          </button>
        </div>
      </div>

      {/* Editorial Message Stream */}
      <div
        ref={scrollContainerRef}
        onScroll={handleStreamScroll}
        className="flex-1 overflow-y-auto px-4 pt-3 pb-4 sm:px-6"
      >
        <div className="mx-auto max-w-[740px] space-y-6 pb-3">
          {isLoadingHistory && messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-28 text-center text-[var(--relay-text-faint)]">
              <Loader2 className="h-5 w-5 animate-spin text-[#1B6EF3]" />
            </div>
          ) : messages.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              className="flex flex-col items-center justify-center py-24 sm:py-32 text-center"
            >
              <motion.button
                type="button"
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.94 }}
                onClick={() => void handleStartVoice()}
                aria-label="点击语音对话"
                className="relative rounded-full focus:outline-none"
              >
                {listening && (
                  <span className="pointer-events-none absolute -inset-2 rounded-full bg-sky-400/25 animate-ping" />
                )}
                <img
                  src={avatarSrc}
                  alt={agentProfile.name}
                  className={`relative h-20 w-20 rounded-full object-cover shadow-md ring-2 transition-all ${
                    isVoiceMode ? 'ring-sky-500' : 'ring-white dark:ring-zinc-800'
                  }`}
                />
                <span
                  className={`absolute right-0 bottom-0 flex h-6 w-6 items-center justify-center rounded-full border shadow-xs ${
                    isVoiceMode
                      ? 'border-sky-500 bg-sky-500 text-white'
                      : 'border-black/[0.08] bg-white text-sky-600 dark:border-white/12 dark:bg-zinc-900 dark:text-sky-400'
                  }`}
                >
                  <Microphone weight={isVoiceMode ? 'fill' : 'duotone'} className="h-3.5 w-3.5" />
                </span>
              </motion.button>
              <h2 className="mt-4 text-lg font-semibold tracking-tight text-[var(--relay-text)]">
                {safeSession.remoteSessionId ? safeSession.title : agentProfile.name}
              </h2>
            </motion.div>
          ) : (
            messages.map((msg) => {
              const isUser = msg.role === 'user';
              return (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                  className={isUser ? 'flex justify-end' : 'group'}
                >
                  {isUser ? (
                    <div className="flex max-w-[90%] items-start justify-end gap-2 sm:max-w-[78%]">
                      <div className="min-w-0 space-y-2">
                        {msg.attachments && msg.attachments.length > 0 && (
                          <div className="flex flex-wrap justify-end gap-2">
                            {msg.attachments.map((att, idx) => (
                              <FileAttachmentCard
                                key={`${msg.id}-uatt-${idx}`}
                                att={att}
                                serverUrl={config.serverUrl}
                                compact
                                onOpenLightbox={setLightboxImage}
                                onShowToast={onShowToast}
                              />
                            ))}
                          </div>
                        )}
                        {msg.content && (
                          <div className="chat-bubble-user rounded-[24px] rounded-tr-[8px] px-4 py-3 text-[15px] leading-relaxed text-[var(--relay-text)] whitespace-pre-wrap">
                            {msg.content}
                          </div>
                        )}
                        <div className="pr-1.5 text-right font-mono-tabular text-[11px] text-[var(--relay-text-faint)]">
                          {msg.timestamp}
                        </div>
                      </div>
                      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-black/[0.08] bg-white text-[11px] font-semibold text-zinc-600 shadow-xs dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-300">
                        Me
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-2.5 sm:gap-3">
                      <button
                        type="button"
                        onClick={() => void handleStartVoice()}
                        aria-label="点击语音对话"
                        className="mt-0.5 shrink-0 rounded-full focus:outline-none active:scale-90"
                      >
                        <img
                          src={avatarSrc}
                          alt={agentProfile.name}
                          className="h-8 w-8 rounded-full object-cover shadow-xs ring-1 ring-black/[0.08] transition-all hover:ring-sky-400 dark:ring-white/15"
                        />
                      </button>
                      <div className="min-w-0 max-w-[90%] sm:max-w-[84%] space-y-2">
                        <AgentTraceBlock
                          thinking={msg.thinking}
                          toolSteps={msg.toolSteps}
                          elapsedMs={msg.elapsedMs}
                          streaming={msg.streaming}
                        />

                        {msg.content && (
                          <div className="chat-bubble-assistant rounded-[24px] rounded-tl-[8px] px-4.5 py-3.5 text-[var(--relay-text)]">
                            <MarkdownMessage
                              content={msg.content}
                              serverUrl={config.serverUrl}
                              onOpenLightbox={setLightboxImage}
                              onShowToast={onShowToast}
                            />
                          </div>
                        )}

                        {msg.attachments && msg.attachments.length > 0 && (
                          <div className="flex flex-wrap gap-2 pt-0.5">
                            {msg.attachments.map((att, idx) => (
                              <FileAttachmentCard
                                key={`${msg.id}-aatt-${idx}`}
                                att={att}
                                serverUrl={config.serverUrl}
                                onOpenLightbox={setLightboxImage}
                                onShowToast={onShowToast}
                              />
                            ))}
                          </div>
                        )}

                        <div className="flex items-center gap-1.5 pl-1.5 text-[11px] text-[var(--relay-text-faint)]">
                          <span className="font-mono-tabular">{msg.timestamp}</span>
                          {msg.content && !msg.streaming && (
                            <button
                              type="button"
                              onClick={() => void handleCopyMessage(msg.id, msg.content)}
                              aria-label="复制"
                              className="inline-flex h-6 w-6 items-center justify-center rounded-lg text-[var(--relay-text-faint)] opacity-75 transition-all hover:bg-black/[0.05] hover:text-[var(--relay-text)] dark:hover:bg-white/10 sm:opacity-0 sm:group-hover:opacity-100"
                            >
                              {copiedMsgId === msg.id ? (
                                <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                              ) : (
                                <Copy className="h-3 w-3" />
                              )}
                            </button>
                          )}
                        </div>

                        {msg.cards && msg.cards.length > 0 && (
                          <div className="space-y-3 pt-1">
                            {msg.cards.map((card, idx) => (
                              <InteractiveCardRenderer
                                key={`${msg.id}-card-${idx}`}
                                card={card}
                                onToggleSaveBriefing={onToggleSaveBriefing}
                                onOpenBriefing={onOpenBriefing}
                                onAskAboutBriefing={onAskAboutBriefing}
                                onToggleReminder={onToggleReminder}
                                onSnoozeReminder={onSnoozeReminder}
                                onSyncReminder={onSyncReminder}
                                onResolveApproval={onResolveApproval}
                                onExecuteDeviceAction={onExecuteDeviceAction}
                                onPreviewFile={onPreviewFile}
                                onAskAboutFile={onAskAboutFile}
                                onAskAboutMap={onAskAboutMap}
                                serverUrl={config.serverUrl}
                                onOpenLightbox={setLightboxImage}
                                onShowToast={onShowToast}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </motion.div>
              );
            })
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Muse Floating Bottom Composer Dock */}
      <div className="relative px-3.5 pt-1 pb-2.5 sm:px-6 lg:pb-5">
        <div className="relative mx-auto max-w-[740px]">
          {/* Floating Jump-to-Bottom Button when user scrolled up */}
          <AnimatePresence>
            {showScrollDown && !trayOpen && (
              <motion.button
                type="button"
                initial={{ opacity: 0, y: 8, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.9 }}
                transition={{ duration: 0.16 }}
                onClick={() => scrollToBottom('smooth')}
                aria-label="回到底部"
                className="muse-pill absolute -top-12 right-1 z-20 flex h-9 w-9 items-center justify-center rounded-full text-zinc-700 hover:text-zinc-950 active:scale-95 dark:text-zinc-200"
              >
                <ArrowDown weight="bold" className="h-4 w-4" />
              </motion.button>
            )}
          </AnimatePresence>

          {/* Live Voice Interim Transcript Chip */}
          <AnimatePresence>
            {isVoiceMode && input.trim() && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6 }}
                className="mb-2 rounded-2xl border border-black/[0.07] bg-white px-3.5 py-2 text-xs leading-relaxed text-[var(--relay-text)] shadow-sm dark:border-white/10 dark:bg-zinc-900"
              >
                {input}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Slash Command Picker */}
          {matchingCommands.length > 0 && !isVoiceMode && (
            <div className="mac-card absolute bottom-full left-0 right-0 mb-2 overflow-hidden rounded-2xl">
              <div className="divide-y divide-black/[0.06] dark:divide-white/10">
                {matchingCommands.map((item) => (
                  <button
                    key={item.cmd}
                    type="button"
                    onClick={() => setInput(`${item.cmd} `)}
                    className="flex min-h-[44px] w-full items-center justify-between gap-3 px-4 py-2 text-left text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                  >
                    <span className="font-mono-tabular font-semibold text-[#1B6EF3] dark:text-blue-400">
                      {item.cmd}
                    </span>
                    <span className="truncate text-[var(--relay-text-muted)]">{item.hint}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Quick Starters — ONLY shown in sandbox demo mode */}
          {config.mode === 'sandbox' && !isVoiceMode && !trayOpen && (
            <div className="mb-2 flex items-center gap-1.5 overflow-x-auto pb-0.5">
              {SANDBOX_QUICK_STARTERS.map((text) => (
                <button
                  key={text}
                  type="button"
                  onClick={() => onSendMessage(text)}
                  className="mini-tile min-h-[34px] rounded-full px-3.5 py-1 text-xs font-medium text-[var(--relay-text-muted)] transition-colors hover:text-[#1B6EF3] whitespace-nowrap shrink-0"
                >
                  {text}
                </button>
              ))}
            </div>
          )}

          {/* Pending Attachments Strip */}
          {(attachments.length > 0 || processingFiles) && (
            <div className="mb-2 flex flex-wrap items-center gap-2">
              {attachments.map((att, idx) => {
                const meta = getFileTypeMeta(att.name, att.mimeType);
                return (
                  <div
                    key={`${att.name}-${idx}`}
                    className="mini-tile inline-flex items-center gap-2 rounded-2xl p-1.5 pr-2.5 text-xs text-[var(--relay-text)]"
                  >
                    {att.mimeType.startsWith('image/') && att.dataUrl ? (
                      <img
                        src={att.dataUrl}
                        alt={att.name}
                        className="h-9 w-9 rounded-xl object-cover shrink-0"
                      />
                    ) : (
                      <div
                        className={`flex h-9 w-9 flex-col items-center justify-center rounded-xl bg-zinc-100 dark:bg-zinc-800 shrink-0 ${meta.accentClass}`}
                      >
                        <AttachmentCategoryIcon category={meta.category} className="h-3.5 w-3.5" />
                        <span className="mt-0.5 text-[8px] font-bold tracking-wider leading-none">
                          {meta.badge}
                        </span>
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="max-w-[140px] truncate font-medium">{att.name}</div>
                      <div className="font-mono-tabular text-[11px] text-[var(--relay-text-faint)]">
                        {att.size}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== idx))}
                      aria-label="移除附件"
                      className="ml-0.5 flex h-6 w-6 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
              {processingFiles && (
                <div className="mini-tile inline-flex items-center gap-1.5 rounded-2xl px-3 py-2 text-xs text-[var(--relay-text-muted)]">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>正在处理附件…</span>
                </div>
              )}
            </div>
          )}

          {/* Active Card Mode Chip */}
          {pendingCardTrigger && (
            <div className="mb-2 flex items-center gap-2">
              <div className="mini-tile inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-medium text-[var(--relay-text)]">
                <ComposerCardsIcon className="h-3.5 w-3.5" />
                <span>{pendingCardTrigger.label}</span>
                <button
                  type="button"
                  onClick={() => setPendingCardTrigger(null)}
                  aria-label="取消"
                  className="ml-0.5 rounded-full p-0.5 text-[var(--relay-text-muted)] hover:bg-black/[0.06] hover:text-[var(--relay-text)] dark:hover:bg-white/10"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            </div>
          )}

          {/* Expandable '+' Action Tray */}
          <AnimatePresence>
            {trayOpen && !isVoiceMode && (
              <motion.div
                initial={{ opacity: 0, y: 10, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.98 }}
                transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                className="mac-card mb-2.5 overflow-hidden rounded-[26px] p-3.5"
              >
                {/* Primary 4-Icon Quick Row with Colored Duotone Icons */}
                <div className="grid grid-cols-4 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setTrayOpen(false);
                      imageInputRef.current?.click();
                    }}
                    className="flex min-h-[66px] flex-col items-center justify-center gap-1.5 rounded-2xl bg-emerald-50/70 px-2 py-2.5 text-zinc-700 transition-colors hover:bg-emerald-50 active:scale-95 dark:bg-emerald-500/10 dark:text-zinc-200"
                  >
                    <ComposerImageIcon className="h-[22px] w-[22px]" />
                    <span className="text-[11px] font-medium">图片</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setTrayOpen(false);
                      fileInputRef.current?.click();
                    }}
                    className="flex min-h-[66px] flex-col items-center justify-center gap-1.5 rounded-2xl bg-amber-50/70 px-2 py-2.5 text-zinc-700 transition-colors hover:bg-amber-50 active:scale-95 dark:bg-amber-500/10 dark:text-zinc-200"
                  >
                    <ComposerFileIcon className="h-[22px] w-[22px]" />
                    <span className="text-[11px] font-medium">文件</span>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setTraySubPanel((prev) => (prev === 'cards' ? 'none' : 'cards'))
                    }
                    className={`flex min-h-[66px] flex-col items-center justify-center gap-1.5 rounded-2xl px-2 py-2.5 transition-colors active:scale-95 ${
                      traySubPanel === 'cards'
                        ? 'bg-violet-100/90 text-violet-950 ring-1 ring-violet-300 dark:bg-violet-500/25 dark:text-white dark:ring-violet-500/40'
                        : 'bg-violet-50/70 text-zinc-700 hover:bg-violet-50 dark:bg-violet-500/10 dark:text-zinc-200'
                    }`}
                  >
                    <ComposerCardsIcon className="h-[22px] w-[22px]" />
                    <span className="text-[11px] font-medium">卡片</span>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setTraySubPanel((prev) => (prev === 'device' ? 'none' : 'device'))
                    }
                    className={`flex min-h-[66px] flex-col items-center justify-center gap-1.5 rounded-2xl px-2 py-2.5 transition-colors active:scale-95 ${
                      traySubPanel === 'device'
                        ? 'bg-blue-100/90 text-blue-950 ring-1 ring-blue-300 dark:bg-blue-500/25 dark:text-white dark:ring-blue-500/40'
                        : 'bg-blue-50/70 text-zinc-700 hover:bg-blue-50 dark:bg-blue-500/10 dark:text-zinc-200'
                    }`}
                  >
                    <ComposerDeviceIcon className="h-[22px] w-[22px]" />
                    <span className="text-[11px] font-medium">手机</span>
                  </button>
                </div>

                {/* Compact Quality Toggle */}
                {traySubPanel === 'none' && (
                  <button
                    type="button"
                    onClick={() => setCompressImages((v) => !v)}
                    className="mt-2.5 flex w-full items-center justify-between rounded-xl border border-black/[0.06] bg-zinc-50/80 px-3 py-2 text-[11px] text-[var(--relay-text-muted)] transition-colors hover:bg-zinc-100 dark:border-white/10 dark:bg-zinc-800/50 dark:hover:bg-zinc-800"
                  >
                    <span className="font-mono-tabular">
                      {compressImages ? '压缩 ≤1600px' : '原图 · ≤100MB'}
                    </span>
                    <span className="font-medium text-[#1B6EF3] dark:text-blue-400">
                      {compressImages ? '切原图' : '原图'}
                    </span>
                  </button>
                )}

                {/* Sub-panel: 5 Interactive Cards */}
                {traySubPanel === 'cards' && (
                  <div className="mt-3 border-t border-black/[0.06] pt-3 dark:border-white/10">
                    <div className="mb-2 flex items-center justify-end gap-1.5">
                      {onPreviewFiveCards && (
                        <button
                          type="button"
                          onClick={() => {
                            setTrayOpen(false);
                            setTraySubPanel('none');
                            onPreviewFiveCards();
                          }}
                          className="inline-flex items-center gap-1 rounded-lg border border-black/[0.08] bg-white px-2.5 py-1 text-[11px] font-medium text-[var(--relay-text)] hover:bg-zinc-50 dark:border-white/10 dark:bg-zinc-800"
                        >
                          <Sparkle weight="regular" className="h-3.5 w-3.5 text-zinc-700 dark:text-zinc-200" />
                          <span>预览</span>
                        </button>
                      )}
                      {config.mode !== 'sandbox' && (
                        <button
                          type="button"
                          onClick={handleTeachCardProtocol}
                          className="inline-flex items-center gap-1 rounded-lg bg-zinc-950 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950"
                        >
                          <PaperPlaneTilt weight="regular" className="h-3.5 w-3.5" />
                          <span>协议</span>
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-5 gap-1.5">
                      {INTERACTIVE_CARD_TRIGGERS.map((trigger) => {
                        const iconNode =
                          trigger.key === 'map' ? (
                            <MapPinArea weight="regular" className="h-4 w-4 text-zinc-800 dark:text-zinc-100" />
                          ) : trigger.key === 'briefing' ? (
                            <FileText weight="regular" className="h-4 w-4 text-zinc-800 dark:text-zinc-100" />
                          ) : trigger.key === 'reminder' ? (
                            <CalendarBlank weight="regular" className="h-4 w-4 text-zinc-800 dark:text-zinc-100" />
                          ) : trigger.key === 'file' ? (
                            <Paperclip className="h-4 w-4 text-zinc-800 dark:text-zinc-100" />
                          ) : (
                            <TerminalWindow weight="regular" className="h-4 w-4 text-zinc-800 dark:text-zinc-100" />
                          );
                        return (
                          <button
                            key={trigger.key}
                            type="button"
                            onClick={() => handleSelectCardTrigger(trigger)}
                            className="mini-tile flex min-h-[54px] flex-col items-center justify-center gap-1 rounded-2xl p-2 text-center transition-transform active:scale-95"
                          >
                            {iconNode}
                            <span className="text-[11px] font-medium text-[var(--relay-text)]">
                              {trigger.label}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Sub-panel: Phone Context */}
                {traySubPanel === 'device' && (
                  <div className="mt-3 border-t border-black/[0.06] pt-3 dark:border-white/10">
                    {onOpenDeviceHub && (
                      <div className="mb-2 flex justify-end">
                        <button
                          type="button"
                          onClick={() => {
                            setTrayOpen(false);
                            setTraySubPanel('none');
                            onOpenDeviceHub();
                          }}
                          className="text-[11px] font-medium text-zinc-700 hover:underline dark:text-zinc-300"
                        >
                          权限 →
                        </button>
                      </div>
                    )}
                    <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
                      {(
                        [
                          ['clipboard', '剪贴板', <ClipboardText weight="regular" className="h-4 w-4 text-zinc-800 dark:text-zinc-100" />],
                          ['calendar', '日程', <CalendarBlank weight="regular" className="h-4 w-4 text-zinc-800 dark:text-zinc-100" />],
                          ['notifications', '通知', <FeedReminderIcon className="h-4 w-4" />],
                          ['sms', '短信', <MessageSquareText className="h-4 w-4 text-zinc-800 dark:text-zinc-100" />],
                          ['location', '位置', <MapPinArea weight="regular" className="h-4 w-4 text-zinc-800 dark:text-zinc-100" />],
                          ['time', '状态', <Clock weight="regular" className="h-4 w-4 text-zinc-800 dark:text-zinc-100" />],
                        ] as [DeviceCapabilityKey, string, React.ReactNode][]
                      ).map(([cap, label, iconNode]) => {
                        const busy = capturingCap === cap;
                        return (
                          <button
                            key={cap}
                            type="button"
                            disabled={Boolean(capturingCap)}
                            onClick={() => void handleInjectDeviceContext(cap)}
                            className="flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-2xl border border-black/[0.07] bg-zinc-50 px-2 py-2 text-[11px] font-medium text-[var(--relay-text)] transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-white/10 dark:bg-zinc-800/70 dark:hover:bg-zinc-800"
                          >
                            {busy ? (
                              <Loader2 className="h-4 w-4 animate-spin text-[#1B6EF3]" />
                            ) : (
                              iconNode
                            )}
                            <span className="whitespace-nowrap">{label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Hidden File Inputs */}
          <input
            ref={imageInputRef}
            type="file"
            multiple
            accept="image/*"
            className="hidden"
            onChange={handleAttachFile}
          />
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleAttachFile}
          />

          {/* Floating Muse Capsule Composer: Normal Message Mode vs Voice Recording Bar */}
          {isVoiceMode ? (
            <div className="chat-composer-glass flex min-h-[52px] items-center gap-2.5 rounded-full px-3 py-1.5">
              {/* Trash / Cancel Recording */}
              <button
                type="button"
                onClick={handleCancelVoice}
                aria-label="取消语音输入"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 active:scale-95 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              >
                <Trash weight="duotone" className="h-[18px] w-[18px]" />
              </button>

              {/* Elapsed Recording Timer */}
              <span className="font-mono-tabular w-9 shrink-0 text-[13px] font-medium text-zinc-500 dark:text-zinc-400">
                {formattedVoiceTime}
              </span>

              {/* Live Animated Waveform Bars + Trailing Dots */}
              <div className="flex flex-1 items-center justify-center gap-[3px] overflow-hidden px-1">
                {[10, 14, 18, 22, 16, 24, 20, 14, 18, 12, 15, 10].map((h, idx) => (
                  <span
                    key={`bar-${idx}`}
                    style={{
                      height: `${h}px`,
                      animationDelay: `${idx * 75}ms`,
                    }}
                    className={`w-[2.5px] shrink-0 rounded-full bg-zinc-800 dark:bg-zinc-200 ${
                      listening ? 'voice-wave-bar' : 'opacity-40'
                    }`}
                  />
                ))}
                {Array.from({ length: 12 }).map((_, idx) => (
                  <span
                    key={`dot-${idx}`}
                    className="h-[2.5px] w-[2.5px] shrink-0 rounded-full bg-zinc-400/80 dark:bg-zinc-500"
                  />
                ))}
              </div>

              {transcribing && (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-zinc-500 dark:text-zinc-400" />
              )}

              {/* Sky-Blue Up-Arrow Voice Send Button */}
              <button
                type="button"
                onClick={handleConfirmSendVoice}
                aria-label="完成并发送语音"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-200/90 text-sky-700 transition-all hover:bg-sky-300/90 active:scale-95 dark:bg-sky-500/25 dark:text-sky-300 dark:hover:bg-sky-500/35"
              >
                <ArrowUp weight="bold" className="h-[18px] w-[18px]" />
              </button>
            </div>
          ) : (
            <form
              onSubmit={handleSubmit}
              className="chat-composer-glass flex items-end gap-1.5 rounded-[28px] px-2 py-1.5 transition-shadow focus-within:border-black/[0.15] dark:focus-within:border-white/20"
            >
              {/* Left '+' Expandable Drawer Button */}
              <button
                type="button"
                onClick={() => {
                  setTrayOpen((prev) => {
                    if (prev) setTraySubPanel('none');
                    return !prev;
                  });
                }}
                aria-label={trayOpen ? '收起' : '展开'}
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition-all active:scale-95 ${
                  trayOpen
                    ? 'border-zinc-900 bg-zinc-900 text-white rotate-45 dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950'
                    : 'border-black/[0.08] bg-white text-zinc-700 hover:bg-zinc-50 dark:border-white/12 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700'
                }`}
              >
                <Plus weight="bold" className="h-[18px] w-[18px]" />
              </button>

              {/* Center Message Textarea */}
              <textarea
                ref={textareaRef}
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder="Message"
                className={`max-h-36 min-h-[40px] flex-1 resize-none bg-transparent px-1.5 py-2 text-[15px] leading-6 text-[var(--relay-text)] placeholder:text-zinc-400 focus:outline-none dark:placeholder:text-zinc-500 ${
                  !input ? 'h-[40px] overflow-hidden whitespace-nowrap' : ''
                }`}
              />

              {/* Right Morphing Button: Stop (streaming) / Up-Arrow (has text or files) / Mic (empty default) */}
              {isStreaming ? (
                <button
                  type="button"
                  onClick={onStopStreaming}
                  aria-label="停止"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-950 text-white transition-transform active:scale-95 hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950"
                >
                  <Stop weight="fill" className="h-4 w-4" />
                </button>
              ) : hasDraftToSend ? (
                <button
                  type="submit"
                  disabled={processingFiles}
                  aria-label="发送"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-950 text-white transition-all active:scale-95 hover:bg-[#1B6EF3] disabled:opacity-45 dark:bg-[#1B6EF3] dark:hover:bg-blue-500"
                >
                  <ArrowUp weight="bold" className="h-[18px] w-[18px]" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleStartVoice()}
                  aria-label="语音输入"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-black/[0.08] bg-sky-50/70 transition-all hover:bg-sky-100/80 active:scale-95 dark:border-white/12 dark:bg-sky-500/15 dark:hover:bg-sky-500/25"
                >
                  <ComposerMicIcon className="h-[19px] w-[19px]" />
                </button>
              )}
            </form>
          )}
        </div>
      </div>

      {/* Session Picker Sheet */}
      <AnimatePresence>
        {sessionSheetOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 backdrop-blur-sm sm:items-center sm:p-4"
            onClick={() => setSessionSheetOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, y: 24, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 18, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 380, damping: 32 }}
              className="mac-card flex max-h-[84vh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl border border-stone-200/90 dark:border-zinc-800 sm:rounded-3xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-stone-300 dark:bg-zinc-700 sm:hidden" />

              <div className="flex items-center justify-between border-b border-stone-200/70 px-5 py-3.5 dark:border-zinc-800">
                <div className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                  切换会话
                </div>
                <div className="flex items-center gap-1">
                  {config.mode === 'dsh-bridge' && (
                    <button
                      type="button"
                      onClick={onRefreshSessions}
                      disabled={isLoadingSessions}
                      className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl px-2.5 py-1 text-xs font-medium text-[#1B6EF3] hover:bg-blue-50 disabled:opacity-60 dark:text-blue-400 dark:hover:bg-blue-950/40"
                    >
                      <ArrowsClockwise
                        weight="duotone"
                        className={`h-3.5 w-3.5 ${isLoadingSessions ? 'animate-spin' : ''}`}
                      />
                      <span>同步</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setSessionSheetOpen(false)}
                    aria-label="关闭"
                    className="flex h-9 w-9 items-center justify-center rounded-xl text-zinc-500 hover:bg-stone-100 dark:hover:bg-zinc-800"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-4 py-3.5 space-y-3">
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
                    <input
                      type="text"
                      value={sessionSearch}
                      onChange={(e) => setSessionSearch(e.target.value)}
                      placeholder="搜索…"
                      className="min-h-[40px] w-full rounded-xl border border-stone-200 bg-[#F8F7F4] py-1.5 pr-3 pl-8.5 text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-[#1B6EF3] focus:bg-white focus:outline-none dark:border-zinc-700 dark:bg-[#0E0F12] dark:text-zinc-100"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      onNewSession();
                      setSessionSheetOpen(false);
                    }}
                    className="inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-xl bg-zinc-950 px-3.5 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-[#1B6EF3] dark:hover:bg-blue-600"
                  >
                    <Plus weight="bold" className="h-3.5 w-3.5" />
                    <span>新会话</span>
                  </button>
                </div>

                <div className="divide-y divide-stone-100 rounded-2xl border border-stone-200/80 dark:divide-zinc-800/80 dark:border-zinc-800">
                  {filteredSheetSessions.length === 0 ? (
                    <div className="px-4 py-8 text-center text-xs text-zinc-400">—</div>
                  ) : (
                    filteredSheetSessions.map((s) => {
                      const isActive = s.id === safeSession.id;
                      return (
                        <div
                          key={s.id}
                          className={`flex items-center justify-between gap-2 px-3.5 py-3 transition-colors first:rounded-t-2xl last:rounded-b-2xl ${
                            isActive
                              ? 'bg-stone-100/90 dark:bg-zinc-800/70'
                              : 'hover:bg-stone-50 dark:hover:bg-zinc-900/60'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              onSelectSession(s.id);
                              setSessionSheetOpen(false);
                            }}
                            className="min-w-0 flex-1 text-left"
                          >
                            <div className="flex items-center gap-1.5">
                              <span className="truncate text-xs font-medium text-zinc-900 dark:text-zinc-100">
                                {s.title}
                              </span>
                              {isActive && (
                                <Check className="h-3.5 w-3.5 shrink-0 text-[#1B6EF3] dark:text-blue-400" />
                              )}
                            </div>
                            <div className="mt-0.5 flex items-center gap-1.5 font-mono-tabular text-[11px] text-zinc-400">
                              <span>{s.source === 'remote' ? '云端' : '本地'}</span>
                              <span aria-hidden="true">·</span>
                              <span>{s.updatedAt}</span>
                              {s.remoteSessionId && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span>{s.remoteSessionId.slice(0, 8)}</span>
                                </>
                              )}
                            </div>
                          </button>

                          {sessions.length > 1 && (
                            <button
                              type="button"
                              onClick={() => onDeleteSession(s.id)}
                              aria-label="移除会话"
                              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-400 hover:bg-stone-200/70 hover:text-rose-600 dark:hover:bg-zinc-800 dark:hover:text-rose-400"
                            >
                              <Trash weight="duotone" className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>

                {config.mode === 'dsh-bridge' && (
                  <form onSubmit={handleManualBindSubmit} className="pt-1">
                    <label className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                      或直接粘贴已有 Session ID 接入
                    </label>
                    <div className="mt-1.5 flex items-center gap-2">
                      <input
                        type="text"
                        value={manualSessionInput}
                        onChange={(e) => setManualSessionInput(e.target.value)}
                        placeholder="粘贴服务端 sessionId…"
                        className="min-h-[40px] flex-1 rounded-xl border border-stone-200 bg-[#F8F7F4] px-3 py-1.5 font-mono-tabular text-xs text-zinc-900 focus:border-[#1B6EF3] focus:bg-white focus:outline-none dark:border-zinc-700 dark:bg-[#0E0F12] dark:text-zinc-100"
                      />
                      <button
                        type="submit"
                        disabled={!manualSessionInput.trim()}
                        className="min-h-[40px] rounded-xl bg-zinc-950 px-3.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-40 dark:bg-[#1B6EF3] dark:hover:bg-blue-600 whitespace-nowrap"
                      >
                        接入
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Fullscreen Image Lightbox */}
      <AnimatePresence>
        {lightboxImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-xs"
            onClick={() => setLightboxImage(null)}
          >
            <div
              className="absolute top-4 right-4 flex items-center gap-2"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => void handleSaveLightboxImage()}
                disabled={savingLightbox}
                className="inline-flex h-10 items-center gap-1.5 rounded-full bg-white/15 px-4 text-xs font-medium text-white backdrop-blur-md transition-colors hover:bg-white/25 disabled:opacity-50"
              >
                {savingLightbox ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                <span>保存图片</span>
              </button>
              <button
                type="button"
                onClick={() => setLightboxImage(null)}
                aria-label="关闭大图"
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <motion.img
              initial={{ scale: 0.94, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.94, opacity: 0 }}
              src={lightboxImage.src}
              alt={lightboxImage.name}
              className="max-h-[86vh] max-w-[94vw] rounded-2xl object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
