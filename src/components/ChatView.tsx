import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowUp,
  Check,
  ChevronDown,
  Copy,
  FileText,
  Image as ImageIcon,
  Loader2,
  Mic,
  MicOff,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import type {
  AgentProfile,
  BriefingItem,
  ChatAttachment,
  ChatMessage,
  ConnectionConfig,
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
  onToggleSaveBriefing: (item: BriefingItem) => void;
  onOpenBriefing: (item: BriefingItem) => void;
  onAskAboutBriefing: (item: BriefingItem) => void;
  onToggleReminder: (item: ReminderItem) => void;
  onSnoozeReminder: (item: ReminderItem) => void;
  onSyncReminder: (item: ReminderItem) => void;
  onResolveApproval: (actionId: string, decision: 'approved' | 'rejected') => void;
  onPreviewFile: (file: MeshFileItem) => void;
  onAskAboutFile: (file: MeshFileItem) => void;
  onShowToast: (msg: string) => void;
}

const SANDBOX_QUICK_STARTERS = [
  '推送今天的 AI 论文简报',
  '提醒我今晚 9 点复盘周报',
  '读取电脑最新周报文件',
  '开启手机专注静音',
];

const TEXT_FILE_REGEX =
  /\.(txt|md|markdown|json|csv|tsv|log|yaml|yml|toml|xml|html|css|js|ts|tsx|jsx|py|sh|bash|go|rs|java|c|cpp|h|sql|ini|conf|env)$/i;

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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
 * Compresses large mobile photos to <=1280px JPEG so uploads over mobile Tailscale
 * complete reliably and quickly without hitting reverse-proxy payload size limits.
 */
async function compressImageIfNeeded(
  file: File,
  rawDataUrl: string
): Promise<{ dataUrl: string; mimeType: string; approxBytes: number }> {
  const mime = file.type || 'image/jpeg';
  if (file.size <= 320_000 && mime !== 'image/bmp') {
    return { dataUrl: rawDataUrl, mimeType: mime, approxBytes: file.size };
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const maxDim = 1280;
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
        resolve({ dataUrl: rawDataUrl, mimeType: mime, approxBytes: file.size });
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      const outMime = 'image/jpeg';
      const compressed = canvas.toDataURL(outMime, 0.8);
      const commaIdx = compressed.indexOf(',');
      const b64Len = commaIdx >= 0 ? compressed.length - commaIdx - 1 : compressed.length;
      resolve({
        dataUrl: compressed,
        mimeType: outMime,
        approxBytes: Math.round((b64Len * 3) / 4),
      });
    };
    img.onerror = () => resolve({ dataUrl: rawDataUrl, mimeType: mime, approxBytes: file.size });
    img.src = rawDataUrl;
  });
}

