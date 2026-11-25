import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  FileText,
  Image as ImageIcon,
  Loader2,
  MessageSquare,
  Mic,
  MicOff,
  Paperclip,
  Plus,
  RefreshCw,
  Send,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import type {
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

interface ChatViewProps {
  messages: ChatMessage[];
  sessions: SessionRecord[];
  activeSession: SessionRecord;
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
  onOpenConnection: () => void;
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

const TEXT_FILE_REGEX = /\.(txt|md|markdown|json|csv|tsv|log|yaml|yml|toml|xml|html|css|js|ts|tsx|jsx|py|sh|bash|go|rs|java|c|cpp|h|sql|ini|conf|env)$/i;

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  0: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike {
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
}

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

async function compressImageIfNeeded(file: File, rawDataUrl: string): Promise<{ dataUrl: string; mimeType: string }> {
  const mime = file.type || 'image/jpeg';
  // Keep small non-huge images untouched
  if (file.size <= 1_200_000 && mime !== 'image/bmp') {
    return { dataUrl: rawDataUrl, mimeType: mime };
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const maxDim = 1920;
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
        resolve({ dataUrl: rawDataUrl, mimeType: mime });
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      const outMime = mime === 'image/png' && file.size < 2_500_000 ? 'image/png' : 'image/jpeg';
      const compressed = canvas.toDataURL(outMime, 0.85);
      resolve({ dataUrl: compressed, mimeType: outMime });
    };
    img.onerror = () => resolve({ dataUrl: rawDataUrl, mimeType: mime });
    img.src = rawDataUrl;
  });
}

