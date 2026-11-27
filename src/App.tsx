/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Check,
  Compass,
  FlaskConical,
  Hash,
  HeartPulse,
  Menu,
  MessageSquare,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Target,
  Trash2,
  X,
} from 'lucide-react';
import {
  DEFAULT_CONNECTION_CONFIG,
  INITIAL_MESH_NODES,
  QUICK_MACROS,
} from './data/initialData';
import type {
  AgentProfile,
  BriefingItem,
  ChatAttachment,
  ChatMessage,
  ConnectionConfig,
  DeviceActionItem,
  DeviceContextConfig,
  GoalItem,
  HealthConfig,
  HealthDailyLog,
  InteractiveCard,
  MapCardItem,
  MeshFileItem,
  MeshNode,
  QuickMacro,
  ReminderItem,
  ResearchItem,
  SessionRecord,
  TabKey,
} from './types/relay';
import { streamAgentReply } from './services/agentClient';
import { buildFiveCardsShowcase } from './services/cardProtocol';
import {
  listDshSessions,
  loadDshSessionHistory,
  resetDshSession,
} from './services/dshMuxClient';
import { ChatView } from './components/ChatView';
import { GoalsView } from './components/GoalsView';
import { SpaceView } from './components/SpaceView';
import { ResearchView } from './components/ResearchView';
import { HealthView } from './components/HealthView';
import { GranularDotMatrix } from './components/GranularDotMatrix';
import { ConnectionSheet } from './components/ConnectionSheet';
import { SettingsModal } from './components/SettingsModal';
import { OfflineIndicator, PWAInstallButton } from './components/PWAComponents';
import { registerAndroidBackHandler, syncNativeStatusBar } from './services/nativeApp';
import { applyThemeTunerToDocument, loadThemeTunerSettings } from './services/themeTuner';
import { DEFAULT_AGENT_PROFILE, resolveAvatarSrc } from './services/avatarPresets';
import {
  buildAutoContextHeader,
  DEFAULT_DEVICE_CONTEXT_CONFIG,
  executeDeviceAction,
} from './services/deviceBridge';

const STORAGE_KEYS = {
  config: 'relay_connection_config_v2',
  profile: 'relay_agent_profile_v1',
  sessions: 'relay_sessions_v1',
  activeSessionId: 'relay_active_session_v1',
  briefings: 'relay_briefings_v2',
  reminders: 'relay_reminders_v2',
  goals: 'relay_goals_v1',
  research: 'relay_research_v1',
  healthConfig: 'relay_health_config_v1',
  healthLog: 'relay_health_log_v1',
  deviceContext: 'relay_device_context_v1',
  nodes: 'relay_mesh_nodes_v2',
  theme: 'relay_theme_v1',
};

const DEBUG_CLEANUP_FLAG = 'relay_debug_cleared_v1';

// One-time cleanup of earlier UI debug/test items (reading entries, reminders, goals, briefings)
try {
  if (typeof window !== 'undefined' && !localStorage.getItem(DEBUG_CLEANUP_FLAG)) {
    [
      STORAGE_KEYS.research,
      STORAGE_KEYS.goals,
      STORAGE_KEYS.reminders,
      STORAGE_KEYS.briefings,
      'relay_research_priority_v1',
      'relay_goal_priority_v1',
    ].forEach((k) => localStorage.removeItem(k));
    localStorage.setItem(DEBUG_CLEANUP_FLAG, '1');
  }
} catch {
  // ignore storage access errors
}

const DEFAULT_HEALTH_CONFIG: HealthConfig = {
  sleepGoalHours: 7.5,
  bedtimeTarget: '23:30',
  wakeTarget: '07:00',
  stepsGoal: 8000,
  waterGoalCups: 8,
  exerciseGoalMinutes: 30,
  autoRemindBedtime: true,
};

function todayDateKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function createEmptyTodayLog(): HealthDailyLog {
  return {
    dateKey: todayDateKey(),
    sleepHours: 7.0,
    steps: 0,
    waterCups: 0,
    exerciseMinutes: 0,
  };
}

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
    return true;
  });

  const [agentProfile, setAgentProfile] = useState<AgentProfile>(() =>
    loadFromStorage(STORAGE_KEYS.profile, DEFAULT_AGENT_PROFILE)
  );

  const [config, setConfig] = useState<ConnectionConfig>(() =>
    loadFromStorage(STORAGE_KEYS.config, DEFAULT_CONNECTION_CONFIG)
  );

  const [sessions, setSessions] = useState<SessionRecord[]>(() => {
    const saved = loadFromStorage<SessionRecord[]>(STORAGE_KEYS.sessions, []);
    if (saved.length > 0) return saved;
    const initialCfg = loadFromStorage(STORAGE_KEYS.config, DEFAULT_CONNECTION_CONFIG);
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

  const [researchItems, setResearchItems] = useState<ResearchItem[]>(() =>
    loadFromStorage(STORAGE_KEYS.research, [])
  );

  const [healthConfig, setHealthConfig] = useState<HealthConfig>(() =>
    loadFromStorage(STORAGE_KEYS.healthConfig, DEFAULT_HEALTH_CONFIG)
  );

  const [healthLog, setHealthLog] = useState<HealthDailyLog>(() => {
    const saved = loadFromStorage<HealthDailyLog | null>(STORAGE_KEYS.healthLog, null);
    if (saved && saved.dateKey === todayDateKey()) return saved;
    return createEmptyTodayLog();
  });

  const [briefings, setBriefings] = useState<BriefingItem[]>(() =>
    loadFromStorage(STORAGE_KEYS.briefings, [])
  );

  const [reminders, setReminders] = useState<ReminderItem[]>(() =>
    loadFromStorage(STORAGE_KEYS.reminders, [])
  );

  const [nodes, setNodes] = useState<MeshNode[]>(() => {
    const saved = loadFromStorage<MeshNode[] | null>(STORAGE_KEYS.nodes, null);
    if (!saved || saved.length === 0) return INITIAL_MESH_NODES;
    const savedPc = saved.find((n) => n.id === 'node-pc' || n.role === 'pc');
    const needsMigration = saved.some(
      (n) =>
        !n.transport ||
        (n.role === 'android' && /^100\./.test(n.tailscaleIp)) ||
        (n.role === 'cloud' && /Tailscale HTTPS/i.test(n.activeService))
    );
    if (!needsMigration) return saved;
    return INITIAL_MESH_NODES.map((base) => {
      if (base.role === 'pc' && savedPc?.tailscaleIp) {
        return { ...base, tailscaleIp: savedPc.tailscaleIp };
      }
      return base;
    });
  });

  const [files, setFiles] = useState<MeshFileItem[]>([]);

  const [deviceContextConfig, setDeviceContextConfig] = useState<DeviceContextConfig>(() =>
    loadFromStorage(STORAGE_KEYS.deviceContext, DEFAULT_DEVICE_CONTEXT_CONFIG)
  );
  const [spaceSubTab, setSpaceSubTab] = useState<'device' | 'environment' | 'library'>('device');

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [selectedBriefing, setSelectedBriefing] = useState<BriefingItem | null>(null);
  const [previewFile, setPreviewFile] = useState<MeshFileItem | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isFetchingDigest, setIsFetchingDigest] = useState(false);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Sidebar session helpers
  const [sidebarSearch, setSidebarSearch] = useState('');
  const [showSidebarBind, setShowSidebarBind] = useState(false);
  const [sidebarBindInput, setSidebarBindInput] = useState('');
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  const abortRef = useRef<AbortController | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const avatarSrc = resolveAvatarSrc(agentProfile);

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
    applyThemeTunerToDocument(loadThemeTunerSettings());
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    localStorage.setItem(STORAGE_KEYS.theme, JSON.stringify(darkMode ? 'dark' : 'light'));
    void syncNativeStatusBar(darkMode);
  }, [darkMode]);

  useEffect(() => {
    return registerAndroidBackHandler(() => {
      if (drawerOpen) {
        setDrawerOpen(false);
        return true;
      }
      if (settingsOpen) {
        setSettingsOpen(false);
        return true;
      }
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
  }, [drawerOpen, settingsOpen, connectionOpen, selectedBriefing, previewFile, activeTab]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.profile, JSON.stringify(agentProfile));
  }, [agentProfile]);

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
    localStorage.setItem(STORAGE_KEYS.research, JSON.stringify(researchItems));
  }, [researchItems]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.healthConfig, JSON.stringify(healthConfig));
  }, [healthConfig]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.healthLog, JSON.stringify(healthLog));
  }, [healthLog]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.briefings, JSON.stringify(briefings));
  }, [briefings]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.reminders, JSON.stringify(reminders));
  }, [reminders]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.nodes, JSON.stringify(nodes));
  }, [nodes]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.deviceContext, JSON.stringify(deviceContextConfig));
  }, [deviceContextConfig]);

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
    setDrawerOpen(false);

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
    setDrawerOpen(false);
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
    setDrawerOpen(false);
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
      let promptToSend = text;
      if (config.mode !== 'sandbox') {
        const autoHeader = await buildAutoContextHeader(deviceContextConfig);
        if (autoHeader) {
          promptToSend = `${autoHeader}${text}`;
        }
      }

      await streamAgentReply(
        promptToSend,
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

  // Research handlers
  const handleAddResearch = (item: Omit<ResearchItem, 'id' | 'updatedAt'>) => {
    setResearchItems((prev) => [
      { ...item, id: `res-${Date.now()}`, updatedAt: todayDateKey() },
      ...prev,
    ]);
  };

  const handleUpdateResearchProgress = (id: string, progress: number) => {
    setResearchItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, progress, updatedAt: todayDateKey() } : i))
    );
  };

  const handleUpdateResearchStatus = (id: string, status: ResearchItem['status']) => {
    setResearchItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, status, updatedAt: todayDateKey() } : i))
    );
  };

  const handleUpdateResearchItem = (
    id: string,
    patch: Partial<Pick<ResearchItem, 'title' | 'venueOrSource' | 'url' | 'notes' | 'category'>>
  ) => {
    setResearchItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, ...patch, updatedAt: todayDateKey() } : i))
    );
  };

  const handleDeleteResearch = (id: string) => {
    setResearchItems((prev) => prev.filter((i) => i.id !== id));
    showToast('已删除该科研记录');
  };

  const handleAskAboutResearch = (item: ResearchItem) => {
    const prompt = [
      `请帮我推进这条科研记录：「${item.title}」`,
      item.venueOrSource ? `来源/出处：${item.venueOrSource}` : '',
      `当前进度：${item.progress}%`,
      item.url ? `参考链接：${item.url}` : '',
      item.notes ? `已有笔记：\n${item.notes}` : '',
      '请帮我提炼关键要点，并给出下一步最值得验证的实验或阅读建议。',
    ]
      .filter(Boolean)
      .join('\n');
    setActiveTab('chat');
    void handleSendMessage(prompt);
  };

  // Health handlers
  const handleScheduleBedtimeReminder = () => {
    const title = `准备入睡（目标 ${healthConfig.sleepGoalHours}h 睡眠，${healthConfig.wakeTarget} 起床）`;
    setReminders((prev) => [
      {
        id: `rem-sleep-${Date.now()}`,
        title,
        dueLabel: `今天 ${healthConfig.bedtimeTarget}`,
        dayGroup: 'today',
        repeat: '每天',
        priority: 'high',
        channel: 'ntfy',
        completed: false,
      },
      ...prev,
    ]);
    showToast(`已生成 ${healthConfig.bedtimeTarget} 就寝提醒`);
  };

  const handleAskAgentHealthCheck = () => {
    const prompt = [
      `这是我今天的健康作息数据（${healthLog.dateKey}）：`,
      `- 昨晚睡眠：${healthLog.sleepHours.toFixed(1)} 小时（目标 ${healthConfig.sleepGoalHours} 小时，理想入睡 ${healthConfig.bedtimeTarget} / 起床 ${healthConfig.wakeTarget}）`,
      `- 今日步数：${healthLog.steps.toLocaleString()} 步（目标 ${healthConfig.stepsGoal.toLocaleString()} 步）`,
      `- 饮水打卡：${healthLog.waterCups} / ${healthConfig.waterGoalCups} 杯`,
      `- 活动运动：${healthLog.exerciseMinutes} / ${healthConfig.exerciseGoalMinutes} 分钟`,
      '请帮我记录并在云端安排今晚的就寝与步数达标提醒，顺便给我一条简短的作息调整建议。',
    ].join('\n');
    setActiveTab('chat');
    void handleSendMessage(prompt);
  };

  // Goals handlers
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

  // Approval card handler
  const handleResolveApproval = (actionId: string, decision: 'approved' | 'rejected') => {
    const action = messages
      .flatMap((m) => m.cards ?? [])
      .find(
        (c): c is Extract<InteractiveCard, { type: 'approval' }> =>
          c.type === 'approval' && c.data.id === actionId
      );
    const isPcTarget = Boolean(
      action?.data.targetDevice && /pc|电脑|workstation|mac|windows/i.test(action.data.targetDevice)
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
                      ? isPcTarget
                        ? '指令已通过云端 → Tailscale 下发至电脑执行'
                        : '指令已通过 Cloudflare Tunnel 下发执行'
                      : undefined,
                },
              }
            : c
        ),
      }))
    );
    showToast(
      decision === 'approved'
        ? isPcTarget
          ? '已批准并通过云端 → Tailscale 下发至电脑'
          : '已批准并通过 Cloudflare Tunnel 下发执行'
        : '已拒绝该操作'
    );
    if (decision === 'approved' && action) {
      void handleSendMessage(
        `已批准执行：${action.data.targetDevice} · ${action.data.commandPreview}。请在云端确认${
          isPcTarget ? '并通过 Tailscale 下发给电脑' : ''
        }执行，完成后把结果告诉我。`
      );
    }
  };

  // Native Android device-action card executor (Today-style Agent -> Phone closed loop)
  const handleExecuteDeviceAction = async (action: DeviceActionItem) => {
    try {
      const res = await executeDeviceAction(action);
      updateSessionMessages(activeSession.id, (prev) =>
        prev.map((m) => ({
          ...m,
          cards: m.cards?.map((c) =>
            c.type === 'device-action' && c.data.id === action.id
              ? {
                  ...c,
                  data: {
                    ...c.data,
                    status: 'executed',
                    resultText: res.resultText,
                  },
                }
              : c
          ),
        }))
      );
      showToast(res.resultText);
      if (res.replyToAgent) {
        void handleSendMessage(res.replyToAgent);
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : '手机动作执行失败';
      updateSessionMessages(activeSession.id, (prev) =>
        prev.map((m) => ({
          ...m,
          cards: m.cards?.map((c) =>
            c.type === 'device-action' && c.data.id === action.id
              ? {
                  ...c,
                  data: {
                    ...c.data,
                    status: 'failed',
                    resultText: reason,
                  },
                }
              : c
          ),
        }))
      );
      showToast(reason);
    }
  };

  const handleOpenDeviceHub = () => {
    setSpaceSubTab('device');
    setActiveTab('space');
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

  const handleAskAboutMap = (item: MapCardItem) => {
    setActiveTab('chat');
    void handleSendMessage(
      `关于「${item.title}」（${item.address}），请通过高德地图帮我补充备选路线、当前路况或周边推荐，并用 \`relay-card\` (type: "map") 返回更新后的高德地图交互卡片。`
    );
  };

  const handlePreviewFiveCards = () => {
    setActiveTab('chat');
    const previewMsg: ChatMessage = {
      id: `cards-preview-${Date.now()}`,
      role: 'assistant',
      timestamp: nowTimeString(),
      content:
        '已为你展开全部 5 种交互卡片（高德地图 · 论文简报 · 日程提醒 · 设备文件 · 电脑审批），所有按钮均可以直接点击交互。若想让云端助理在真实对话里自动返回这些卡片，可在卡片面板点「发给助理记住协议」。',
      cards: buildFiveCardsShowcase(),
    };
    updateSessionMessages(activeSession.id, (prev) => [...prev, previewMsg]);
    showToast('已展示全部 5 种交互卡片');
  };

  const pendingGoalsOrReminders =
    reminders.filter((r) => !r.completed && r.dayGroup === 'today').length +
    goals.filter((g) => g.status === 'active').length;

  const sidebarNavItems: {
    key: TabKey;
    label: string;
    Icon: React.ComponentType<{ className?: string }>;
    badge?: number;
    tintVar: string;
    accentVar: string;
  }[] = [
    {
      key: 'chat',
      label: '对话',
      Icon: MessageSquare,
      tintVar: 'var(--tint-blue)',
      accentVar: 'var(--accent-indigo)',
    },
    {
      key: 'research',
      label: '科研',
      Icon: FlaskConical,
      badge: researchItems.filter((r) => r.status !== 'archived').length,
      tintVar: 'var(--tint-violet)',
      accentVar: 'var(--accent-violet)',
    },
    {
      key: 'health',
      label: '健康',
      Icon: HeartPulse,
      tintVar: 'var(--tint-emerald)',
      accentVar: 'var(--accent-mint)',
    },
    {
      key: 'goals',
      label: '目标',
      Icon: Target,
      badge: pendingGoalsOrReminders,
      tintVar: 'var(--tint-red)',
      accentVar: 'var(--accent-coral)',
    },
    {
      key: 'space',
      label: '空间',
      Icon: Compass,
      tintVar: 'var(--tint-cyan)',
      accentVar: 'var(--accent-sky)',
    },
  ];

  const mobileBottomItems = sidebarNavItems.slice(0, 4);

  const activeHeaderTitle =
    activeTab === 'chat'
      ? agentProfile.name
      : activeTab === 'research'
        ? '科研与论文'
        : activeTab === 'health'
          ? '健康与作息'
          : activeTab === 'goals'
            ? '目标与日程'
            : '空间与环境';

  const renderSidebarContent = (isDrawer: boolean) => (
    <div className="flex h-full flex-col">
      {/* Assistant Brand Header + New Chat */}
      <div className="flex items-center justify-between px-4 pt-5 pb-3">
        <button
          type="button"
          onClick={() => {
            if (isDrawer) setDrawerOpen(false);
            setSettingsOpen(true);
          }}
          className="flex min-w-0 items-center gap-2.5 rounded-2xl pr-2 text-left transition-opacity hover:opacity-85"
        >
          <img
            src={avatarSrc}
            alt={agentProfile.name}
            className="h-9 w-9 shrink-0 rounded-full object-cover ring-1 ring-stone-300/70 dark:ring-zinc-700"
          />
          <div className="min-w-0">
            <div className="truncate text-[15px] font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
              {agentProfile.name}
            </div>
            <div className="truncate text-[11px] text-zinc-400">
              {agentProfile.subtitle || '私人 AI 助理'}
            </div>
          </div>
        </button>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={handleNewSession}
            aria-label="新建对话"
            title="新建对话"
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-stone-200/90 bg-white text-zinc-700 transition-colors hover:border-[#1B6EF3]/50 hover:text-[#1B6EF3] dark:border-zinc-800 dark:bg-[#181A20] dark:text-zinc-200 dark:hover:border-blue-500/50 dark:hover:text-blue-400"
          >
            <Plus className="h-4 w-4" />
          </button>
          {isDrawer && (
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              aria-label="关闭侧边栏"
              className="flex h-9 w-9 items-center justify-center rounded-xl text-zinc-500 hover:bg-stone-200/60 dark:hover:bg-zinc-800"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* 5-Pillar Workspace Navigation as Frosted Magnetic Tiles with Transition-Zone Black Squares */}
      <nav className="grid grid-cols-2 gap-3 px-3 pt-1 pb-4">
        {sidebarNavItems.map(({ key, label, Icon, badge, tintVar, accentVar }, navIdx) => {
          const active = activeTab === key;
          const isChat = key === 'chat';
          const navAngles = ['174deg', '162deg', '192deg', '168deg', '186deg'];
          return (
            <button
              key={key}
              type="button"
              onClick={() => {
                setActiveTab(key);
                if (isDrawer) setDrawerOpen(false);
              }}
              style={
                {
                  '--tile-tint': tintVar,
                  '--tile-angle': navAngles[navIdx % navAngles.length],
                } as React.CSSProperties
              }
              className={`settings-grain-tile relative flex items-center justify-between rounded-2xl px-3 py-2.5 text-[13px] font-medium active:scale-[0.97] whitespace-nowrap ${
                isChat ? 'col-span-2 min-h-[48px]' : 'col-span-1 min-h-[46px]'
              } ${
                active
                  ? 'mini-tile-active text-[var(--relay-text)]'
                  : 'text-[var(--relay-text-muted)] hover:text-[var(--relay-text)]'
              }`}
            >
              <GranularDotMatrix pitch={7.5} bandStart={0.44} bandEnd={0.86} />
              <span className="relative z-10 flex items-center gap-2">
                <span style={{ color: active ? accentVar : undefined }}>
                  <Icon className="h-[17px] w-[17px]" />
                </span>
                <span>{label}</span>
              </span>
              {badge !== undefined && badge > 0 && (
                <span className="relative z-10 font-mono-tabular text-[11px] text-[var(--relay-text-muted)]">
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Embedded Session History Slot (Container is flush; each session entry is a frosted magnetic tile) */}
      <div className="flex min-h-0 flex-1 flex-col border-t border-[var(--relay-tile-border)]/45 px-3 pt-3">
        <div className="flex items-center justify-between px-1">
          <span className="text-[11px] font-semibold tracking-wide text-[var(--relay-text-muted)]">
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
                      ? 'bg-white/15 text-[var(--accent-indigo)]'
                      : 'text-[var(--relay-text-muted)] hover:bg-white/10 hover:text-[var(--relay-text)]'
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
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--relay-text-muted)] transition-colors hover:bg-white/10 hover:text-[var(--accent-indigo)] disabled:opacity-50"
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
              className="min-h-[34px] min-w-0 flex-1 rounded-xl border border-white/15 bg-black/25 px-2.5 font-mono-tabular text-[11px] text-[var(--relay-text)] placeholder:text-[var(--relay-text-faint)] focus:border-white/40 focus:outline-none"
            />
            <button
              type="submit"
              disabled={!sidebarBindInput.trim()}
              className="min-h-[34px] shrink-0 rounded-xl bg-white px-2.5 text-[11px] font-semibold text-[#0D1017] disabled:opacity-40"
            >
              接入
            </button>
          </form>
        )}

        {sessions.length > 3 && (
          <div className="relative mt-2">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-[var(--relay-text-faint)]" />
            <input
              type="text"
              value={sidebarSearch}
              onChange={(e) => setSidebarSearch(e.target.value)}
              placeholder="搜索会话…"
              className="min-h-[34px] w-full rounded-xl border border-white/12 bg-black/25 py-1 pr-2.5 pl-8 text-xs text-[var(--relay-text)] placeholder:text-[var(--relay-text-faint)] focus:border-white/35 focus:outline-none"
            />
          </div>
        )}

        {/* Recessed Embedded Session Scroll Slot containing Transition-Square Session Tiles */}
        <div className="mt-2.5 flex-1 overflow-y-auto space-y-3 pb-4 pr-0.5">
          {filteredSidebarSessions.map((s, idx) => {
            const isActive = s.id === activeSession.id && activeTab === 'chat';
            const isRenaming = renamingSessionId === s.id;
            const sessionTints = [
              'var(--tint-cyan)',
              'var(--tint-teal)',
              'var(--tint-violet)',
              'var(--tint-blue)',
              'var(--tint-emerald)',
              'var(--tint-rose)',
            ];
            const sessionAngles = ['166deg', '184deg', '172deg', '192deg', '160deg'];

            return (
              <div
                key={s.id}
                style={
                  {
                    '--tile-tint': isActive
                      ? 'var(--tint-blue)'
                      : sessionTints[idx % sessionTints.length],
                    '--tile-angle': sessionAngles[idx % sessionAngles.length],
                  } as React.CSSProperties
                }
                className={`settings-grain-tile group flex items-center justify-between gap-1.5 rounded-2xl px-3 py-2.5 ${
                  isActive
                    ? 'mini-tile-active text-[var(--relay-text)]'
                    : 'text-[var(--relay-text-muted)] hover:text-[var(--relay-text)]'
                }`}
              >
                <GranularDotMatrix pitch={7.5} bandStart={0.44} bandEnd={0.86} />
                {isRenaming ? (
                  <div className="relative z-10 flex min-w-0 flex-1 items-center gap-1">
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
                      className="min-w-0 flex-1 rounded-lg border border-white/40 bg-black/35 px-2 py-0.5 text-xs text-[var(--relay-text)] focus:outline-none"
                    />
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        handleRenameSession(s.id, renameDraft);
                      }}
                      aria-label="保存名称"
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white text-[#0D1017]"
                    >
                      <Check className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => void handleSelectSession(s.id)}
                      className="relative z-10 min-w-0 flex-1 text-left"
                    >
                      <div className="truncate text-xs font-medium text-[var(--relay-text)]">
                        {s.title}
                      </div>
                      <div className="mt-0.5 font-mono-tabular text-[10px] text-[var(--relay-text-faint)]">
                        {s.source === 'remote' ? '云端' : '本地'} · {s.updatedAt}
                      </div>
                    </button>

                    <div className="relative z-10 flex items-center gap-0.5 opacity-70 sm:opacity-0 transition-opacity sm:group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setRenamingSessionId(s.id);
                          setRenameDraft(s.title);
                        }}
                        aria-label="重命名会话"
                        className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--relay-text-muted)] hover:bg-white/10 hover:text-[var(--relay-text)]"
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
                          className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--relay-text-muted)] hover:bg-white/10 hover:text-[var(--accent-coral)]"
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

      {/* Unified Settings Dock as Granular Halftone Magnetic Tile */}
      <div className="space-y-2 border-t border-[var(--relay-tile-border)]/45 p-3">
        <button
          type="button"
          onClick={() => {
            if (isDrawer) setDrawerOpen(false);
            setSettingsOpen(true);
          }}
          style={
            {
              '--tile-tint': 'var(--tint-violet)',
              '--tile-angle': '176deg',
            } as React.CSSProperties
          }
          className="settings-grain-tile flex min-h-[50px] w-full items-center justify-between gap-2.5 rounded-2xl px-3.5 py-2 text-xs font-medium text-[var(--relay-text)] active:scale-[0.98]"
        >
          <GranularDotMatrix pitch={8.5} />
          <span className="relative z-10 flex items-center gap-2.5">
            <Settings className="h-4 w-4 text-[var(--accent-violet)] shrink-0" />
            <span>设置</span>
          </span>
          <span className="relative z-10 text-[11px] text-[var(--relay-text-muted)]">
            头像 · 外观 · 连接
          </span>
        </button>

        <PWAInstallButton />
      </div>
    </div>
  );

  return (
    <div className="board-backdrop flex h-dvh flex-col overflow-hidden text-[var(--relay-text)] lg:flex-row">
      {/* Desktop Left Sidebar */}
      <aside className="hidden lg:flex lg:w-[276px] lg:shrink-0 lg:flex-col border-r border-[var(--relay-tile-border)]/50 bg-[var(--relay-sidebar)]/85 backdrop-blur-xl">
        {renderSidebarContent(false)}
      </aside>

      {/* Mobile Slide-Out Frosted Sidebar Drawer */}
      <AnimatePresence>
        {drawerOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-50 flex bg-black/45 backdrop-blur-xs lg:hidden"
            onClick={() => setDrawerOpen(false)}
          >
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', stiffness: 380, damping: 36 }}
              onClick={(e) => e.stopPropagation()}
              className="h-full w-[82vw] max-w-[304px] border-r border-[var(--relay-tile-border)] bg-[var(--relay-sidebar)]/95 backdrop-blur-xl shadow-2xl"
            >
              {renderSidebarContent(true)}
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mobile Ultra-Clean Top Header (52px) */}
      <header className="flex h-[52px] shrink-0 items-center justify-between border-b border-[var(--relay-tile-border)] bg-[var(--relay-bg)]/95 px-3 backdrop-blur-md lg:hidden">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="打开侧边栏"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-zinc-700 transition-colors active:scale-95 hover:bg-stone-200/60 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <Menu className="h-5 w-5" />
          </button>
          <img
            src={avatarSrc}
            alt={agentProfile.name}
            className="h-7 w-7 shrink-0 rounded-full object-cover ring-1 ring-stone-200 dark:ring-zinc-700"
          />
          <span className="truncate text-[15px] font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            {activeHeaderTitle}
          </span>
        </div>

        <button
          type="button"
          onClick={handleNewSession}
          aria-label="新建对话"
          className="inline-flex h-9 items-center gap-1 rounded-xl px-2.5 text-xs font-medium text-zinc-700 transition-colors active:scale-95 hover:bg-stone-200/60 dark:text-zinc-200 dark:hover:bg-zinc-800 shrink-0"
        >
          <Plus className="h-4 w-4" />
          <span>新对话</span>
        </button>
      </header>

      {/* Animated Center Stage */}
      <main className="min-h-0 flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="h-full overflow-y-auto"
          >
            {activeTab === 'chat' && (
              <div className="h-full">
                <ChatView
                  messages={messages}
                  sessions={sessions}
                  activeSession={activeSession}
                  agentProfile={agentProfile}
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
                  onOpenSettings={() => setSettingsOpen(true)}
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
                  onExecuteDeviceAction={(act) => void handleExecuteDeviceAction(act)}
                  onOpenDeviceHub={handleOpenDeviceHub}
                  onPreviewFile={(file) => {
                    setPreviewFile(file);
                    setSpaceSubTab('library');
                    setActiveTab('space');
                  }}
                  onAskAboutFile={handleAskAboutFile}
                  onAskAboutMap={handleAskAboutMap}
                  onPreviewFiveCards={handlePreviewFiveCards}
                  onShowToast={showToast}
                />
              </div>
            )}

            {activeTab === 'research' && (
              <ResearchView
                items={researchItems}
                onAddItem={handleAddResearch}
                onUpdateProgress={handleUpdateResearchProgress}
                onUpdateStatus={handleUpdateResearchStatus}
                onUpdateItem={handleUpdateResearchItem}
                onReorderItems={setResearchItems}
                onDeleteItem={handleDeleteResearch}
                onAskAgent={handleAskAboutResearch}
                onShowToast={showToast}
              />
            )}

            {activeTab === 'health' && (
              <HealthView
                healthConfig={healthConfig}
                todayLog={healthLog}
                onUpdateConfig={setHealthConfig}
                onUpdateTodayLog={setHealthLog}
                onScheduleBedtimeReminder={handleScheduleBedtimeReminder}
                onAskAgentHealthCheck={handleAskAgentHealthCheck}
              />
            )}

            {activeTab === 'goals' && (
              <GoalsView
                goals={goals}
                reminders={reminders}
                config={config}
                onAddGoal={handleAddGoal}
                onToggleMilestone={handleToggleMilestone}
                onReorderGoals={setGoals}
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
                initialSubTab={spaceSubTab}
                deviceContextConfig={deviceContextConfig}
                nodes={nodes}
                macros={QUICK_MACROS}
                files={files}
                briefings={briefings}
                selectedBriefing={selectedBriefing}
                previewFile={previewFile}
                isFetchingDigest={isFetchingDigest}
                onUpdateDeviceContextConfig={setDeviceContextConfig}
                onSendContextToAgent={(promptText) => {
                  setActiveTab('chat');
                  void handleSendMessage(promptText);
                }}
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
                onShowToast={showToast}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Mobile Bottom Tab Bar (Flex-flow so Android insets & keyboard never overlap!) */}
      <nav
        aria-label="主导航"
        className="shrink-0 grid h-[62px] grid-cols-4 items-center gap-1 border-t border-[var(--relay-tile-border)] bg-[var(--relay-bg)]/95 px-2 backdrop-blur-md lg:hidden"
      >
        {mobileBottomItems.map(({ key, label, Icon }) => {
          const active = activeTab === key;
          return (
            <motion.button
              key={key}
              type="button"
              whileTap={{ scale: 0.92 }}
              onClick={() => setActiveTab(key)}
              className={`relative flex h-[48px] flex-col items-center justify-center gap-0.5 rounded-2xl transition-colors ${
                active
                  ? 'text-[var(--accent-indigo)]'
                  : 'text-[var(--relay-text-muted)]'
              }`}
            >
              {active && (
                <motion.span
                  layoutId="mobile-tab-pill"
                  transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                  className="absolute inset-0 rounded-2xl border border-[var(--relay-tile-border)] bg-[var(--relay-tile)] shadow-xs"
                />
              )}
              <Icon className="relative z-10 h-[19px] w-[19px]" />
              <span className="relative z-10 text-[11px] font-medium tracking-tight whitespace-nowrap">
                {label}
              </span>
            </motion.button>
          );
        })}
      </nav>

      {/* Unified Sidebar Settings Modal (Avatar/Name, Theme, Connection) */}
      <SettingsModal
        open={settingsOpen}
        profile={agentProfile}
        darkMode={darkMode}
        config={config}
        onClose={() => setSettingsOpen(false)}
        onUpdateProfile={setAgentProfile}
        onToggleDarkMode={setDarkMode}
        onOpenConnection={() => setConnectionOpen(true)}
        onOpenDeviceHub={handleOpenDeviceHub}
        onShowToast={showToast}
      />

      {/* Connection & DeepSeek Harness Configuration Bottom Sheet */}
      <ConnectionSheet
        open={connectionOpen}
        config={config}
        onClose={() => setConnectionOpen(false)}
        onSendProtocolToAgent={(promptText) => {
          setActiveTab('chat');
          void handleSendMessage(promptText);
        }}
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
      <AnimatePresence>
        {toast && (
          <motion.div
            role="status"
            initial={{ opacity: 0, y: -12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 420, damping: 30 }}
            className="fixed top-16 left-1/2 z-50 -translate-x-1/2 rounded-2xl bg-zinc-950/95 px-4 py-2.5 text-xs font-medium text-white shadow-lg backdrop-blur-md dark:bg-zinc-100/95 dark:text-zinc-950 lg:top-5 whitespace-nowrap"
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
