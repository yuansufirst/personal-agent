import React, { useEffect, useRef, useState } from 'react';
import {
  Mic,
  MicOff,
  Paperclip,
  Plus,
  Send,
  Square,
  X,
} from 'lucide-react';
import type {
  BriefingItem,
  ChatAttachment,
  ChatMessage,
  ConnectionConfig,
  MeshFileItem,
  ReminderItem,
} from '../types/relay';
import { SLASH_COMMANDS } from '../data/initialData';
import { InteractiveCardRenderer } from './InteractiveCards';

interface ChatViewProps {
  messages: ChatMessage[];
  config: ConnectionConfig;
  isStreaming: boolean;
  onSendMessage: (text: string, attachments?: ChatAttachment[]) => void;
  onStopStreaming: () => void;
  onNewSession: () => void;
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

const QUICK_STARTERS = [
  '推送今天的 AI 论文简报',
  '提醒我今晚 9 点复盘周报',
  '读取电脑最新周报文件',
  '开启手机专注静音',
];

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

export const ChatView: React.FC<ChatViewProps> = ({
  messages,
  config,
  isStreaming,
  onSendMessage,
  onStopStreaming,
  onNewSession,
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
  const [listening, setListening] = useState(false);
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

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed && attachments.length === 0) return;

    if (trimmed === '/new') {
      onNewSession();
      setInput('');
      return;
    }

    onSendMessage(trimmed || '请帮我查看这些附件', attachments.length > 0 ? attachments : undefined);
    setInput('');
    setAttachments([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleAttachFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const sizeKb = file.size < 1024 * 1024
      ? `${Math.max(1, Math.round(file.size / 1024))} KB`
      : `${(file.size / (1024 * 1024)).toFixed(1)} MB`;
    setAttachments((prev) => [
      ...prev,
      { name: file.name, size: sizeKb, mimeType: file.type || 'application/octet-stream' },
    ]);
    e.target.value = '';
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

  const connectionLabel =
    config.mode === 'sandbox'
      ? '本地体验模式'
      : config.mode === 'dsh-bridge'
        ? `DeepSeek Harness · ${config.workspace || 'default'}`
        : `OpenAI 兼容 · ${config.model || 'custom'}`;

  return (
    <div className="flex h-full flex-col">
      {/* Subtle Context Toolbar inside workspace (not inside top header) */}
      <div className="flex items-center justify-between gap-3 border-b border-slate-200/80 bg-[#F6F7F9]/90 px-4 py-2.5 backdrop-blur-sm dark:border-slate-800/80 dark:bg-[#0B0E14]/90 sm:px-6">
        <button
          type="button"
          onClick={onOpenConnection}
          className="flex min-h-[36px] min-w-0 items-center gap-2 text-xs text-slate-600 transition-colors hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
        >
          <span className="truncate font-medium">{connectionLabel}</span>
          <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
          <span className="text-blue-600 dark:text-blue-400 whitespace-nowrap shrink-0">
            切换通道
          </span>
        </button>

        <button
          type="button"
          onClick={onNewSession}
          className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-200/60 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100 whitespace-nowrap shrink-0"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>新会话</span>
        </button>
      </div>

      {/* Scrollable Message Stream */}
      <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        <div className="mx-auto max-w-3xl space-y-6 pb-4">
          {messages.map((msg) => {
            const isUser = msg.role === 'user';
            return (
              <div key={msg.id} className={isUser ? 'flex flex-col items-end' : 'space-y-3'}>
                {isUser ? (
                  <div className="max-w-[88%] sm:max-w-[78%]">
                    <div className="rounded-2xl bg-slate-900 px-4 py-3 text-sm leading-relaxed text-white dark:bg-blue-600 whitespace-pre-wrap">
                      {msg.content}
                    </div>
                    {msg.attachments && msg.attachments.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap justify-end gap-2 text-xs text-slate-500 dark:text-slate-400">
                        {msg.attachments.map((att, idx) => (
                          <span key={idx} className="font-mono-tabular">
                            附件：{att.name} ({att.size})
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="mt-1 text-right font-mono-tabular text-[11px] text-slate-400 dark:text-slate-500">
                      {msg.timestamp}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3.5">
                    <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <span className="font-semibold text-slate-900 dark:text-slate-100">
                        Relay Agent
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
          })}
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

          {/* Quick Starters */}
          <div className="mb-2 flex items-center gap-1.5 overflow-x-auto pb-0.5">
            {QUICK_STARTERS.map((text) => (
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

          {/* Pending Attachments */}
          {attachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {attachments.map((att, idx) => (
                <div
                  key={`${att.name}-${idx}`}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                >
                  <span className="max-w-[160px] truncate">{att.name}</span>
                  <span className="font-mono-tabular text-slate-400">{att.size}</span>
                  <button
                    type="button"
                    onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== idx))}
                    aria-label="移除附件"
                    className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
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
              className="hidden"
              onChange={handleAttachFile}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              aria-label="附加文件"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            >
              <Paperclip className="h-5 w-5" />
            </button>

            <textarea
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="发消息给你的 Agent，或输入 / 调用指令..."
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
                disabled={!input.trim() && attachments.length === 0}
                aria-label="发送消息"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white transition-colors hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 dark:disabled:bg-slate-800 dark:disabled:text-slate-600"
              >
                <Send className="h-4 w-4" />
              </button>
            )}
          </form>
        </div>
      </div>
    </div>
  );
};