async function buildChatAttachment(file: File): Promise<ChatAttachment> {
  const mimeType = file.type || 'application/octet-stream';
  const size = formatFileSize(file.size);

  if (mimeType.startsWith('image/')) {
    const rawDataUrl = await readFileAsDataUrl(file);
    const processed = await compressImageIfNeeded(file, rawDataUrl);
    const commaIdx = processed.dataUrl.indexOf(',');
    const base64Data = commaIdx >= 0 ? processed.dataUrl.slice(commaIdx + 1) : processed.dataUrl;
    return {
      name: file.name || `image-${Date.now()}.png`,
      size,
      mimeType: processed.mimeType,
      dataUrl: processed.dataUrl,
      base64Data,
    };
  }

  if (mimeType.startsWith('text/') || TEXT_FILE_REGEX.test(file.name)) {
    const textContent = await readFileAsText(file);
    return {
      name: file.name,
      size,
      mimeType: mimeType || 'text/plain',
      textContent: textContent.slice(0, 120_000),
    };
  }

  // Binary non-image file (e.g. PDF)
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
  onOpenConnection,
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
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [processingFiles, setProcessingFiles] = useState(false);
  const [listening, setListening] = useState(false);
  const [sessionSheetOpen, setSessionSheetOpen] = useState(false);
  const [manualSessionInput, setManualSessionInput] = useState('');
  const [lightboxImage, setLightboxImage] = useState<{ src: string; name: string } | null>(null);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  const showSlashMenu = input.startsWith('/') && !input.includes(' ');
  const matchingCommands = showSlashMenu
    ? SLASH_COMMANDS.filter((c) => c.cmd.startsWith(input.toLowerCase()))
    : [];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isStreaming]);

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

    if (trimmed === '/new') {
      onNewSession();
      setInput('');
      return;
    }

    onSendMessage(
      trimmed || (attachments.some((a) => a.mimeType.startsWith('image/')) ? '请查看这张图片' : '请查看这些附件'),
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

  const handleToggleVoice = () => {
    if (listening && recognitionRef.current) {
      recognitionRef.current.stop();
      setListening(false);
      return;
    }

    const win = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const SpeechRec = win.SpeechRecognition || win.webkitSpeechRecognition;

    if (!SpeechRec) {
      onShowToast('当前浏览器暂不支持语音转文字，可直接使用 Android 键盘语音输入');
      return;
    }

    const rec = new SpeechRec();
    rec.lang = 'zh-CN';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript;
      if (transcript) {
        setInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
      }
    };
    rec.onerror = () => {
      setListening(false);
      onShowToast('语音识别未获取输入，请检查麦克风权限');
    };
    rec.onend = () => {
      setListening(false);
    };
    recognitionRef.current = rec;
    setListening(true);
    rec.start();
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

  const activeShortId = activeSession.remoteSessionId
    ? activeSession.remoteSessionId.slice(0, 8)
    : undefined;

  return (
    <div className="flex h-full flex-col">
      {/* Compact Session & Channel Context Toolbar */}
      <div className="flex items-center justify-between gap-2 border-b border-slate-200/80 bg-[#F6F7F9]/90 px-4 py-2 backdrop-blur-sm dark:border-slate-800/80 dark:bg-[#0B0E14]/90 sm:px-6">
        <button
          type="button"
          onClick={handleOpenSessionPicker}
          className="flex min-h-[38px] min-w-0 items-center gap-1.5 rounded-xl px-2 py-1 text-left text-xs text-slate-700 transition-colors hover:bg-slate-200/60 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <MessageSquare className="h-3.5 w-3.5 shrink-0 text-blue-600 dark:text-blue-400" />
          <span className="max-w-[160px] truncate font-medium sm:max-w-[260px]">
            {activeSession.title}
          </span>
          {activeShortId && (
            <>
              <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
              <span className="font-mono-tabular text-[11px] text-slate-400">
                {activeShortId}
              </span>
            </>
          )}
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        </button>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onOpenConnection}
            className="hidden sm:inline-flex min-h-[36px] items-center rounded-lg px-2.5 py-1.5 text-xs text-slate-500 transition-colors hover:bg-slate-200/60 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100 whitespace-nowrap"
          >
            {config.mode === 'sandbox' ? '本地体验' : '通道配置'}
          </button>
          <button
            type="button"
            onClick={onNewSession}
            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-200/60 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100 whitespace-nowrap shrink-0"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>新会话</span>
          </button>
        </div>
      </div>

      {/* Scrollable Message Stream */}
      <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        <div className="mx-auto max-w-3xl space-y-6 pb-4">
          {isLoadingHistory && messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin text-blue-600 dark:text-blue-400" />
              <p className="mt-2.5 text-xs">正在同步云端会话记录...</p>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                {activeSession.remoteSessionId ? activeSession.title : '开始新对话'}
              </p>
              <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">
                {config.mode === 'dsh-bridge'
                  ? '直接输入指令、发送图片或文件，或点击上方切换已有云端会话'
                  : config.mode === 'openai-compatible'
                    ? `当前模型 · ${config.model || 'custom'}`
                    : '本地体验模式 · 可测试交互卡片或切换为真实通道'}
              </p>
            </div>
          ) : (
            messages.map((msg) => {
              const isUser = msg.role === 'user';
              return (
                <div key={msg.id} className={isUser ? 'flex flex-col items-end' : 'space-y-3'}>
                  {isUser ? (
                    <div className="max-w-[88%] sm:max-w-[78%] space-y-2">
                      {msg.attachments && msg.attachments.length > 0 && (
                        <div className="flex flex-wrap justify-end gap-2">
                          {msg.attachments.map((att, idx) =>
                            att.mimeType.startsWith('image/') && att.dataUrl ? (
                              <button
                                key={idx}
                                type="button"
                                onClick={() => setLightboxImage({ src: att.dataUrl!, name: att.name })}
                                className="overflow-hidden rounded-xl border border-slate-200/80 bg-white dark:border-slate-700"
                              >
                                <img
                                  src={att.dataUrl}
                                  alt={att.name}
                                  className="max-h-48 max-w-[220px] object-cover"
                                />
                              </button>
                            ) : (
                              <div
                                key={idx}
                                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                              >
                                <FileText className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                                <span className="max-w-[160px] truncate">{att.name}</span>
                                <span className="font-mono-tabular text-[11px] text-slate-400">
                                  {att.size}
                                </span>
                              </div>
                            )
                          )}
                        </div>
                      )}
                      {msg.content && (
                        <div className="rounded-2xl bg-slate-900 px-4 py-3 text-sm leading-relaxed text-white dark:bg-blue-600 whitespace-pre-wrap">
                          {msg.content}
                        </div>
                      )}
                      <div className="text-right font-mono-tabular text-[11px] text-slate-400 dark:text-slate-500">
                        {msg.timestamp}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3.5">
                      <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                        <span className="font-semibold text-slate-900 dark:text-slate-100">
                          Agent
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono-tabular">{msg.timestamp}</span>
                        {msg.streaming && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-blue-600 dark:text-blue-400">正在响应</span>
                          </>
                        )}
                      </div>

                      {msg.content && (
                        <div className="text-[15px] leading-7 text-slate-800 dark:text-slate-200 whitespace-pre-wrap">
                          {msg.content}
                        </div>
                      )}

                      {msg.cards && msg.cards.length > 0 && (
                        <div className="space-y-3 pt-0.5">
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
                  )}
                </div>
              );
            })
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Composer Area */}
      <div className="border-t border-slate-200/80 bg-[#F6F7F9]/95 px-3 pt-2.5 pb-3 backdrop-blur-md dark:border-slate-800/80 dark:bg-[#0B0E14]/95 sm:px-6 sm:pb-4">
        <div className="mx-auto max-w-3xl relative">
          {/* Slash Command Picker */}
          {matchingCommands.length > 0 && (
            <div className="absolute bottom-full left-0 right-0 mb-2 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg dark:border-slate-800 dark:bg-[#131822]">
              <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {matchingCommands.map((item) => (
                  <button
                    key={item.cmd}
                    type="button"
                    onClick={() => setInput(`${item.cmd} `)}
                    className="flex min-h-[44px] w-full items-center justify-between gap-3 px-4 py-2 text-left text-xs hover:bg-slate-50 dark:hover:bg-slate-800/60"
                  >
                    <span className="font-mono-tabular font-semibold text-blue-600 dark:text-blue-400">
                      {item.cmd}
                    </span>
                    <span className="truncate text-slate-500 dark:text-slate-400">{item.hint}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Quick Starters — ONLY shown in sandbox demo mode */}
          {config.mode === 'sandbox' && (
            <div className="mb-2 flex items-center gap-1.5 overflow-x-auto pb-0.5">
              {SANDBOX_QUICK_STARTERS.map((text) => (
                <button
                  key={text}
                  type="button"
                  onClick={() => onSendMessage(text)}
                  className="min-h-[34px] rounded-xl border border-slate-200/90 bg-white px-3 py-1 text-xs font-medium text-slate-700 transition-colors hover:border-blue-300 hover:text-blue-600 dark:border-slate-800 dark:bg-[#131822] dark:text-slate-300 dark:hover:border-blue-700 dark:hover:text-blue-400 whitespace-nowrap shrink-0"
                >
                  {text}
                </button>
              ))}
            </div>
          )}

          {/* Pending Attachments (with real image thumbnails) */}
          {(attachments.length > 0 || processingFiles) && (
            <div className="mb-2 flex flex-wrap items-center gap-2">
              {attachments.map((att, idx) => (
                <div
                  key={`${att.name}-${idx}`}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-1.5 pr-2.5 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                >
                  {att.mimeType.startsWith('image/') && att.dataUrl ? (
                    <img
                      src={att.dataUrl}
                      alt={att.name}
                      className="h-9 w-9 rounded-lg object-cover shrink-0"
                    />
                  ) : (
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300 shrink-0">
                      {att.mimeType.startsWith('image/') ? (
                        <ImageIcon className="h-4 w-4" />
                      ) : (
                        <FileText className="h-4 w-4" />
                      )}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="max-w-[140px] truncate font-medium">{att.name}</div>
                    <div className="font-mono-tabular text-[11px] text-slate-400">{att.size}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== idx))}
                    aria-label="移除附件"
                    className="ml-0.5 flex h-6 w-6 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              {processingFiles && (
                <div className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>正在处理附件...</span>
                </div>
              )}
            </div>
          )}

          {/* Main Input Bar */}
          <form
            onSubmit={handleSubmit}
            className="flex items-end gap-1.5 rounded-2xl border border-slate-200 bg-white p-1.5 focus-within:border-blue-500 dark:border-slate-800 dark:bg-[#131822] dark:focus-within:border-blue-500"
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
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            >
              <Paperclip className="h-5 w-5" />
            </button>

            <textarea
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder="发消息、粘贴图片，或输入 / 调用指令..."
              className="max-h-32 min-h-[44px] flex-1 resize-none bg-transparent px-1.5 py-2.5 text-sm leading-relaxed text-slate-900 placeholder:text-slate-400 focus:outline-none dark:text-slate-100"
            />

            <button
              type="button"
              onClick={handleToggleVoice}
              aria-label={listening ? '停止语音输入' : '语音输入'}
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-colors ${
                listening
                  ? 'bg-rose-600 text-white'
                  : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'
              }`}
            >
              {listening ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
            </button>

            {isStreaming ? (
              <button
                type="button"
                onClick={onStopStreaming}
                aria-label="停止生成"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white transition-colors hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900"
              >
                <Square className="h-4 w-4 fill-current" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={processingFiles || (!input.trim() && attachments.length === 0)}
                aria-label="发送消息"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white transition-colors hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 dark:disabled:bg-slate-800 dark:disabled:text-slate-600"
              >
                <Send className="h-4 w-4" />
              </button>
            )}
          </form>
        </div>
      </div>

      {/* Session Picker Sheet */}
      {sessionSheetOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/55 backdrop-blur-xs sm:items-center sm:p-4"
          onClick={() => setSessionSheetOpen(false)}
        >
          <div
            className="flex max-h-[84vh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl border border-slate-200/80 bg-white dark:border-slate-800 dark:bg-[#131822] sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mt-3 h-1.5 w-10 shrink-0 rounded-full bg-slate-300 dark:bg-slate-700 sm:hidden" />

            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5 dark:border-slate-800/80">
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                切换会话
              </div>
              <div className="flex items-center gap-1">
                {config.mode === 'dsh-bridge' && (
                  <button
                    type="button"
                    onClick={onRefreshSessions}
                    disabled={isLoadingSessions}
                    className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-60 dark:text-blue-400 dark:hover:bg-blue-950/40"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${isLoadingSessions ? 'animate-spin' : ''}`} />
                    <span>同步云端</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSessionSheetOpen(false)}
                  aria-label="关闭会话列表"
                  className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
              <button
                type="button"
                onClick={() => {
                  onNewSession();
                  setSessionSheetOpen(false);
                }}
                className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 px-3 py-2.5 text-xs font-medium text-slate-700 transition-colors hover:border-blue-500 hover:text-blue-600 dark:border-slate-700 dark:text-slate-200 dark:hover:border-blue-500 dark:hover:text-blue-400"
              >
                <Plus className="h-4 w-4" />
                <span>新建空白会话</span>
              </button>

              <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200/80 dark:divide-slate-800/80 dark:border-slate-800">
                {sessions.map((s) => {
                  const isActive = s.id === activeSession.id;
                  return (
                    <div
                      key={s.id}
                      className={`flex items-center justify-between gap-2 px-3.5 py-3 transition-colors ${
                        isActive ? 'bg-blue-50/60 dark:bg-blue-950/30' : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
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
                          <span className="truncate text-xs font-medium text-slate-900 dark:text-slate-100">
                            {s.title}
                          </span>
                          {isActive && (
                            <Check className="h-3.5 w-3.5 shrink-0 text-blue-600 dark:text-blue-400" />
                          )}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5 font-mono-tabular text-[11px] text-slate-400">
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
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-200/70 hover:text-rose-600 dark:hover:bg-slate-800 dark:hover:text-rose-400"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Manual Remote Session ID binding */}
              {config.mode === 'dsh-bridge' && (
                <form onSubmit={handleManualBindSubmit} className="pt-2">
                  <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    或直接输入已有 Session ID 接入
                  </label>
                  <div className="mt-1.5 flex items-center gap-2">
                    <input
                      type="text"
                      value={manualSessionInput}
                      onChange={(e) => setManualSessionInput(e.target.value)}
                      placeholder="粘贴服务端 sessionId..."
                      className="min-h-[40px] flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 font-mono-tabular text-xs text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-[#0B0E14] dark:text-slate-100"
                    />
                    <button
                      type="submit"
                      disabled={!manualSessionInput.trim()}
                      className="min-h-[40px] rounded-xl bg-slate-900 px-3.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-40 dark:bg-blue-600 dark:hover:bg-blue-700 whitespace-nowrap"
                    >
                      接入
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Fullscreen Image Lightbox */}
      {lightboxImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-xs"
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
          <img
            src={lightboxImage.src}
            alt={lightboxImage.name}
            className="max-h-[88vh] max-w-[94vw] rounded-xl object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
};