async function buildChatAttachment(file: File): Promise<ChatAttachment> {
  const mimeType = file.type || 'application/octet-stream';

  if (mimeType.startsWith('image/')) {
    const rawDataUrl = await readFileAsDataUrl(file);
    const processed = await compressImageIfNeeded(file, rawDataUrl);
    const commaIdx = processed.dataUrl.indexOf(',');
    const base64Data = commaIdx >= 0 ? processed.dataUrl.slice(commaIdx + 1) : processed.dataUrl;
    return {
      name: file.name || `image-${Date.now()}.jpg`,
      size: formatFileSize(processed.approxBytes),
      mimeType: processed.mimeType,
      dataUrl: processed.dataUrl,
      base64Data,
    };
  }

  const size = formatFileSize(file.size);

  if (mimeType.startsWith('text/') || TEXT_FILE_REGEX.test(file.name)) {
    const textContent = await readFileAsText(file);
    return {
      name: file.name,
      size,
      mimeType: mimeType || 'text/plain',
      textContent: textContent.slice(0, 120_000),
    };
  }

  const rawDataUrl = await readFileAsDataUrl(file);
  const commaIdx = rawDataUrl.indexOf(',');
  const base64Data = commaIdx >= 0 ? rawDataUrl.slice(commaIdx + 1) : rawDataUrl;
  return {
    name: file.name,
    size,
    mimeType,
    dataUrl: rawDataUrl,
    base64Data,
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
  onOpenSettings,
  onToggleSaveBriefing,
  onOpenBriefing,
  onAskAboutBriefing,
  onToggleReminder,
  onSnoozeReminder,
  onSyncReminder,
  onResolveApproval,
  onPreviewFile,
  onAskAboutFile,
  onShowToast,
}) => {
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
  const [sessionSheetOpen, setSessionSheetOpen] = useState(false);
  const [sessionSearch, setSessionSearch] = useState('');
  const [manualSessionInput, setManualSessionInput] = useState('');
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const [lightboxImage, setLightboxImage] = useState<{ src: string; name: string } | null>(null);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const speechSessionRef = useRef<SpeechSessionHandle | null>(null);
  const voiceBaseInputRef = useRef<string>('');

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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isStreaming]);

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
        if (file.size > 15 * 1024 * 1024) {
          onShowToast(`${file.name} 超过 15 MB 限制，已跳过`);
          continue;
        }
        const att = await buildChatAttachment(file);
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
    await appendFiles(selected);
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

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = input.trim();
    if ((!trimmed && attachments.length === 0) || processingFiles) return;

    if (listening) {
      speechSessionRef.current?.stop();
      speechSessionRef.current = null;
      setListening(false);
    }

    if (trimmed === '/new') {
      onNewSession();
      setInput('');
      return;
    }

    onSendMessage(
      trimmed ||
        (attachments.some((a) => a.mimeType.startsWith('image/'))
          ? '请查看这张图片'
          : '请查看这些附件'),
      attachments.length > 0 ? attachments : undefined
    );
    setInput('');
    setAttachments([]);
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

  const handleToggleVoice = async () => {
    if (listening) {
      speechSessionRef.current?.stop();
      speechSessionRef.current = null;
      setListening(false);
      return;
    }

    voiceBaseInputRef.current = input.trim();
    const session = await startVoiceRecognition({
      onTranscript: (transcript, isFinal) => {
        const prefix = voiceBaseInputRef.current;
        const combined = prefix ? `${prefix} ${transcript}` : transcript;
        setInput(combined);
        if (isFinal) {
          voiceBaseInputRef.current = combined;
          speechSessionRef.current = null;
        }
      },
      onStateChange: (active) => {
        setListening(active);
      },
      onError: (msg) => {
        speechSessionRef.current = null;
        onShowToast(msg);
      },
    });

    if (session) {
      speechSessionRef.current = session;
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

  return (
    <div className="relative flex h-full flex-col bg-[#F8F7F4] dark:bg-[#0E0F12]">
      {/* Quiet Session Header Bar */}
      <div className="flex items-center justify-between gap-2 border-b border-stone-200/70 bg-[#F8F7F4]/90 px-4 py-1.5 backdrop-blur-md dark:border-zinc-800/70 dark:bg-[#0E0F12]/90 sm:px-6">
        <button
          type="button"
          onClick={handleOpenSessionPicker}
          className="flex min-h-[36px] min-w-0 items-center gap-2 rounded-xl px-2 py-1 text-left transition-colors hover:bg-stone-200/60 dark:hover:bg-zinc-800/70"
        >
          <span className="max-w-[200px] truncate text-[13px] font-medium text-zinc-900 dark:text-zinc-100 sm:max-w-[340px]">
            {safeSession.title}
          </span>
          {activeShortId && (
            <>
              <span aria-hidden="true" className="text-stone-300 dark:text-zinc-700">
                ·
              </span>
              <span className="font-mono-tabular text-[11px] text-zinc-400">
                {activeShortId}
              </span>
            </>
          )}
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
        </button>

        <div className="flex items-center gap-1 shrink-0">
          {config.mode === 'dsh-bridge' && (
            <button
              type="button"
              onClick={onRefreshSessions}
              disabled={isLoadingSessions}
              aria-label="同步云端会话"
              className="inline-flex h-8 w-8 items-center justify-center rounded-xl text-zinc-500 transition-colors hover:bg-stone-200/60 hover:text-zinc-900 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isLoadingSessions ? 'animate-spin' : ''}`} />
            </button>
          )}
        </div>
      </div>

      {/* Editorial Message Stream */}
      <div className="flex-1 overflow-y-auto px-4 pt-6 pb-8 sm:px-6">
        <div className="mx-auto max-w-[740px] space-y-7 pb-4">
          {isLoadingHistory && messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-28 text-center text-zinc-400">
              <Loader2 className="h-5 w-5 animate-spin text-[#1B6EF3] dark:text-blue-400" />
              <p className="mt-3 text-xs">正在同步云端会话记录…</p>
            </div>
          ) : messages.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              className="flex flex-col items-center justify-center py-20 sm:py-28 text-center"
            >
              <motion.button
                type="button"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.96 }}
                onClick={onOpenSettings}
                title="点击自定义助理头像与名称"
                className="rounded-full focus:outline-none"
              >
                <img
                  src={avatarSrc}
                  alt={agentProfile.name}
                  className="h-16 w-16 rounded-full object-cover shadow-md ring-2 ring-white/80 dark:ring-zinc-700/80"
                />
              </motion.button>
              <h2 className="mt-5 text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
                {safeSession.remoteSessionId
                  ? safeSession.title
                  : `你好，我是 ${agentProfile.name}`}
              </h2>
              <p className="mt-2 max-w-md text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                {config.mode === 'dsh-bridge'
                  ? agentProfile.subtitle || '直接输入指令、发送图片或文档，或切换已有云端会话。'
                  : config.mode === 'openai-compatible'
                    ? `当前连接模型 · ${config.model || 'custom'}`
                    : '当前为本地体验模式，可在侧边栏设置中配置云端通道。'}
              </p>
            </motion.div>
          ) : (
            messages.map((msg) => {
              const isUser = msg.role === 'user';
              return (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                  className={isUser ? 'flex flex-col items-end' : 'group'}
                >
                  {isUser ? (
                    <div className="max-w-[88%] sm:max-w-[76%] space-y-2">
                      {msg.attachments && msg.attachments.length > 0 && (
                        <div className="flex flex-wrap justify-end gap-2">
                          {msg.attachments.map((att, idx) =>
                            att.mimeType.startsWith('image/') && att.dataUrl ? (
                              <button
                                key={idx}
                                type="button"
                                onClick={() => setLightboxImage({ src: att.dataUrl!, name: att.name })}
                                className="overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-xs transition-transform active:scale-[0.98] hover:scale-[1.01] dark:border-zinc-700"
                              >
                                <img
                                  src={att.dataUrl}
                                  alt={att.name}
                                  className="max-h-52 max-w-[240px] object-cover"
                                />
                              </button>
                            ) : (
                              <div
                                key={idx}
                                className="mac-card inline-flex items-center gap-2 rounded-2xl border border-stone-200/80 px-3 py-2 text-xs text-zinc-700 dark:border-zinc-800 dark:text-zinc-200"
                              >
                                <FileText className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
                                <span className="max-w-[160px] truncate font-medium">
                                  {att.name}
                                </span>
                                <span className="font-mono-tabular text-[11px] text-zinc-400">
                                  {att.size}
                                </span>
                              </div>
                            )
                          )}
                        </div>
                      )}
                      {msg.content && (
                        <div className="rounded-3xl rounded-br-lg bg-zinc-900 px-4.5 py-3 text-[15px] leading-relaxed text-zinc-50 whitespace-pre-wrap shadow-xs dark:bg-[#1B6EF3] dark:text-white">
                          {msg.content}
                        </div>
                      )}
                      <div className="pr-1 text-right font-mono-tabular text-[11px] text-zinc-400 dark:text-zinc-500">
                        {msg.timestamp}
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-3 sm:gap-3.5">
                      <img
                        src={avatarSrc}
                        alt={agentProfile.name}
                        className="mt-0.5 h-7 w-7 shrink-0 rounded-full object-cover ring-1 ring-stone-200/80 dark:ring-zinc-800"
                      />
                      <div className="min-w-0 flex-1 space-y-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 text-xs text-zinc-400">
                            <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                              {agentProfile.name}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono-tabular">{msg.timestamp}</span>
                          </div>
                          {msg.content && !msg.streaming && (
                            <button
                              type="button"
                              onClick={() => void handleCopyMessage(msg.id, msg.content)}
                              aria-label="复制回复内容"
                              className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] text-zinc-400 opacity-75 transition-all hover:bg-stone-200/70 hover:text-zinc-800 sm:opacity-0 sm:group-hover:opacity-100 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                            >
                              {copiedMsgId === msg.id ? (
                                <>
                                  <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                                  <span className="text-emerald-600 dark:text-emerald-400">
                                    已复制
                                  </span>
                                </>
                              ) : (
                                <>
                                  <Copy className="h-3 w-3" />
                                  <span>复制</span>
                                </>
                              )}
                            </button>
                          )}
                        </div>

                        <AgentTraceBlock
                          thinking={msg.thinking}
                          toolSteps={msg.toolSteps}
                          elapsedMs={msg.elapsedMs}
                          streaming={msg.streaming}
                        />

                        {msg.content && <MarkdownMessage content={msg.content} />}

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
                                onPreviewFile={onPreviewFile}
                                onAskAboutFile={onAskAboutFile}
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

      {/* Muse Floating Glass Composer Dock */}
      <div className="bg-gradient-to-t from-[#F8F7F4] via-[#F8F7F4]/95 to-transparent px-3 pt-2 pb-3 dark:from-[#0E0F12] dark:via-[#0E0F12]/95 sm:px-6 sm:pb-5">
        <div className="relative mx-auto max-w-[740px]">
          {/* Slash Command Picker */}
          {matchingCommands.length > 0 && (
            <div className="mac-card absolute bottom-full left-0 right-0 mb-2 overflow-hidden rounded-2xl border border-stone-200/80 dark:border-zinc-800">
              <div className="divide-y divide-stone-100 dark:divide-zinc-800/80">
                {matchingCommands.map((item) => (
                  <button
                    key={item.cmd}
                    type="button"
                    onClick={() => setInput(`${item.cmd} `)}
                    className="flex min-h-[44px] w-full items-center justify-between gap-3 px-4 py-2 text-left text-xs hover:bg-stone-50 dark:hover:bg-zinc-800/60"
                  >
                    <span className="font-mono-tabular font-semibold text-[#1B6EF3] dark:text-blue-400">
                      {item.cmd}
                    </span>
                    <span className="truncate text-zinc-500 dark:text-zinc-400">{item.hint}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Quick Starters — ONLY shown in sandbox demo mode */}
          {config.mode === 'sandbox' && (
            <div className="mb-2.5 flex items-center gap-1.5 overflow-x-auto pb-0.5">
              {SANDBOX_QUICK_STARTERS.map((text) => (
                <button
                  key={text}
                  type="button"
                  onClick={() => onSendMessage(text)}
                  className="mac-card min-h-[34px] rounded-2xl border border-stone-200/90 px-3.5 py-1 text-xs font-medium text-zinc-700 transition-colors hover:border-[#1B6EF3]/50 hover:text-[#1B6EF3] dark:border-zinc-800 dark:text-zinc-300 dark:hover:border-blue-500/60 dark:hover:text-blue-400 whitespace-nowrap shrink-0"
                >
                  {text}
                </button>
              ))}
            </div>
          )}

          {/* Pending Attachments Strip */}
          {(attachments.length > 0 || processingFiles) && (
            <div className="mb-2.5 flex flex-wrap items-center gap-2">
              {attachments.map((att, idx) => (
                <div
                  key={`${att.name}-${idx}`}
                  className="mac-card inline-flex items-center gap-2 rounded-2xl border border-stone-200/80 p-1.5 pr-2.5 text-xs text-zinc-700 dark:border-zinc-800 dark:text-zinc-200"
                >
                  {att.mimeType.startsWith('image/') && att.dataUrl ? (
                    <img
                      src={att.dataUrl}
                      alt={att.name}
                      className="h-9 w-9 rounded-xl object-cover shrink-0"
                    />
                  ) : (
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-stone-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-300 shrink-0">
                      {att.mimeType.startsWith('image/') ? (
                        <ImageIcon className="h-4 w-4" />
                      ) : (
                        <FileText className="h-4 w-4" />
                      )}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="max-w-[140px] truncate font-medium">{att.name}</div>
                    <div className="font-mono-tabular text-[11px] text-zinc-400">{att.size}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== idx))}
                    aria-label="移除附件"
                    className="ml-0.5 flex h-6 w-6 items-center justify-center rounded-lg text-zinc-400 hover:bg-stone-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              {processingFiles && (
                <div className="mac-card inline-flex items-center gap-1.5 rounded-2xl border border-stone-200/80 px-3 py-2 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>正在压缩附件…</span>
                </div>
              )}
            </div>
          )}

          {/* Floating Glass Capsule Form */}
          <form
            onSubmit={handleSubmit}
            className="mac-card flex items-end gap-1.5 rounded-3xl border border-stone-200/90 p-1.5 transition-colors focus-within:border-[#1B6EF3]/70 dark:border-zinc-800 dark:focus-within:border-blue-500/70"
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,.txt,.md,.json,.csv,.log,.py,.ts,.tsx,.js,.jsx,.yml,.yaml,.xml,.pdf"
              className="hidden"
              onChange={handleAttachFile}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              aria-label="上传图片或文件"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-stone-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            >
              <Paperclip className="h-[18px] w-[18px]" />
            </button>

            <textarea
              ref={textareaRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder="发消息，或输入 / 指令…"
              className={`max-h-36 min-h-[40px] flex-1 resize-none bg-transparent px-1.5 py-2 text-[14px] leading-6 text-zinc-900 placeholder:text-zinc-400 focus:outline-none dark:text-zinc-100 dark:placeholder:text-zinc-500 ${
                !input ? 'h-[40px] overflow-hidden whitespace-nowrap' : ''
              }`}
            />

            <button
              type="button"
              onClick={() => void handleToggleVoice()}
              aria-label={listening ? '停止语音输入' : '语音输入'}
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-all active:scale-95 ${
                listening
                  ? 'bg-rose-600 text-white shadow-sm'
                  : 'text-zinc-500 hover:bg-stone-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'
              }`}
            >
              {listening ? (
                <MicOff className="h-[18px] w-[18px]" />
              ) : (
                <Mic className="h-[18px] w-[18px]" />
              )}
            </button>

            {isStreaming ? (
              <button
                type="button"
                onClick={onStopStreaming}
                aria-label="停止生成"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-950 text-white transition-transform active:scale-95 hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={processingFiles || (!input.trim() && attachments.length === 0)}
                aria-label="发送消息"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-950 text-white transition-all active:scale-95 hover:bg-[#1B6EF3] disabled:bg-stone-200 disabled:text-zinc-400 dark:bg-[#1B6EF3] dark:hover:bg-blue-600 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-600"
              >
                <ArrowUp className="h-[18px] w-[18px]" />
              </button>
            )}
          </form>
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
                      <RefreshCw
                        className={`h-3.5 w-3.5 ${isLoadingSessions ? 'animate-spin' : ''}`}
                      />
                      <span>同步云端</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setSessionSheetOpen(false)}
                    aria-label="关闭会话列表"
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
                      placeholder="搜索会话标题或 ID…"
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
                    <Plus className="h-3.5 w-3.5" />
                    <span>新会话</span>
                  </button>
                </div>

                <div className="divide-y divide-stone-100 rounded-2xl border border-stone-200/80 dark:divide-zinc-800/80 dark:border-zinc-800">
                  {filteredSheetSessions.length === 0 ? (
                    <div className="px-4 py-8 text-center text-xs text-zinc-400">
                      没有匹配的会话
                    </div>
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
                              aria-label="从列表移除会话"
                              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-400 hover:bg-stone-200/70 hover:text-rose-600 dark:hover:bg-zinc-800 dark:hover:text-rose-400"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
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
            <button
              type="button"
              onClick={() => setLightboxImage(null)}
              aria-label="关闭大图"
              className="absolute top-4 right-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25"
            >
              <X className="h-5 w-5" />
            </button>
            <motion.img
              initial={{ scale: 0.94, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.94, opacity: 0 }}
              src={lightboxImage.src}
              alt={lightboxImage.name}
              className="max-h-[88vh] max-w-[94vw] rounded-2xl object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
