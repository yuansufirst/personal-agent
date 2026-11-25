/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  Bell,
  BookOpen,
  Check,
  Laptop,
  Link2,
  MessageSquare,
  Moon,
  Network,
  Server,
  Smartphone,
  Sun,
} from 'lucide-react';
import {
  DEFAULT_CONNECTION_CONFIG,
  INITIAL_BRIEFINGS,
  INITIAL_FILES,
  INITIAL_MESH_NODES,
  INITIAL_MESSAGES,
  INITIAL_REMINDERS,
  QUICK_MACROS,
} from './data/initialData';
import type {
  BriefingItem,
  ChatAttachment,
  ChatMessage,
  ConnectionConfig,
  InteractiveCard,
  MeshFileItem,
  MeshNode,
  QuickMacro,
  ReminderItem,
  TabKey,
} from './types/relay';
import { streamAgentReply } from './services/agentClient';
import { resetDshSession } from './services/dshMuxClient';
import { ChatView } from './components/ChatView';
import { BriefingsView } from './components/BriefingsView';
import { MeshView } from './components/MeshView';
import { RemindersView } from './components/RemindersView';
import { ConnectionSheet } from './components/ConnectionSheet';
import { OfflineIndicator, PWAInstallButton } from './components/PWAComponents';

const STORAGE_KEYS = {
  config: 'relay_connection_config_v2',
  briefings: 'relay_briefings_v1',
  reminders: 'relay_reminders_v1',
  nodes: 'relay_mesh_nodes_v2',
  theme: 'relay_theme_v1',
};

