import React, { useEffect, useState } from 'react';
import {
  Bell,
  Check,
  CheckCircle2,
  Cloud,
  Copy,
  Link2,
  Loader2,
  Radio,
  Send,
  X,
  XCircle,
} from 'lucide-react';
import type { ConnectionConfig, ConnectionMode } from '../types/relay';
import { sendNtfyNotification, testServerConnection } from '../services/agentClient';
import { buildDshWsUrl, testDshWebSocket } from '../services/dshMuxClient';
import { RELAY_CARDS_PROTOCOL_PROMPT } from '../services/cardProtocol';
import { PWAInstallButton } from './PWAComponents';

interface ConnectionSheetProps {
  open: boolean;
  config: ConnectionConfig;
  onClose: () => void;
  onSave: (next: ConnectionConfig) => void;
  onSendProtocolToAgent?: (promptText: string) => void;
}

export const ConnectionSheet: React.FC<ConnectionSheetProps> = ({
  open,
  config,
  onClose,
  onSave,
  onSendProtocolToAgent,
}) => {
  const [draft, setDraft] = useState<ConnectionConfig>(config);
  const [testing, setTesting] = useState(false);
  const [probing, setProbing] = useState(false);
  const [probeMethod, setProbeMethod] = useState('workspace/follow');
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    message: string;
    rawFrame?: string;
  } | null>(null);
  const [ntfyStatus, setNtfyStatus] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open) {
      setDraft(config);
      setTestResult(null);
    }
  }, [open, config]);

  if (!open) return null;

  const modes: { key: ConnectionMode; title: string; desc: string }[] = [
    {
      key: 'dsh-bridge',
      title: 'DeepSeek Harness (WS)',
      desc: '手机经 Cloudflare Tunnel 自定义域名直连 /api/remote.mux',
    },
    {
      key: 'openai-compatible',
      title: 'OpenAI 兼容接口',
      desc: '标准 /v1/chat/completions 流式 SSE 接口',
    },
    {
      key: 'sandbox',
      title: '本地交互体验',
      desc: '免连接离线体验全部 5 种交互卡片',
    },
  ];

  const resolvedWsUrl = buildDshWsUrl(draft.serverUrl, draft.wsEndpoint);

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    const res = await testServerConnection(draft);
    setTestResult({ ok: res.ok, message: res.message, rawFrame: res.rawFrame });
    setTesting(false);
  };

  const handleProbeRpc = async () => {
    setProbing(true);
    setTestResult(null);
    const res = await testDshWebSocket(draft, probeMethod.trim() || 'workspace/follow');
    setTestResult({ ok: res.ok, message: res.message, rawFrame: res.rawFrame });
    setProbing(false);
  };

  const handleTestNtfy = async () => {
    setNtfyStatus('正在发送测试推送...');
    const res = await sendNtfyNotification(
      draft,
      'Relay 连接测试',
      '来自 Relay 私人助理控制台的 ntfy 推送测试通知。'
    );
    setNtfyStatus(res.detail);
  };

  const handleCopyProtocol = async () => {
    try {
      await navigator.clipboard.writeText(RELAY_CARDS_PROTOCOL_PROMPT);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  const handleSave = () => {
    onSave(draft);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/65 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="board-backdrop flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-t-[28px] border border-[var(--relay-tile-border)] text-[var(--relay-text)] shadow-2xl sm:rounded-[26px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mt-3 h-1 w-10 shrink-0 rounded-full bg-white/25 sm:hidden" />

        <div className="flex items-center justify-between border-b border-[var(--relay-tile-border)]/50 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <Cloud className="h-5 w-5 text-[var(--accent-sky)]" />
            <h2 className="text-base font-semibold text-[var(--relay-text)]">
              Cloudflare Tunnel 与 Agent 通道
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭设置"
            className="flex h-9 w-9 items-center justify-center rounded-xl text-[var(--relay-text-muted)] hover:bg-white/10 hover:text-[var(--relay-text)]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
          {/* Hybrid Topology Info Strip */}
          <div className="rounded-2xl border border-white/10 bg-black/25 px-3.5 py-2.5 text-[11px] leading-relaxed text-[var(--relay-text-muted)]">
            <span className="font-medium text-[var(--accent-sky)]">当前混合拓扑：</span>
            手机直连 <span className="font-medium text-[var(--relay-text)]">Cloudflare Tunnel</span>{' '}
            自定义域名（手机无需开启 Tailscale）；云服务器与个人电脑之间仍通过{' '}
            <span className="font-medium text-[var(--relay-text)]">Tailscale 内网</span> 协同文件与命令。
          </div>

          {/* Connection Mode Selector */}
          <div>
            <label className="text-xs font-semibold text-[var(--relay-text-muted)]">
              连接方式
            </label>
            <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-3">
              {modes.map((m) => {
                const active = draft.mode === m.key;
                return (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => setDraft({ ...draft, mode: m.key })}
                    className={`rounded-2xl border p-3 text-left transition-colors ${
                      active
                        ? 'border-sky-400/60 bg-sky-500/12'
                        : 'border-white/10 bg-black/25 hover:border-white/20'
                    }`}
                  >
                    <div className="text-xs font-semibold text-[var(--relay-text)]">
                      {m.title}
                    </div>
                    <p className="mt-1 text-[11px] leading-relaxed text-[var(--relay-text-muted)]">
                      {m.desc}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {draft.mode !== 'sandbox' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-[var(--relay-text-muted)]">
                  云端入口地址（Cloudflare Tunnel 自定义 HTTPS 域名）
                </label>
                <input
                  type="url"
                  value={draft.serverUrl}
                  onChange={(e) => setDraft({ ...draft, serverUrl: e.target.value })}
                  placeholder="https://agent.yourdomain.com"
                  className="mt-1.5 min-h-[44px] w-full rounded-xl border border-white/15 bg-black/35 px-3.5 py-2 font-mono-tabular text-xs text-[var(--relay-text)] placeholder:text-[var(--relay-text-faint)] focus:border-sky-400/70 focus:outline-none"
                />
              </div>

              {draft.mode === 'dsh-bridge' ? (
                <>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs font-medium text-[var(--relay-text-muted)]">
                        WebSocket 路径
                      </label>
                      <input
                        type="text"
                        value={draft.wsEndpoint}
                        onChange={(e) => setDraft({ ...draft, wsEndpoint: e.target.value })}
                        placeholder="/api/remote.mux"
                        className="mt-1.5 min-h-[44px] w-full rounded-xl border border-white/15 bg-black/35 px-3.5 py-2 font-mono-tabular text-xs text-[var(--relay-text)] focus:border-sky-400/70 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-[var(--relay-text-muted)]">
                        Workspace ID
                      </label>
                      <input
                        type="text"
                        value={draft.workspace}
                        onChange={(e) => setDraft({ ...draft, workspace: e.target.value })}
                        placeholder="9000111a-7d73-453e-b69d-16d9b271a9f3"
                        className="mt-1.5 min-h-[44px] w-full rounded-xl border border-white/15 bg-black/35 px-3.5 py-2 font-mono-tabular text-xs text-[var(--relay-text)] focus:border-sky-400/70 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs font-medium text-[var(--relay-text-muted)]">
                        Stream / RPC endpoint
                      </label>
                      <input
                        type="text"
                        value={draft.rpcMethod || 'session/prompt'}
                        onChange={(e) => setDraft({ ...draft, rpcMethod: e.target.value })}
                        placeholder="session/prompt"
                        className="mt-1.5 min-h-[44px] w-full rounded-xl border border-white/15 bg-black/35 px-3.5 py-2 font-mono-tabular text-xs text-[var(--relay-text)] focus:border-sky-400/70 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-[var(--relay-text-muted)]">
                        Session ID（可选）
                      </label>
                      <input
                        type="text"
                        value={draft.sessionId || ''}
                        onChange={(e) => setDraft({ ...draft, sessionId: e.target.value })}
                        placeholder="留空由服务端分配"
                        className="mt-1.5 min-h-[44px] w-full rounded-xl border border-white/15 bg-black/35 px-3.5 py-2 font-mono-tabular text-xs text-[var(--relay-text)] focus:border-sky-400/70 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="rounded-xl border border-white/10 bg-black/30 px-3.5 py-2.5 text-[11px] leading-relaxed text-[var(--relay-text-muted)]">
                    <div>
                      实际 WebSocket 地址：
                      <span className="font-mono-tabular text-[var(--relay-text)] break-all">
                        {resolvedWsUrl || '—'}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                      <span>请确保 Cloudflare 域名已开启 WebSockets 转发。</span>
                      {draft.serverUrl.trim() && (
                        <a
                          href={draft.serverUrl.trim()}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-[var(--accent-sky)] underline-offset-2 hover:underline whitespace-nowrap"
                        >
                          在浏览器打开 HTTPS 测通 ↗
                        </a>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-xs font-medium text-[var(--relay-text-muted)]">
                      模型 / Agent 标识
                    </label>
                    <input
                      type="text"
                      value={draft.model}
                      onChange={(e) => setDraft({ ...draft, model: e.target.value })}
                      placeholder="deepseek-reasoner"
                      className="mt-1.5 min-h-[44px] w-full rounded-xl border border-white/15 bg-black/35 px-3.5 py-2 font-mono-tabular text-xs text-[var(--relay-text)] focus:border-sky-400/70 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--relay-text-muted)]">
                      访问令牌（留空则不发送 Authorization）
                    </label>
                    <input
                      type="password"
                      value={draft.token}
                      onChange={(e) => setDraft({ ...draft, token: e.target.value })}
                      placeholder="留空"
                      className="mt-1.5 min-h-[44px] w-full rounded-xl border border-white/15 bg-black/35 px-3.5 py-2 font-mono-tabular text-xs text-[var(--relay-text)] focus:border-sky-400/70 focus:outline-none"
                    />
                  </div>
                </>
              )}

              {/* Connection Test & Raw RPC Probe */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleTest}
                  disabled={testing || probing}
                  className="inline-flex min-h-[40px] items-center gap-2 rounded-xl bg-white/90 px-3.5 py-2 text-xs font-medium text-slate-950 hover:bg-white disabled:opacity-60 whitespace-nowrap"
                >
                  {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Radio className="h-3.5 w-3.5" />}
                  <span>{draft.mode === 'dsh-bridge' ? '测试 WebSocket 连通' : '测试接口连通'}</span>
                </button>

                {draft.mode === 'dsh-bridge' && (
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={probeMethod}
                      onChange={(e) => setProbeMethod(e.target.value)}
                      aria-label="探测 method"
                      className="h-10 w-32 rounded-xl border border-white/15 bg-black/35 px-2.5 font-mono-tabular text-xs text-[var(--relay-text)]"
                    />
                    <button
                      type="button"
                      onClick={handleProbeRpc}
                      disabled={testing || probing}
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-white/15 bg-white/6 px-3 py-2 text-xs font-medium text-[var(--relay-text)] hover:bg-white/12 disabled:opacity-60 whitespace-nowrap"
                    >
                      {probing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
                      <span>发送探测报文</span>
                    </button>
                  </div>
                )}
              </div>

              {testResult && (
                <div
                  className={`space-y-2 rounded-xl border p-3 text-xs leading-relaxed ${
                    testResult.ok
                      ? 'border-emerald-500/35 bg-emerald-500/12 text-emerald-200'
                      : 'border-amber-500/35 bg-amber-500/12 text-amber-200'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {testResult.ok ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                    ) : (
                      <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
                    )}
                    <span className="break-all">{testResult.message}</span>
                  </div>
                  {testResult.rawFrame && (
                    <pre className="max-h-32 overflow-auto rounded-lg bg-black/60 p-2.5 font-mono-tabular text-[11px] text-zinc-200 whitespace-pre-wrap break-all">
                      {testResult.rawFrame}
                    </pre>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ntfy over Cloudflare Tunnel / HTTPS Push Config */}
          <div className="border-t border-white/10 pt-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold text-[var(--relay-text)]">
                Android 锁屏推送（ntfy · 公网 / Cloudflare Tunnel 域名）
              </div>
              <button
                type="button"
                onClick={handleTestNtfy}
                className="inline-flex items-center gap-1 text-xs font-medium text-[var(--accent-sky)] hover:underline"
              >
                <Bell className="h-3.5 w-3.5" />
                <span>发送测试推送</span>
              </button>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <input
                type="url"
                value={draft.ntfyUrl}
                onChange={(e) => setDraft({ ...draft, ntfyUrl: e.target.value })}
                placeholder="https://ntfy.yourdomain.com"
                className="min-h-[42px] w-full rounded-xl border border-white/15 bg-black/35 px-3 py-2 font-mono-tabular text-xs text-[var(--relay-text)] placeholder:text-[var(--relay-text-faint)] focus:border-sky-400/70 focus:outline-none"
              />
              <input
                type="text"
                value={draft.ntfyTopic}
                onChange={(e) => setDraft({ ...draft, ntfyTopic: e.target.value })}
                placeholder="relay-reminders"
                className="min-h-[42px] w-full rounded-xl border border-white/15 bg-black/35 px-3 py-2 font-mono-tabular text-xs text-[var(--relay-text)] placeholder:text-[var(--relay-text-faint)] focus:border-sky-400/70 focus:outline-none"
              />
            </div>
            {ntfyStatus && (
              <p className="text-xs text-[var(--relay-text-muted)]">{ntfyStatus}</p>
            )}
          </div>

          {/* 5 Interactive Cards Protocol Reference */}
          <div className="border-t border-white/10 pt-5 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-[var(--relay-text)]">
                5 种交互卡片协议（含高德地图 GCJ-02）
              </span>
              <div className="flex items-center gap-1.5">
                {onSendProtocolToAgent && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onSendProtocolToAgent(RELAY_CARDS_PROTOCOL_PROMPT);
                    }}
                    className="inline-flex items-center gap-1 rounded-lg bg-blue-500/85 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-500"
                  >
                    <Send className="h-3 w-3" />
                    <span>发给助理记住</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleCopyProtocol}
                  className="inline-flex items-center gap-1 rounded-lg border border-white/15 bg-white/6 px-2.5 py-1 text-xs font-medium text-[var(--relay-text)] hover:bg-white/12"
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-[var(--accent-mint)]" /> : <Copy className="h-3.5 w-3.5" />}
                  <span>{copied ? '已复制' : '复制协议'}</span>
                </button>
              </div>
            </div>
            <pre className="max-h-44 overflow-auto rounded-xl border border-white/10 bg-black/50 p-3.5 font-mono-tabular text-[11px] leading-relaxed text-zinc-300 whitespace-pre-wrap">
              {RELAY_CARDS_PROTOCOL_PROMPT}
            </pre>
          </div>

          {/* Mobile PWA Install block inside settings */}
          <div className="border-t border-white/10 pt-5">
            <PWAInstallButton />
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-white/10 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] rounded-xl border border-white/15 bg-white/6 px-4 py-2 text-sm font-medium text-[var(--relay-text)] hover:bg-white/12"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="min-h-[44px] flex-1 rounded-xl bg-blue-500/90 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
          >
            保存并应用连接
          </button>
        </div>
      </div>
    </div>
  );
};
