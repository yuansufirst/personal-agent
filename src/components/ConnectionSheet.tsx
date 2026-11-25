import React, { useEffect, useState } from 'react';
import {
  Bell,
  Check,
  CheckCircle2,
  Copy,
  Link2,
  Loader2,
  Radio,
  X,
  XCircle,
} from 'lucide-react';
import type { ConnectionConfig, ConnectionMode } from '../types/relay';
import { sendNtfyNotification, testServerConnection } from '../services/agentClient';
import { buildDshWsUrl, testDshWebSocket } from '../services/dshMuxClient';
import { PWAInstallButton } from './PWAComponents';

interface ConnectionSheetProps {
  open: boolean;
  config: ConnectionConfig;
  onClose: () => void;
  onSave: (next: ConnectionConfig) => void;
}

const RELAY_CARD_SNIPPET = `# DeepSeek Harness /api/remote.mux (stream-protocol.ts) 报文格式
{"type":"open","streamId":"<uuid>","endpoint":"workspace/follow","payload":{"args":{}}}

# 若服务端挂了自定桥接，在回复文本中附带 relay-card 代码块，前端即自动渲染原生交互卡片：
\`\`\`relay-card
{
  "type": "briefing",
  "data": {
    "id": "paper-2026-1125",
    "kind": "paper",
    "title": "论文标题",
    "source": "arXiv cs.AI",
    "publishedAt": "08:30",
    "readMinutes": 5,
    "summary": "一句话核心结论...",
    "takeaways": ["要点 1", "要点 2"],
    "relevanceNote": "与你当前项目的关联",
    "saved": false,
    "url": "https://arxiv.org/abs/..."
  }
}
\`\`\``;

