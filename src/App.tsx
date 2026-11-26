/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Compass,
  Hash,
  Link2,
  MessageSquare,
  Moon,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Sun,
  Target,
  Trash2,
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
  GoalItem,
  InteractiveCard,
  MeshFileItem,
  MeshNode,
  QuickMacro,
  ReminderItem,
  SessionRecord,
  TabKey,
} from './types/relay';
import { streamAgentReply } from './services/agentClient';
import {
  listDshSessions,
  loadDshSessionHistory,
  resetDshSession,
} from './services/dshMuxClient';
import { ChatView } from './components/ChatView';
import { GoalsView } from './components/GoalsView';
import { SpaceView } from './components/SpaceView';
import { ConnectionSheet } from './components/ConnectionSheet';
import { OfflineIndicator, PWAInstallButton } from './components/PWAComponents';
import { registerAndroidBackHandler, syncNativeStatusBar } from './services/nativeApp';
import museAvatar from './assets/images/muse_agent_avatar_1795671239700.jpg';

const STORAGE_KEYS = {
  config: 'relay_connection_config_v2',
  sessions: 'relay_sessions_v1',
  activeSessionId: 'relay_active_session_v1',
  briefings: 'relay_briefings_v2',
  reminders: 'relay_reminders_v2',
  goals: 'relay_goals_v1',
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

function createEmptySession(remoteSessionId?: string, title?: string): SessionRecord {
  const cleanRemote = remoteSessionId?.trim() || undefined;
  return {
    id: cleanRemote || `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    remoteSessionId: cleanRemote,
    title: title || (cleanRemote ? `会话 ${cleanRemote.slice(0, 8)}` : '新会话'),
    updatedAt: nowTimeString(),
    source: cleanRemote ? 'remote' : 'local',
    messages: [],
    historyLoaded: false,
  };
}

function sanitizeSessionsForStorage(sessions: SessionRecord[]): SessionRecord[] {
  return sessions.slice(0, 40).map((s) => ({
    ...s,
    messages: s.messages.slice(-80).map((m) => ({
      ...m,
      streaming: false,
      thinking: m.thinking ? m.thinking.slice(0, 4000) : undefined,
      toolSteps: m.toolSteps?.slice(0, 20),
      attachments: m.attachments?.map((att) => ({
        name: att.name,
        size: att.size,
        mimeType: att.mimeType,
        dataUrl: att.dataUrl && att.dataUrl.length < 180_000 ? att.dataUrl : undefined,
      })),
    })),
  }));
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

  const [sessions, setSessions] = useState<SessionRecord[]>(() => {
    const saved = loadFromStorage<SessionRecord[]>(STORAGE_KEYS.sessions, []);
    if (saved.length > 0) return saved;
    const initialCfg = loadFromStorage(STORAGE_KEYS.config, DEFAULT_CONNECTION_CONFIG);
    if (initialCfg.mode === 'sandbox') {
      return [
        {
          id: 'sandbox-demo',
          title: '本地体验会话',
          updatedAt: nowTimeString(),
          source: 'local',
          messages: INITIAL_MESSAGES,
          historyLoaded: true,
        },
      ];
    }
    return [createEmptySession(initialCfg.sessionId)];
  });

  const [activeSessionId, setActiveSessionId] = useState<string>(() => {
    const savedId = loadFromStorage<string>(STORAGE_KEYS.activeSessionId, '');
    const savedSessions = loadFromStorage<SessionRecord[]>(STORAGE_KEYS.sessions, []);
    if (savedId && savedSessions.some((s) => s.id === savedId)) {
      return savedId;
    }
    if (savedSessions.length > 0) {
      return savedSessions[0].id;
    }
    return '';
  });

  const [goals, setGoals] = useState<GoalItem[]>(() =>
    loadFromStorage(STORAGE_KEYS.goals, [])
  );

  const [briefings, setBriefings] = useState<BriefingItem[]>(() => {
    const initialCfg = loadFromStorage(STORAGE_KEYS.config, DEFAULT_CONNECTION_CONFIG);
    return loadFromStorage(
      STORAGE_KEYS.briefings,
      initialCfg.mode === 'sandbox' ? INITIAL_BRIEFINGS : []
    );
  });

  const [reminders, setReminders] = useState<ReminderItem[]>(() => {
    const initialCfg = loadFromStorage(STORAGE_KEYS.config, DEFAULT_CONNECTION_CONFIG);
    return loadFromStorage(
      STORAGE_KEYS.reminders,
      initialCfg.mode === 'sandbox' ? INITIAL_REMINDERS : []
    );
  });

  const [nodes, setNodes] = useState<MeshNode[]>(() =>
    loadFromStorage(STORAGE_KEYS.nodes, INITIAL_MESH_NODES)
  );

  const [files, setFiles] = useState<MeshFileItem[]>(() => {
    const initialCfg = loadFromStorage(STORAGE_KEYS.config, DEFAULT_CONNECTION_CONFIG);
    return initialCfg.mode === 'sandbox' ? INITIAL_FILES : [];
  });

  const [connectionOpen, setConnectionOpen] = useState(false);
  const [selectedBriefing, setSelectedBriefing] = useState<BriefingItem | null>(null);
  const [previewFile, setPreviewFile] = useState<MeshFileItem | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isFetchingDigest, setIsFetchingDigest] = useState(false);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Desktop left-sidebar session helpers
  const [sidebarSearch, setSidebarSearch] = useState('');
  const [showSidebarBind, setShowSidebarBind] = useState(false);
  const [sidebarBindInput, setSidebarBindInput] = useState('');
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  const abortRef = useRef<AbortController | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const activeSession = useMemo(() => {
    return sessions.find((s) => s.id === activeSessionId) || sessions[0] || createEmptySession();
  }, [sessions, activeSessionId]);

  const messages = activeSession.messages;

  const filteredSidebarSessions = useMemo(() => {
    const q = sidebarSearch.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        (s.remoteSessionId && s.remoteSessionId.toLowerCase().includes(q))
    );
  }, [sessions, sidebarSearch]);

  useEffect(() => {
    if (activeSession.id !== activeSessionId) {
      setActiveSessionId(activeSession.id);
    }
  }, [activeSession.id, activeSessionId]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    localStorage.setItem(STORAGE_KEYS.theme, JSON.stringify(darkMode ? 'dark' : 'light'));
    void syncNativeStatusBar(darkMode);
  }, [darkMode]);

  useEffect(() => {
    return registerAndroidBackHandler(() => {
      if (connectionOpen) {
        setConnectionOpen(false);
        return true;
      }
      if (selectedBriefing) {
        setSelectedBriefing(null);
        return true;
      }
      if (previewFile) {
        setPreviewFile(null);
        return true;
      }
      if (activeTab !== 'chat') {
        setActiveTab('chat');
        return true;
      }
      return false;
    });
  }, [connectionOpen, selectedBriefing, previewFile, activeTab]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.config, JSON.stringify(config));
  }, [config]);

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEYS.sessions,
        JSON.stringify(sanitizeSessionsForStorage(sessions))
      );
      localStorage.setItem(STORAGE_KEYS.activeSessionId, JSON.stringify(activeSession.id));
    } catch {
      // Ignore quota errors
    }
  }, [sessions, activeSession.id]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.goals, JSON.stringify(goals));
  }, [goals]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.briefings, JSON.stringify(briefings));
  }, [briefings]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.reminders, JSON.stringify(reminders));
  }, [reminders]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.nodes, JSON.stringify(nodes));
  }, [nodes]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2800);
  }, []);

  const updateSessionMessages = useCallback(
    (sessionId: string, updater: (prev: ChatMessage[]) => ChatMessage[]) => {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId
            ? { ...s, messages: updater(s.messages), updatedAt: nowTimeString() }
            : s
        )
      );
    },
    []
  );

  const handleRefreshSessions = useCallback(
    async (silent = false) => {
      if (config.mode !== 'dsh-bridge') return;
      setIsLoadingSessions(true);
      try {
        const remoteList = await listDshSessions(config);
        if (remoteList.length === 0) {
          if (!silent) {
            showToast('未从云端拉取到历史会话，可粘贴 Session ID 直接接入');
          }
          return;
        }

        setSessions((prev) => {
          const merged = [...prev];
          for (const remote of remoteList) {
            const existingIdx = merged.findIndex(
              (s) => s.remoteSessionId === remote.sessionId || s.id === remote.sessionId
            );
            if (existingIdx >= 0) {
              merged[existingIdx] = {
                ...merged[existingIdx],
                remoteSessionId: remote.sessionId,
                source: 'remote',
                title:
                  merged[existingIdx].title === '新会话' ||
                  merged[existingIdx].title.startsWith('会话 ')
                    ? remote.title
                    : merged[existingIdx].title,
                updatedAt: remote.updatedAt || merged[existingIdx].updatedAt,
              };
            } else {
              merged.push({
                id: remote.sessionId,
                remoteSessionId: remote.sessionId,
                title: remote.title,
                updatedAt: remote.updatedAt,
                source: 'remote',
                messages: [],
                historyLoaded: false,
              });
            }
          }
          return merged;
        });

        if (!silent) {
          showToast(`已同步 ${remoteList.length} 个云端会话`);
        }
      } catch {
        if (!silent) {
          showToast('同步云端会话列表失败，请确认 Tailscale 连接正常');
        }
      } finally {
        setIsLoadingSessions(false);
      }
    },
    [config, showToast]
  );

  const didInitFetchRef = useRef(false);
  useEffect(() => {
    if (config.mode === 'dsh-bridge' && !didInitFetchRef.current) {
      didInitFetchRef.current = true;
      void handleRefreshSessions(true);
    }
  }, [config.mode, handleRefreshSessions]);

  const handleSelectSession = async (targetId: string) => {
    if (abortRef.current) {
      abortRef.current.abort();
      setIsStreaming(false);
    }

    const target = sessions.find((s) => s.id === targetId);
    if (!target) return;

    setActiveSessionId(target.id);
    setActiveTab('chat');

    if (
      config.mode === 'dsh-bridge' &&
      target.remoteSessionId &&
      target.messages.length === 0 &&
      !target.historyLoaded
    ) {
      setIsLoadingHistory(true);
      try {
        const hist = await loadDshSessionHistory(config, target.remoteSessionId);
        setSessions((prev) =>
          prev.map((s) =>
            s.id === target.id
              ? {
                  ...s,
                  messages: hist.length > 0 ? hist : s.messages,
                  historyLoaded: true,
                }
              : s
          )
        );
      } finally {
        setIsLoadingHistory(false);
      }
    }
  };

  const handleBindSessionId = async (remoteSessionId: string) => {
    const clean = remoteSessionId.trim();
    if (!clean) return;

    const existing = sessions.find((s) => s.remoteSessionId === clean || s.id === clean);
    if (existing) {
      await handleSelectSession(existing.id);
      showToast(`已切换到会话 ${clean.slice(0, 8)}`);
      return;
    }

    const created = createEmptySession(clean);
    setSessions((prev) => [created, ...prev]);
    setActiveSessionId(created.id);
    setActiveTab('chat');
    showToast(`已接入会话 ${clean.slice(0, 8)}`);

    if (config.mode === 'dsh-bridge') {
      setIsLoadingHistory(true);
      try {
        const hist = await loadDshSessionHistory(config, clean);
        setSessions((prev) =>
          prev.map((s) =>
            s.id === created.id
              ? {
                  ...s,
                  messages: hist,
                  historyLoaded: true,
                  title:
                    hist.find((m) => m.role === 'user')?.content.slice(0, 22) || created.title,
                }
              : s
          )
        );
      } finally {
        setIsLoadingHistory(false);
      }
    }
  };

  const handleRenameSession = (sessionId: string, nextTitle: string) => {
    const clean = nextTitle.trim();
    if (clean) {
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, title: clean } : s))
      );
    }
    setRenamingSessionId(null);
  };

  const handleDeleteSession = (targetId: string) => {
    setSessions((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((s) => s.id !== targetId);
      if (activeSession.id === targetId && next.length > 0) {
        setActiveSessionId(next[0].id);
      }
      return next;
    });
  };

  const handleNewSession = () => {
    if (abortRef.current) abortRef.current.abort();
    setIsStreaming(false);
    resetDshSession(config);
    const fresh = createEmptySession();
    setSessions((prev) => [fresh, ...prev]);
    setActiveSessionId(fresh.id);
    setActiveTab('chat');
    showToast('已创建新会话');
  };

  const handleSendMessage = async (text: string, attachments?: ChatAttachment[]) => {
    if (isStreaming && abortRef.current) {
      abortRef.current.abort();
    }

    const currentSessionId = activeSession.id;
    const currentRemoteId = activeSession.remoteSessionId;

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

    const nextHistory = [...activeSession.messages, userMsg];

    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== currentSessionId) return s;
        const shouldAutoTitle = s.title === '新会话' || s.title.startsWith('会话 ');
        const autoTitle = text.trim().slice(0, 24) || attachments?.[0]?.name || s.title;
        return {
          ...s,
          title: shouldAutoTitle ? autoTitle : s.title,
          updatedAt: nowTimeString(),
          messages: [...nextHistory, placeholderMsg],
        };
      })
    );

    setIsStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    const effectiveConfig: ConnectionConfig =
      config.mode === 'dsh-bridge'
        ? { ...config, sessionId: currentRemoteId || '' }
        : config;

    try {
      await streamAgentReply(
        text,
        nextHistory,
        effectiveConfig,
        (chunk) => {
          updateSessionMessages(currentSessionId, (prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    content: chunk.text,
                    thinking: chunk.thinking ?? m.thinking,
                    toolSteps: chunk.toolSteps ?? m.toolSteps,
                    elapsedMs: chunk.elapsedMs ?? m.elapsedMs,
                    cards: chunk.cards ?? m.cards,
                    streaming: !chunk.done,
                  }
                : m
            )
          );
        },
        controller.signal,
        {
          attachments,
          sessionIdOverride: currentRemoteId || '',
          onSessionResolved: (resolvedRemoteId) => {
            setSessions((prev) =>
              prev.map((s) =>
                s.id === currentSessionId
                  ? {
                      ...s,
                      remoteSessionId: resolvedRemoteId,
                      source: 'remote',
                    }
                  : s
              )
            );
          },
        }
      );
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        const message = err instanceof Error ? err.message : '请求失败，请检查服务器连接';
        updateSessionMessages(currentSessionId, (prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content: `连接云端 Agent 遇到问题：${message}`,
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
      updateSessionMessages(activeSession.id, (prev) =>
        prev.map((m) => (m.streaming ? { ...m, streaming: false } : m))
      );
    }
  };

  // Goals handlers (Muse Pillar 2)
  const handleAddGoal = (title: string, notes: string, milestones: string[]) => {
    const newGoal: GoalItem = {
      id: `goal-${Date.now()}`,
      title,
      notes: notes || undefined,
      status: 'active',
      updatedAt: nowTimeString(),
      milestones: milestones.map((text, idx) => ({
        id: `ms-${Date.now()}-${idx}`,
        text,
        done: false,
      })),
    };
    setGoals((prev) => [newGoal, ...prev]);
  };

  const handleToggleMilestone = (goalId: string, milestoneId: string) => {
    setGoals((prev) =>
      prev.map((g) =>
        g.id === goalId
          ? {
              ...g,
              updatedAt: nowTimeString(),
              milestones: g.milestones.map((m) =>
                m.id === milestoneId ? { ...m, done: !m.done } : m
              ),
            }
          : g
      )
    );
  };

  const handleDeleteGoal = (goalId: string) => {
    setGoals((prev) => prev.filter((g) => g.id !== goalId));
    showToast('已删除目标');
  };

  const handleDelegateGoal = (goal: GoalItem) => {
    const remaining = goal.milestones.filter((m) => !m.done).map((m) => `- ${m.text}`);
    const promptLines = [
      `请帮我推进长期目标：「${goal.title}」`,
      goal.notes ? `背景说明：${goal.notes}` : '',
      remaining.length > 0 ? `当前未完成里程碑：\n${remaining.join('\n')}` : '',
      '请先给出下一步最直接可执行的方案，需要你在云端或设备上直接执行的部分请告诉我。',
    ].filter(Boolean);
    setActiveTab('chat');
    void handleSendMessage(promptLines.join('\n'));
  };

  // Briefings handlers
  const handleToggleSaveBriefing = (item: BriefingItem) => {
    const nextSaved = !item.saved;
    setBriefings((prev) => {
      const exists = prev.some((b) => b.id === item.id);
      if (exists) {
        return prev.map((b) => (b.id === item.id ? { ...b, saved: nextSaved } : b));
      }
      return [{ ...item, saved: true }, ...prev];
    });
    updateSessionMessages(activeSession.id, (prev) =>
      prev.map((m) => ({
        ...m,
        cards: m.cards?.map((c) =>
          c.type === 'briefing' && c.data.id === item.id
            ? { ...c, data: { ...c.data, saved: nextSaved } }
            : c
        ),
      }))
    );
    showToast(nextSaved ? '已收藏到空间归档' : '已取消收藏');
  };

  const handleFetchFreshDigest = () => {
    if (config.mode !== 'sandbox') {
      setActiveTab('chat');
      void handleSendMessage('请帮我抓取并整理今天的 AI 论文与科技简报。');
      return;
    }

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
    setSelectedBriefing(null);
    setActiveTab('chat');
    void handleSendMessage(
      `请结合我的工作流深入解读这篇内容：《${item.title}》（${item.source}），并给出 2 条可执行建议。`
    );
  };

  // Reminders handlers
  const handleToggleReminderById = (id: string) => {
    setReminders((prev) =>
      prev.map((r) => (r.id === id ? { ...r, completed: !r.completed } : r))
    );
    updateSessionMessages(activeSession.id, (prev) =>
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
    updateSessionMessages(activeSession.id, (prev) =>
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
    showToast('已同步到「目标」日程提醒');
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

  // Approval card handler (preserves cloud-agent approval dispatch to dsh)
  const handleResolveApproval = (actionId: string, decision: 'approved' | 'rejected') => {
    const action = messages
      .flatMap((m) => m.cards ?? [])
      .find(
        (c): c is Extract<InteractiveCard, { type: 'approval' }> =>
          c.type === 'approval' && c.data.id === actionId
      );
    updateSessionMessages(activeSession.id, (prev) =>
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
                      ? '指令已通过 Tailscale 下发并执行成功'
                      : undefined,
                },
              }
            : c
        ),
      }))
    );
    showToast(decision === 'approved' ? '已批准并通过 Tailscale 下发执行' : '已拒绝该操作');
    if (decision === 'approved' && action) {
      void handleSendMessage(
        `已批准执行：${action.data.targetDevice} · ${action.data.commandPreview}。请在云端确认并执行，完成后把结果告诉我。`
      );
    }
  };

  // Space / Environment handlers
  const handleUpdateNodeIp = (nodeId: string, newIp: string) => {
    setNodes((prev) =>
      prev.map((n) => (n.id === nodeId ? { ...n, tailscaleIp: newIp } : n))
    );
    showToast(`已更新节点 Tailscale IP 为 ${newIp}`);
  };

  const handleRunMacro = (macro: QuickMacro) => {
    setActiveTab('chat');
    void handleSendMessage(macro.command);
  };

  const handleUploadLocalFile = (file: File) => {
    const sizeLabel =
      file.size < 1024 * 1024
        ? `${Math.max(1, Math.round(file.size / 1024))} KB`
        : `${(file.size / (1024 * 1024)).toFixed(1)} MB`;

    const isTextLike =
      file.type.startsWith('text/') || /\.(md|txt|json|csv|ts|py)$/i.test(file.name);

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
          previewText || '已加入设备网文件列表，可在对话中让云端 Agent 读取或处理。',
      };
      setFiles((prev) => [entry, ...prev]);
      showToast(`已添加 ${file.name} 到文件归档`);
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
    setPreviewFile(null);
    setActiveTab('chat');
    void handleSendMessage(`请读取并总结设备网文件「${file.name}」（路径：${file.path}）的核心内容。`);
  };

  const pendingGoalsOrReminders =
    reminders.filter((r) => !r.completed && r.dayGroup === 'today').length +
    goals.filter((g) => g.status === 'active').length;

  const navItems: {
    key: TabKey;
    label: string;
    Icon: React.ComponentType<{ className?: string }>;
  }[] = [
    { key: 'chat', label: '对话', Icon: MessageSquare },
    { key: 'goals', label: '目标', Icon: Target },
    { key: 'space', label: '空间', Icon: Compass },
  ];

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[#F8F7F4] text-zinc-950 dark:bg-[#0E0F12] dark:text-zinc-100 lg:flex-row">
      {/* Desktop Muse Left Navigation & Session Sidebar */}
      <aside className="hidden lg:flex lg:w-[272px] lg:shrink-0 lg:flex-col border-r border-stone-200/80 bg-[#F3F1EC] dark:border-zinc-800/80 dark:bg-[#121318]">
        {/* Brand + New Chat */}
        <div className="flex items-center justify-between px-4 pt-5 pb-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <img
              src={museAvatar}
              alt="Relay"
              className="h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-stone-300/70 dark:ring-zinc-700"
            />
            <span className="text-base font-semibold tracking-tight text-zinc-950 dark:text-zinc-50 whitespace-nowrap">
              Relay
            </span>
          </div>
          <button
            type="button"
            onClick={handleNewSession}
            aria-label="新建对话"
            title="新建对话"
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-stone-200/90 bg-white text-zinc-700 transition-colors hover:border-[#1B6EF3]/50 hover:text-[#1B6EF3] dark:border-zinc-800 dark:bg-[#181A20] dark:text-zinc-200 dark:hover:border-blue-500/50 dark:hover:text-blue-400"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

        {/* 3-Pillar Navigation */}
        <nav className="px-3 pt-1 pb-3 space-y-0.5">
          {navItems.map(({ key, label, Icon }) => {
            const active = activeTab === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setActiveTab(key)}
                className={`flex min-h-[42px] w-full items-center justify-between rounded-2xl px-3 py-2 text-[13px] font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-white text-zinc-950 shadow-xs dark:bg-[#1C1F26] dark:text-zinc-50'
                    : 'text-zinc-600 hover:bg-stone-200/60 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-100'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <Icon
                    className={`h-[17px] w-[17px] ${
                      active ? 'text-[#1B6EF3] dark:text-blue-400' : ''
                    }`}
                  />
                  <span>{label}</span>
                </span>
                {key === 'goals' && pendingGoalsOrReminders > 0 && (
                  <span className="font-mono-tabular text-[11px] text-zinc-400">
                    {pendingGoalsOrReminders}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Searchable Session History */}
        <div className="flex min-h-0 flex-1 flex-col border-t border-stone-200/70 px-3 pt-3.5 dark:border-zinc-800/70">
          <div className="flex items-center justify-between px-1.5">
            <span className="text-[11px] font-semibold tracking-wide text-zinc-400">
              会话列表
            </span>
            <div className="flex items-center gap-0.5">
              {config.mode === 'dsh-bridge' && (
                <>
                  <button
                    type="button"
                    onClick={() => setShowSidebarBind((v) => !v)}
                    aria-label="按 Session ID 接入"
                    title="按 Session ID 接入"
                    className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${
                      showSidebarBind
                        ? 'bg-stone-200/90 text-[#1B6EF3] dark:bg-zinc-800 dark:text-blue-400'
                        : 'text-zinc-400 hover:bg-stone-200/70 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200'
                    }`}
                  >
                    <Hash className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleRefreshSessions(false)}
                    disabled={isLoadingSessions}
                    aria-label="同步云端会话"
                    title="同步云端会话"
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-stone-200/70 hover:text-[#1B6EF3] disabled:opacity-50 dark:hover:bg-zinc-800 dark:hover:text-blue-400"
                  >
                    <RefreshCw
                      className={`h-3.5 w-3.5 ${isLoadingSessions ? 'animate-spin' : ''}`}
                    />
                  </button>
                </>
              )}
            </div>
          </div>

          {showSidebarBind && config.mode === 'dsh-bridge' && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!sidebarBindInput.trim()) return;
                void handleBindSessionId(sidebarBindInput);
                setSidebarBindInput('');
                setShowSidebarBind(false);
              }}
              className="mt-2 flex items-center gap-1.5"
            >
              <input
                type="text"
                value={sidebarBindInput}
                onChange={(e) => setSidebarBindInput(e.target.value)}
                placeholder="粘贴 Session ID…"
                className="min-h-[34px] min-w-0 flex-1 rounded-xl border border-stone-200 bg-white px-2.5 font-mono-tabular text-[11px] text-zinc-900 placeholder:text-zinc-400 focus:border-[#1B6EF3] focus:outline-none dark:border-zinc-700 dark:bg-[#181A20] dark:text-zinc-100"
              />
              <button
                type="submit"
                disabled={!sidebarBindInput.trim()}
                className="min-h-[34px] shrink-0 rounded-xl bg-zinc-950 px-2.5 text-[11px] font-medium text-white disabled:opacity-40 dark:bg-[#1B6EF3]"
              >
                接入
              </button>
            </form>
          )}

          {sessions.length > 3 && (
            <div className="relative mt-2">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
              <input
                type="text"
                value={sidebarSearch}
                onChange={(e) => setSidebarSearch(e.target.value)}
                placeholder="搜索会话…"
                className="min-h-[34px] w-full rounded-xl border border-stone-200/80 bg-white/80 py-1 pr-2.5 pl-8 text-xs text-zinc-800 placeholder:text-zinc-400 focus:border-[#1B6EF3] focus:bg-white focus:outline-none dark:border-zinc-800 dark:bg-[#181A20] dark:text-zinc-100"
              />
            </div>
          )}

          <div className="mt-2 flex-1 overflow-y-auto space-y-0.5 pb-3">
            {filteredSidebarSessions.map((s) => {
              const isActive = s.id === activeSession.id && activeTab === 'chat';
              const isRenaming = renamingSessionId === s.id;

              return (
                <div
                  key={s.id}
                  className={`group flex items-center justify-between gap-1.5 rounded-xl px-2.5 py-2 transition-colors ${
                    isActive
                      ? 'bg-white text-zinc-950 shadow-xs dark:bg-[#1C1F26] dark:text-zinc-50'
                      : 'text-zinc-600 hover:bg-stone-200/55 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/50 dark:hover:text-zinc-100'
                  }`}
                >
                  {isRenaming ? (
                    <div className="flex min-w-0 flex-1 items-center gap-1">
                      <input
                        type="text"
                        autoFocus
                        value={renameDraft}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleRenameSession(s.id, renameDraft);
                          if (e.key === 'Escape') setRenamingSessionId(null);
                        }}
                        onBlur={() => handleRenameSession(s.id, renameDraft)}
                        className="min-w-0 flex-1 rounded-lg border border-[#1B6EF3] bg-[#F8F7F4] px-2 py-0.5 text-xs text-zinc-900 focus:outline-none dark:bg-[#0E0F12] dark:text-zinc-100"
                      />
                      <button
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          handleRenameSession(s.id, renameDraft);
                        }}
                        aria-label="保存名称"
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#1B6EF3] text-white"
                      >
                        <Check className="h-3 w-3" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => void handleSelectSession(s.id)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="truncate text-xs font-medium">{s.title}</div>
                        <div className="mt-0.5 font-mono-tabular text-[10px] text-zinc-400">
                          {s.source === 'remote' ? '云端' : '本地'} · {s.updatedAt}
                        </div>
                      </button>

                      <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setRenamingSessionId(s.id);
                            setRenameDraft(s.title);
                          }}
                          aria-label="重命名会话"
                          className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-400 hover:bg-stone-200/80 hover:text-zinc-800 dark:hover:bg-zinc-700 dark:hover:text-zinc-100"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                        {sessions.length > 1 && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteSession(s.id);
                            }}
                            aria-label="删除会话"
                            className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-400 hover:bg-stone-200/80 hover:text-rose-600 dark:hover:bg-zinc-700 dark:hover:text-rose-400"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Bottom Utility Dock */}
        <div className="space-y-2 border-t border-stone-200/70 p-3 dark:border-zinc-800/70">
          <button
            type="button"
            onClick={() => setConnectionOpen(true)}
            className="flex min-h-[40px] w-full items-center gap-2.5 rounded-2xl border border-stone-200/90 bg-white px-3 py-2 text-xs font-medium text-zinc-700 transition-colors hover:border-stone-300 dark:border-zinc-800 dark:bg-[#181A20] dark:text-zinc-300 dark:hover:border-zinc-700"
          >
            <Link2 className="h-3.5 w-3.5 text-[#1B6EF3] dark:text-blue-400 shrink-0" />
            <span className="truncate">
              {config.mode === 'sandbox' ? '连接配置 · 体验模式' : 'Tailscale 云端通道'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setDarkMode((prev) => !prev)}
            className="flex min-h-[38px] w-full items-center justify-center gap-2 rounded-2xl px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-stone-200/60 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100 whitespace-nowrap"
          >
            {darkMode ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            <span>{darkMode ? '切换浅色外观' : '切换深色外观'}</span>
          </button>

          <PWAInstallButton />
        </div>
      </aside>

      {/* Mobile Compact Top Header (52px) */}
      <header className="flex h-[52px] shrink-0 items-center justify-between border-b border-stone-200/80 bg-[#F8F7F4]/95 px-4 backdrop-blur-md dark:border-zinc-800/80 dark:bg-[#0E0F12]/95 lg:hidden">
        <div className="flex items-center gap-2.5">
          <img
            src={museAvatar}
            alt="Relay"
            className="h-7 w-7 rounded-full object-cover ring-1 ring-stone-200 dark:ring-zinc-700"
          />
          <span className="text-base font-semibold tracking-tight text-zinc-950 dark:text-zinc-50 whitespace-nowrap shrink-0">
            Relay
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setDarkMode((prev) => !prev)}
            aria-label="切换深浅色主题"
            className="flex h-10 w-10 items-center justify-center rounded-xl text-zinc-600 hover:bg-stone-200/60 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={() => setConnectionOpen(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-zinc-950 px-3 text-xs font-medium text-white dark:bg-[#1B6EF3] whitespace-nowrap shrink-0"
          >
            <Link2 className="h-3.5 w-3.5" />
            <span>连接</span>
          </button>
        </div>
      </header>

      {/* Spacious Center Stage (No Cramped Right Sidebar) */}
      <main className="min-h-0 flex-1 overflow-y-auto">
        {activeTab === 'chat' && (
          <div className="h-full pb-[60px] lg:pb-0">
            <ChatView
              messages={messages}
              sessions={sessions}
              activeSession={activeSession}
              isLoadingSessions={isLoadingSessions}
              isLoadingHistory={isLoadingHistory}
              config={config}
              isStreaming={isStreaming}
              onSendMessage={handleSendMessage}
              onStopStreaming={handleStopStreaming}
              onNewSession={handleNewSession}
              onSelectSession={handleSelectSession}
              onDeleteSession={handleDeleteSession}
              onRefreshSessions={() => void handleRefreshSessions(false)}
              onBindSessionId={(id) => void handleBindSessionId(id)}
              onOpenConnection={() => setConnectionOpen(true)}
              onToggleSaveBriefing={handleToggleSaveBriefing}
              onOpenBriefing={(item) => {
                setSelectedBriefing(item);
                setActiveTab('space');
              }}
              onAskAboutBriefing={handleAskAboutBriefing}
              onToggleReminder={(item) => handleToggleReminderById(item.id)}
              onSnoozeReminder={(item) => handleSnoozeReminderById(item.id)}
              onSyncReminder={handleSyncReminderFromCard}
              onResolveApproval={handleResolveApproval}
              onPreviewFile={(file) => {
                setPreviewFile(file);
                setActiveTab('space');
              }}
              onAskAboutFile={handleAskAboutFile}
              onShowToast={showToast}
            />
          </div>
        )}

        {activeTab === 'goals' && (
          <GoalsView
            goals={goals}
            reminders={reminders}
            config={config}
            onAddGoal={handleAddGoal}
            onToggleMilestone={handleToggleMilestone}
            onDeleteGoal={handleDeleteGoal}
            onDelegateGoal={handleDelegateGoal}
            onAddReminder={handleAddReminder}
            onToggleReminder={handleToggleReminderById}
            onSnoozeReminder={handleSnoozeReminderById}
            onDeleteReminder={handleDeleteReminder}
            onShowToast={showToast}
          />
        )}

        {activeTab === 'space' && (
          <SpaceView
            config={config}
            nodes={nodes}
            macros={QUICK_MACROS}
            files={files}
            briefings={briefings}
            selectedBriefing={selectedBriefing}
            previewFile={previewFile}
            isFetchingDigest={isFetchingDigest}
            onOpenConnection={() => setConnectionOpen(true)}
            onUpdateNodeIp={handleUpdateNodeIp}
            onRunMacro={handleRunMacro}
            onUploadLocalFile={handleUploadLocalFile}
            onAskAboutFile={handleAskAboutFile}
            onSelectPreviewFile={setPreviewFile}
            onFetchFreshDigest={handleFetchFreshDigest}
            onToggleSaveBriefing={handleToggleSaveBriefing}
            onSelectBriefing={setSelectedBriefing}
            onAskAboutBriefing={handleAskAboutBriefing}
          />
        )}
      </main>

      {/* Mobile Fixed 3-Pillar Bottom Tab Bar (60px, Thumb Zone Ergonomics) */}
      <nav
        aria-label="主导航"
        className="fixed bottom-0 left-0 right-0 z-40 grid h-[60px] grid-cols-3 items-center border-t border-stone-200/90 bg-[#F8F7F4]/95 pb-safe backdrop-blur-md dark:border-zinc-800/90 dark:bg-[#0E0F12]/95 lg:hidden"
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
                  ? 'text-[#1B6EF3] dark:text-blue-400'
                  : 'text-zinc-500 dark:text-zinc-400'
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
          if (next.sessionId?.trim()) {
            void handleBindSessionId(next.sessionId.trim());
          }
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
          className="fixed top-16 left-1/2 z-50 -translate-x-1/2 rounded-2xl bg-zinc-950 px-4 py-2.5 text-xs font-medium text-white shadow-lg dark:bg-zinc-100 dark:text-zinc-950 lg:top-5 whitespace-nowrap"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