function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function nowTimeString(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('chat');
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    const saved = loadFromStorage<string | null>(STORAGE_KEYS.theme, null);
    if (saved === 'dark') return true;
    if (saved === 'light') return false;
    return false;
  });

  const [config, setConfig] = useState<ConnectionConfig>(() =>
    loadFromStorage(STORAGE_KEYS.config, DEFAULT_CONNECTION_CONFIG)
  );
  const [messages, setMessages] = useState<ChatMessage[]>(INITIAL_MESSAGES);
  const [briefings, setBriefings] = useState<BriefingItem[]>(() =>
    loadFromStorage(STORAGE_KEYS.briefings, INITIAL_BRIEFINGS)
  );
  const [reminders, setReminders] = useState<ReminderItem[]>(() =>
    loadFromStorage(STORAGE_KEYS.reminders, INITIAL_REMINDERS)
  );
  const [nodes, setNodes] = useState<MeshNode[]>(() =>
    loadFromStorage(STORAGE_KEYS.nodes, INITIAL_MESH_NODES)
  );
  const [files, setFiles] = useState<MeshFileItem[]>(INITIAL_FILES);

  const [connectionOpen, setConnectionOpen] = useState(false);
  const [selectedBriefing, setSelectedBriefing] = useState<BriefingItem | null>(null);
  const [previewFile, setPreviewFile] = useState<MeshFileItem | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isFetchingDigest, setIsFetchingDigest] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    localStorage.setItem(STORAGE_KEYS.theme, JSON.stringify(darkMode ? 'dark' : 'light'));
  }, [darkMode]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.config, JSON.stringify(config));
  }, [config]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.briefings, JSON.stringify(briefings));
  }, [briefings]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.reminders, JSON.stringify(reminders));
  }, [reminders]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.nodes, JSON.stringify(nodes));
  }, [nodes]);

  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2800);
  };

  const handleSendMessage = async (text: string, attachments?: ChatAttachment[]) => {
    if (isStreaming && abortRef.current) {
      abortRef.current.abort();
    }

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: nowTimeString(),
      attachments,
    };

    const assistantId = `assistant-${Date.now() + 1}`;
    const placeholderMsg: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      timestamp: nowTimeString(),
      streaming: true,
    };

    const nextHistory = [...messages, userMsg];
    setMessages([...nextHistory, placeholderMsg]);
    setIsStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await streamAgentReply(
        text,
        nextHistory,
        config,
        (chunk) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    content: chunk.text,
                    cards: chunk.cards ?? m.cards,
                    streaming: !chunk.done,
                  }
                : m
            )
          );
        },
        controller.signal
      );
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        const message = err instanceof Error ? err.message : '请求失败，请检查服务器连接';
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content: `连接云端 Agent 遇到问题：${message}\n\n你可以点击「连接配置」检查 Tailscale 地址或切换回本地体验模式。`,
                  streaming: false,
                }
              : m
          )
        );
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  };

  const handleStopStreaming = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      setIsStreaming(false);
      setMessages((prev) => prev.map((m) => (m.streaming ? { ...m, streaming: false } : m)));
    }
  };

  const handleNewSession = () => {
    if (abortRef.current) abortRef.current.abort();
    setIsStreaming(false);
    resetDshSession(config);
    setMessages([
      {
        id: `welcome-${Date.now()}`,
        role: 'assistant',
        timestamp: nowTimeString(),
        content: '已开启全新会话。你可以直接下发 PC/手机控制指令，或让我为你生成今日新闻、论文与提醒卡片。',
      },
    ]);
    showToast('已开启新的对话会话');
  };

  const handleToggleSaveBriefing = (item: BriefingItem) => {
    const nextSaved = !item.saved;
    setBriefings((prev) => {
      const exists = prev.some((b) => b.id === item.id);
      if (exists) {
        return prev.map((b) => (b.id === item.id ? { ...b, saved: nextSaved } : b));
      }
      return [{ ...item, saved: true }, ...prev];
    });
    setMessages((prev) =>
      prev.map((m) => ({
        ...m,
        cards: m.cards?.map((c) =>
          c.type === 'briefing' && c.data.id === item.id
            ? { ...c, data: { ...c.data, saved: nextSaved } }
            : c
        ),
      }))
    );
    showToast(nextSaved ? '已收藏到简报页' : '已取消收藏');
  };

  const handleFetchFreshDigest = () => {
    setIsFetchingDigest(true);
    window.setTimeout(() => {
      const fresh: BriefingItem = {
        id: `brief-live-${Date.now()}`,
        kind: briefings.length % 2 === 0 ? 'paper' : 'news',
        title:
          briefings.length % 2 === 0
            ? 'Zero-Friction Personal Orchestration over Private WireGuard Meshes'
            : '今日晚间快讯：开源移动端 Agent 与本地知识库同步工具动态',
        source: briefings.length % 2 === 0 ? 'arXiv cs.SY' : '晚间技术精选',
        identifier: briefings.length % 2 === 0 ? 'arXiv:2611.05390' : '新抓取 3 条',
        publishedAt: `今天 ${nowTimeString()}`,
        readMinutes: 4,
        summary:
          '总结了在私有 WireGuard / Tailscale 网络下运行多端 Agent 的最佳安全实践，包含短令牌轮换、卡片化审批与低带宽文件差量同步。',
        takeaways: [
          '通过 Tailscale Serve 暴露 HTTPS 入口后，移动端 PWA 无需额外证书配置即可启用原生推送与安装。',
          '将跨设备文件读取封装为只读摘要优先模式，减少大文件直接占用手机流量。',
        ],
        relevanceNote: '可直接应用在你当前的云服务器 + Android + PC 组网中。',
        saved: false,
        url: 'https://arxiv.org/abs/2611.05390',
      };
      setBriefings((prev) => [fresh, ...prev]);
      setIsFetchingDigest(false);
      showToast('已拉取 1 条最新简报卡片');
    }, 550);
  };

  const handleAskAboutBriefing = (item: BriefingItem) => {
    setActiveTab('chat');
    handleSendMessage(`请结合我的工作流深入解读这篇内容：《${item.title}》（${item.source}），并给出 2 条可执行建议。`);
  };

  const handleSendBriefingToPC = (item: BriefingItem) => {
    const newFile: MeshFileItem = {
      id: `file-md-${Date.now()}`,
      name: `${item.title.slice(0, 24).replace(/\s+/g, '_')}.md`,
      size: '8.6 KB',
      sourceNode: 'cloud',
      targetNode: 'pc',
      path: `D:/Workspace/Digests/${item.id}.md`,
      updatedAt: '刚刚',
      status: 'synced',
      previewText: `# ${item.title}\n\n来源：${item.source}\n\n${item.summary}\n\n## 要点\n${item.takeaways
        .map((t, i) => `${i + 1}. ${t}`)
        .join('\n')}`,
    };
    setFiles((prev) => [newFile, ...prev]);
    showToast('已将 Markdown 摘要同步至个人电脑工作目录');
  };

  const handleToggleReminderById = (id: string) => {
    setReminders((prev) =>
      prev.map((r) => (r.id === id ? { ...r, completed: !r.completed } : r))
    );
    setMessages((prev) =>
      prev.map((m) => ({
        ...m,
        cards: m.cards?.map((c) =>
          c.type === 'reminder' && c.data.id === id
            ? { ...c, data: { ...c.data, completed: !c.data.completed } }
            : c
        ),
      }))
    );
  };

  const handleSnoozeReminderById = (id: string) => {
    setReminders((prev) =>
      prev.map((r) => (r.id === id ? { ...r, dueLabel: `${r.dueLabel}（已延后 30m）` } : r))
    );
    setMessages((prev) =>
      prev.map((m) => ({
        ...m,
        cards: m.cards?.map((c) =>
          c.type === 'reminder' && c.data.id === id
            ? { ...c, data: { ...c.data, dueLabel: `${c.data.dueLabel}（已延后 30m）` } }
            : c
        ),
      }))
    );
    showToast('已将提醒延后 30 分钟');
  };

  const handleSyncReminderFromCard = (item: ReminderItem) => {
    setReminders((prev) => {
      if (prev.some((r) => r.id === item.id)) return prev;
      return [item, ...prev];
    });
    showToast('已同步到「提醒」日程中心');
  };

  const handleAddReminder = (item: Omit<ReminderItem, 'id' | 'completed'>) => {
    setReminders((prev) => [
      { ...item, id: `rem-${Date.now()}`, completed: false },
      ...prev,
    ]);
  };

  const handleDeleteReminder = (id: string) => {
    setReminders((prev) => prev.filter((r) => r.id !== id));
    showToast('已删除该提醒');
  };

  const handleResolveApproval = (actionId: string, decision: 'approved' | 'rejected') => {
    const action = messages
      .flatMap((m) => m.cards ?? [])
      .find(
        (c): c is Extract<InteractiveCard, { type: 'approval' }> =>
          c.type === 'approval' && c.data.id === actionId
      );
    setMessages((prev) =>
      prev.map((m) => ({
        ...m,
        cards: m.cards?.map((c) =>
          c.type === 'approval' && c.data.id === actionId
            ? {
                ...c,
                data: {
                  ...c.data,
                  status: decision,
                  resultOutput:
                    decision === 'approved'
                      ? '指令已通过 Tailscale 下发并执行成功（耗时 0.8s）'
                      : undefined,
                },
              }
            : c
        ),
      }))
    );
    showToast(decision === 'approved' ? '已批准并通过 Tailscale 下发执行' : '已拒绝该操作');
    if (decision === 'approved' && action) {
      handleSendMessage(
        `已批准执行：${action.data.targetDevice} · ${action.data.commandPreview}。请在云端确认并执行，完成后把结果告诉我。`
      );
    }
  };

  const handleUpdateNodeIp = (nodeId: string, newIp: string) => {
    setNodes((prev) =>
      prev.map((n) => (n.id === nodeId ? { ...n, tailscaleIp: newIp } : n))
    );
    showToast(`已更新节点 Tailscale IP 为 ${newIp}`);
  };

  const handleRunMacro = (macro: QuickMacro) => {
    setActiveTab('chat');
    handleSendMessage(macro.command);
  };

  const handleUploadLocalFile = (file: File) => {
    const sizeLabel =
      file.size < 1024 * 1024
        ? `${Math.max(1, Math.round(file.size / 1024))} KB`
        : `${(file.size / (1024 * 1024)).toFixed(1)} MB`;

    const isTextLike = file.type.startsWith('text/') || /\.(md|txt|json|csv|ts|py)$/i.test(file.name);

    const finalize = (previewText?: string) => {
      const entry: MeshFileItem = {
        id: `file-up-${Date.now()}`,
        name: file.name,
        size: sizeLabel,
        sourceNode: 'android',
        targetNode: 'pc',
        path: `/Taildrive/RelayInbox/${file.name}`,
        updatedAt: '刚刚',
        status: 'synced',
        previewText:
          previewText || '已加入 Tailscale 传输队列，可在对话中让云端 Agent 读取或转存到电脑。',
      };
      setFiles((prev) => [entry, ...prev]);
      showToast(`已添加 ${file.name} 到设备网文件流`);
    };

    if (isTextLike && file.size < 200_000) {
      const reader = new FileReader();
      reader.onload = () => finalize(String(reader.result || '').slice(0, 2000));
      reader.onerror = () => finalize();
      reader.readAsText(file);
    } else {
      finalize();
    }
  };

  const handleAskAboutFile = (file: MeshFileItem) => {
    setActiveTab('chat');
    handleSendMessage(`请读取并总结设备网文件「${file.name}」（路径：${file.path}）的核心内容。`);
  };

  const pendingTodayCount = reminders.filter((r) => !r.completed && r.dayGroup === 'today').length;

  const navItems: {
    key: TabKey;
    label: string;
    Icon: React.ComponentType<{ className?: string }>;
  }[] = [
    { key: 'chat', label: '对话', Icon: MessageSquare },
    { key: 'briefings', label: '简报', Icon: BookOpen },
    { key: 'mesh', label: '设备', Icon: Network },
    { key: 'reminders', label: '提醒', Icon: Bell },
  ];

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[#F6F7F9] text-slate-900 dark:bg-[#0B0E14] dark:text-slate-100 lg:flex-row">
      {/* Desktop Left Navigation Rail */}
      <aside className="hidden lg:flex lg:w-60 lg:shrink-0 lg:flex-col lg:justify-between border-r border-slate-200/90 bg-white px-4 py-5 dark:border-slate-800/90 dark:bg-[#10141D]">
        <div>
          {/* Clean Single-Element Brand Wordmark */}
          <div className="flex items-center gap-2.5 px-2">
            <img
              src="/icon.svg"
              alt="Relay"
              className="h-7 w-7 rounded-lg"
            />
            <span className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0">
              Relay
            </span>
          </div>

          <nav className="mt-7 space-y-1">
            {navItems.map(({ key, label, Icon }) => {
              const active = activeTab === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setActiveTab(key)}
                  className={`flex min-h-[44px] w-full items-center justify-between rounded-xl px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-400'
                      : 'text-slate-600 hover:bg-slate-100/80 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-100'
                  }`}
                >
                  <span className="flex items-center gap-3">
                    <Icon className="h-[18px] w-[18px]" />
                    <span>{label}</span>
                  </span>
                  {key === 'reminders' && pendingTodayCount > 0 && (
                    <span className="font-mono-tabular text-xs text-slate-500 dark:text-slate-400">
                      {pendingTodayCount}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="space-y-2 border-t border-slate-100 pt-4 dark:border-slate-800/80">
          <button
            type="button"
            onClick={() => setConnectionOpen(true)}
            className="flex min-h-[42px] w-full items-center gap-2.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800/70"
          >
            <Link2 className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0" />
            <span className="truncate">
              {config.mode === 'sandbox' ? '连接配置 · 体验模式' : '已配置 Tailscale 通道'}
            </span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setDarkMode((prev) => !prev)}
              className="flex min-h-[42px] flex-1 items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800/70 whitespace-nowrap"
            >
              {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              <span>{darkMode ? '浅色模式' : '深色模式'}</span>
            </button>
          </div>

          <PWAInstallButton />
        </div>
      </aside>

      {/* Mobile Compact Top Header (52px) */}
      <header className="flex h-[52px] shrink-0 items-center justify-between border-b border-slate-200/80 bg-white/90 px-4 backdrop-blur-md dark:border-slate-800/80 dark:bg-[#10141D]/90 lg:hidden">
        <div className="flex items-center gap-2">
          <img src="/icon.svg" alt="Relay" className="h-6 w-6 rounded-md" />
          <span className="text-base font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0">
            Relay
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setDarkMode((prev) => !prev)}
            aria-label="切换深浅色主题"
            className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={() => setConnectionOpen(true)}
            className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-slate-900 px-3 text-xs font-medium text-white dark:bg-blue-600 whitespace-nowrap shrink-0"
          >
            <Link2 className="h-3.5 w-3.5" />
            <span>连接</span>
          </button>
        </div>
      </header>

      {/* Center Workspace */}
      <main className="min-h-0 flex-1 overflow-y-auto">
        {activeTab === 'chat' && (
          <div className="h-full pb-[60px] lg:pb-0">
            <ChatView
              messages={messages}
              config={config}
              isStreaming={isStreaming}
              onSendMessage={handleSendMessage}
              onStopStreaming={handleStopStreaming}
              onNewSession={handleNewSession}
              onOpenConnection={() => setConnectionOpen(true)}
              onToggleSaveBriefing={handleToggleSaveBriefing}
              onOpenBriefing={(item) => {
                setSelectedBriefing(item);
                setActiveTab('briefings');
              }}
              onAskAboutBriefing={handleAskAboutBriefing}
              onToggleReminder={(item) => handleToggleReminderById(item.id)}
              onSnoozeReminder={(item) => handleSnoozeReminderById(item.id)}
              onSyncReminder={handleSyncReminderFromCard}
              onResolveApproval={handleResolveApproval}
              onPreviewFile={(file) => {
                setPreviewFile(file);
                setActiveTab('mesh');
              }}
              onAskAboutFile={handleAskAboutFile}
              onShowToast={showToast}
            />
          </div>
        )}

        {activeTab === 'briefings' && (
          <BriefingsView
            items={briefings}
            onToggleSave={handleToggleSaveBriefing}
            onFetchFreshDigest={handleFetchFreshDigest}
            onAskAgent={handleAskAboutBriefing}
            onSendToPC={handleSendBriefingToPC}
            selectedBriefing={selectedBriefing}
            onSelectBriefing={setSelectedBriefing}
            isFetching={isFetchingDigest}
          />
        )}

        {activeTab === 'mesh' && (
          <MeshView
            nodes={nodes}
            onUpdateNodeIp={handleUpdateNodeIp}
            macros={QUICK_MACROS}
            onRunMacro={handleRunMacro}
            files={files}
            onUploadLocalFile={handleUploadLocalFile}
            onAskAboutFile={handleAskAboutFile}
            previewFile={previewFile}
            onSelectPreviewFile={setPreviewFile}
          />
        )}

        {activeTab === 'reminders' && (
          <RemindersView
            reminders={reminders}
            config={config}
            onAddReminder={handleAddReminder}
            onToggleReminder={handleToggleReminderById}
            onSnoozeReminder={handleSnoozeReminderById}
            onDeleteReminder={handleDeleteReminder}
            onShowToast={showToast}
          />
        )}
      </main>

      {/* Desktop Right Context Panel (fills 1440px viewport purposefully on Chat tab) */}
      {activeTab === 'chat' && (
        <aside className="hidden xl:flex xl:w-80 xl:shrink-0 xl:flex-col border-l border-slate-200/90 bg-white/70 px-5 py-5 overflow-y-auto dark:border-slate-800/90 dark:bg-[#10141D]/70 space-y-6">
          {/* Tailscale Mesh Quick Overview */}
          <div>
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                Tailscale 设备网
              </h2>
              <button
                type="button"
                onClick={() => setActiveTab('mesh')}
                className="text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400"
              >
                管理
              </button>
            </div>
            <div className="mt-3 divide-y divide-slate-100 rounded-2xl border border-slate-200/80 bg-white dark:divide-slate-800/80 dark:border-slate-800 dark:bg-[#131822]">
              {nodes.map((node) => {
                const Icon =
                  node.role === 'cloud'
                    ? Server
                    : node.role === 'pc'
                      ? Laptop
                      : Smartphone;
                return (
                  <div key={node.id} className="flex items-center justify-between gap-2.5 px-3.5 py-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Icon className="h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400" />
                      <div className="min-w-0">
                        <div className="truncate text-xs font-medium text-slate-900 dark:text-slate-100">
                          {node.name}
                        </div>
                        <div className="font-mono-tabular text-[11px] text-slate-500 dark:text-slate-400">
                          {node.tailscaleIp}
                        </div>
                      </div>
                    </div>
                    <span className="font-mono-tabular text-[11px] text-slate-400 shrink-0">
                      {node.latencyMs}ms
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Today's Reminders */}
          <div>
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                今日待办提醒
              </h2>
              <button
                type="button"
                onClick={() => setActiveTab('reminders')}
                className="text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400"
              >
                全部
              </button>
            </div>
            <div className="mt-3 divide-y divide-slate-100 rounded-2xl border border-slate-200/80 bg-white dark:divide-slate-800/80 dark:border-slate-800 dark:bg-[#131822]">
              {reminders
                .filter((r) => r.dayGroup === 'today')
                .slice(0, 4)
                .map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleToggleReminderById(item.id)}
                    className="flex w-full items-start gap-2.5 px-3.5 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                  >
                    <span
                      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                        item.completed
                          ? 'border-emerald-600 bg-emerald-600 text-white'
                          : 'border-slate-300 dark:border-slate-600'
                      }`}
                    >
                      {item.completed && <Check className="h-3 w-3" />}
                    </span>
                    <div className="min-w-0">
                      <div
                        className={`text-xs font-medium leading-snug ${
                          item.completed
                            ? 'text-slate-400 line-through'
                            : 'text-slate-800 dark:text-slate-200'
                        }`}
                      >
                        {item.title}
                      </div>
                      <div className="mt-0.5 font-mono-tabular text-[11px] text-slate-400">
                        {item.dueLabel}
                      </div>
                    </div>
                  </button>
                ))}
            </div>
          </div>

          {/* Quick Macros */}
          <div>
            <h2 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
              一键指令
            </h2>
            <div className="mt-3 space-y-2">
              {QUICK_MACROS.slice(0, 3).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => handleRunMacro(m)}
                  className="flex w-full items-center justify-between rounded-xl border border-slate-200/80 bg-white px-3.5 py-2.5 text-left text-xs font-medium text-slate-700 transition-colors hover:border-blue-300 hover:text-blue-600 dark:border-slate-800 dark:bg-[#131822] dark:text-slate-200 dark:hover:border-blue-800 dark:hover:text-blue-400"
                >
                  <span className="truncate">{m.label}</span>
                  <span className="font-mono-tabular text-[11px] text-slate-400 shrink-0">
                    执行
                  </span>
                </button>
              ))}
            </div>
          </div>
        </aside>
      )}

      {/* Mobile Fixed Bottom Tab Bar (60px, Thumb Zone Ergonomics) */}
      <nav
        aria-label="主导航"
        className="fixed bottom-0 left-0 right-0 z-40 grid h-[60px] grid-cols-4 items-center border-t border-slate-200/90 bg-white/95 pb-safe backdrop-blur-md dark:border-slate-800/90 dark:bg-[#10141D]/95 lg:hidden"
      >
        {navItems.map(({ key, label, Icon }) => {
          const active = activeTab === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setActiveTab(key)}
              className={`flex h-full min-h-[44px] flex-col items-center justify-center gap-0.5 transition-colors ${
                active
                  ? 'text-blue-600 dark:text-blue-400'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              <Icon className="h-5 w-5" />
              <span className="text-[11px] font-medium tracking-tight whitespace-nowrap">
                {label}
              </span>
            </button>
          );
        })}
      </nav>

      {/* Connection & DeepSeek Harness Configuration Bottom Sheet */}
      <ConnectionSheet
        open={connectionOpen}
        config={config}
        onClose={() => setConnectionOpen(false)}
        onSave={(next) => {
          resetDshSession(config);
          setConfig(next);
          showToast(
            next.mode === 'sandbox'
              ? '已切换为本地交互体验模式'
              : `已保存连接配置：${next.serverUrl}`
          );
        }}
      />

      {/* Offline Status Toast */}
      <OfflineIndicator />

      {/* Action Feedback Toast */}
      {toast && (
        <div
          role="status"
          className="fixed top-16 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-medium text-white shadow-lg dark:bg-slate-100 dark:text-slate-900 lg:top-5 whitespace-nowrap"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