export const ConnectionSheet: React.FC<ConnectionSheetProps> = ({
  open,
  config,
  onClose,
  onSave,
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
      desc: '走 Tailscale HTTPS/WSS 直连 /api/remote.mux',
    },
    {
      key: 'openai-compatible',
      title: 'OpenAI 兼容接口',
      desc: '标准 /v1/chat/completions 流式 SSE 接口',
    },
    {
      key: 'sandbox',
      title: '本地交互体验',
      desc: '免连接离线体验全部交互卡片与工作流',
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
      '来自你的私人 Agent 控制台的 Tailscale ntfy 测试通知。'
    );
    setNtfyStatus(res.detail);
  };

  const handleCopyProtocol = async () => {
    try {
      await navigator.clipboard.writeText(RELAY_CARD_SNIPPET);
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
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/55 backdrop-blur-xs sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-t-3xl border border-slate-200/80 bg-white dark:border-slate-800 dark:bg-[#131822] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mt-3 h-1.5 w-10 shrink-0 rounded-full bg-slate-300 dark:bg-slate-700 sm:hidden" />

        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-800/80">
          <div className="flex items-center gap-2.5">
            <Link2 className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              服务器与 Agent 通道配置
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭设置"
            className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
          {/* Connection Mode Selector */}
          <div>
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
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
                    className={`rounded-xl border p-3 text-left transition-colors ${
                      active
                        ? 'border-blue-600 bg-blue-50/60 dark:border-blue-500 dark:bg-blue-950/30'
                        : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900/60'
                    }`}
                  >
                    <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      {m.title}
                    </div>
                    <p className="mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
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
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  云服务器地址（Tailscale HTTPS 域名）
                </label>
                <input
                  type="url"
                  value={draft.serverUrl}
                  onChange={(e) => setDraft({ ...draft, serverUrl: e.target.value })}
                  placeholder="https://izn4adpsp65vta6oli1hhcz.tail6e132f.ts.net/agent"
                  className="mt-1.5 min-h-[44px] w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 font-mono-tabular text-xs text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-[#0B0E14] dark:text-slate-100"
                />
              </div>

              {draft.mode === 'dsh-bridge' ? (
                <>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                        WebSocket 路径
                      </label>
                      <input
                        type="text"
                        value={draft.wsEndpoint}
                        onChange={(e) => setDraft({ ...draft, wsEndpoint: e.target.value })}
                        placeholder="/api/remote.mux"
                        className="mt-1.5 min-h-[44px] w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 font-mono-tabular text-xs text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-[#0B0E14] dark:text-slate-100"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                        Workspace ID
                      </label>
                      <input
                        type="text"
                        value={draft.workspace}
                        onChange={(e) => setDraft({ ...draft, workspace: e.target.value })}
                        placeholder="9000111a-7d73-453e-b69d-16d9b271a9f3"
                        className="mt-1.5 min-h-[44px] w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 font-mono-tabular text-xs text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-[#0B0E14] dark:text-slate-100"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                        Stream / RPC endpoint
                      </label>
                      <input
                        type="text"
                        value={draft.rpcMethod || 'session/prompt'}
                        onChange={(e) => setDraft({ ...draft, rpcMethod: e.target.value })}
                        placeholder="session/prompt"
                        className="mt-1.5 min-h-[44px] w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 font-mono-tabular text-xs text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-[#0B0E14] dark:text-slate-100"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                        Session ID（可选）
                      </label>
                      <input
                        type="text"
                        value={draft.sessionId || ''}
                        onChange={(e) => setDraft({ ...draft, sessionId: e.target.value })}
                        placeholder="留空由服务端分配"
                        className="mt-1.5 min-h-[44px] w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 font-mono-tabular text-xs text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-[#0B0E14] dark:text-slate-100"
                      />
                    </div>
                  </div>

                  <div className="rounded-xl bg-slate-50 px-3.5 py-2.5 text-[11px] leading-relaxed text-slate-600 dark:bg-[#0B0E14] dark:text-slate-400">
                    <div>
                      实际 WebSocket 地址：
                      <span className="font-mono-tabular text-slate-900 dark:text-slate-200 break-all">
                        {resolvedWsUrl || '—'}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                      <span>鉴权策略：不发送 Authorization 请求头（令牌留空）。</span>
                      {draft.serverUrl.trim() && (
                        <a
                          href={draft.serverUrl.trim()}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-blue-600 underline-offset-2 hover:underline dark:text-blue-400 whitespace-nowrap"
                        >
                          先在浏览器直接打开该 HTTPS 测通 ↗
                        </a>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                      模型 / Agent 标识
                    </label>
                    <input
                      type="text"
                      value={draft.model}
                      onChange={(e) => setDraft({ ...draft, model: e.target.value })}
                      placeholder="deepseek-reasoner"
                      className="mt-1.5 min-h-[44px] w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 font-mono-tabular text-xs text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-[#0B0E14] dark:text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                      访问令牌（留空则不发送 Authorization）
                    </label>
                    <input
                      type="password"
                      value={draft.token}
                      onChange={(e) => setDraft({ ...draft, token: e.target.value })}
                      placeholder="留空"
                      className="mt-1.5 min-h-[44px] w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 font-mono-tabular text-xs text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-[#0B0E14] dark:text-slate-100"
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
                  className="inline-flex min-h-[40px] items-center gap-2 rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 whitespace-nowrap"
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
                      className="h-10 w-32 rounded-xl border border-slate-200 bg-slate-50 px-2.5 font-mono-tabular text-xs text-slate-800 dark:border-slate-700 dark:bg-[#0B0E14] dark:text-slate-200"
                    />
                    <button
                      type="button"
                      onClick={handleProbeRpc}
                      disabled={testing || probing}
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap"
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
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/30 dark:text-emerald-300'
                      : 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-200'
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
                    <pre className="max-h-32 overflow-auto rounded-lg bg-slate-950/90 p-2.5 font-mono-tabular text-[11px] text-slate-100 whitespace-pre-wrap break-all">
                      {testResult.rawFrame}
                    </pre>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ntfy over Tailscale Push Config */}
          <div className="border-t border-slate-100 pt-5 dark:border-slate-800/80 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                Android 锁屏推送（ntfy over Tailscale）
              </div>
              <button
                type="button"
                onClick={handleTestNtfy}
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400"
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
                placeholder="http://100.64.0.10:8085"
                className="min-h-[42px] w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono-tabular text-xs text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-[#0B0E14] dark:text-slate-100"
              />
              <input
                type="text"
                value={draft.ntfyTopic}
                onChange={(e) => setDraft({ ...draft, ntfyTopic: e.target.value })}
                placeholder="relay-reminders"
                className="min-h-[42px] w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono-tabular text-xs text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-[#0B0E14] dark:text-slate-100"
              />
            </div>
            {ntfyStatus && (
              <p className="text-xs text-slate-500 dark:text-slate-400">{ntfyStatus}</p>
            )}
          </div>

          {/* Interactive Card Protocol Reference */}
          <div className="border-t border-slate-100 pt-5 dark:border-slate-800/80 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                WebSocket 报文与交互卡片协议
              </span>
              <button
                type="button"
                onClick={handleCopyProtocol}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/40"
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                <span>{copied ? '已复制' : '复制协议'}</span>
              </button>
            </div>
            <pre className="max-h-44 overflow-auto rounded-xl bg-slate-950 p-3.5 font-mono-tabular text-[11px] leading-relaxed text-slate-200 dark:bg-[#0B0E14]">
              {RELAY_CARD_SNIPPET}
            </pre>
          </div>

          {/* Mobile PWA Install block inside settings */}
          <div className="border-t border-slate-100 pt-5 dark:border-slate-800/80">
            <PWAInstallButton />
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-slate-100 px-5 py-4 dark:border-slate-800/80">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="min-h-[44px] flex-1 rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            保存并应用连接
          </button>
        </div>
      </div>
    </div>
  );
};
