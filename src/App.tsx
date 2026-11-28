/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Check,
  Hash,
  Pencil,
  Search,
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
import { InPlaceVoiceDock } from './components/InPlaceVoiceDock';
import {
  LibraryFloatingPopover,
  type LibraryPopoverDestination,
} from './components/LibraryFloatingPopover';
import { ConnectionSheet } from './components/ConnectionSheet';
import { SettingsModal } from './components/SettingsModal';
import { OfflineIndicator, PWAInstallButton } from './components/PWAComponents';
import {
  ArrowsClockwise,
  NavChatIcon,
  NavFeedsIcon,
  NavGoalsIcon,
  NavHealthIcon,
  NavLibraryIcon,
  NavSettingsIcon,
  Plus,
  Trash,
} from './components/AppIcons';
import { registerAndroidBackHandler, syncNativeStatusBar } from './services/nativeApp';
import { DEFAULT_AGENT_PROFILE, resolveAvatarSrc } from './services/avatarPresets';
import { startVoiceRecognition, type SpeechSessionHandle } from './services/nativeSpeech';
import {
  buildAutoContextHeader,
  DEFAULT_DEVICE_CONTEXT_CONFIG,
  executeDeviceAction,
} from './services/deviceBridge';
import {
  applyAgentUpdatesToAppState,
  buildAppStateContextHeader,
  buildManualAppStateSyncPrompt,
  formatSyncToast,
} from './services/agentSyncProtocol';

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
  theme: 'relay_theme_v2',
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
        sizeBytes: att.sizeBytes,
        mimeType: att.mimeType,
        dataUrl:
          att.dataUrl && !att.dataUrl.startsWith('blob:') && att.dataUrl.length < 180_000
            ? att.dataUrl
            : undefined,
        url: att.url,
        receiptId: att.receiptId,
        sessionId: att.sessionId,
        filePath: att.filePath,
        direction: att.direction,
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
  const [libraryPopoverOpen, setLibraryPopoverOpen] = useState(false);
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

  // In-place voice input state for non-chat screens (Feeds / Goals / Health / Library)
  const [inPlaceListening, setInPlaceListening] = useState(false);
  const [inPlaceTranscribing, setInPlaceTranscribing] = useState(false);
  const [inPlaceTranscript, setInPlaceTranscript] = useState('');
  const [inPlaceSeconds, setInPlaceSeconds] = useState(0);
  const [inPlaceMiniReplyPrompt, setInPlaceMiniReplyPrompt] = useState<string | null>(null);
  const [inPlaceBaselineMsgCount, setInPlaceBaselineMsgCount] = useState<number>(0);

  const abortRef = useRef<AbortController | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const inPlaceSpeechRef = useRef<SpeechSessionHandle | null>(null);
  const inPlaceDiscardRef = useRef<boolean>(false);
  const inPlaceAutoSendRef = useRef<boolean>(false);
  const inPlaceTranscriptRef = useRef<string>('');

  // Live refs for autonomous Agent <-> App sync without stale closures
  const briefingsRef = useRef<BriefingItem[]>(briefings);
  const remindersRef = useRef<ReminderItem[]>(reminders);
  const goalsRef = useRef<GoalItem[]>(goals);
  const healthLogRef = useRef<HealthDailyLog>(healthLog);
  const healthConfigRef = useRef<HealthConfig>(healthConfig);
  const ingestedCardIdsRef = useRef<Set<string>>(
    new Set(loadFromStorage<string[]>('relay_ingested_card_ids_v1', []))
  );

  useEffect(() => {
    briefingsRef.current = briefings;
  }, [briefings]);
  useEffect(() => {
    remindersRef.current = reminders;
  }, [reminders]);
  useEffect(() => {
    goalsRef.current = goals;
  }, [goals]);
  useEffect(() => {
    healthLogRef.current = healthLog;
  }, [healthLog]);
  useEffect(() => {
    healthConfigRef.current = healthConfig;
  }, [healthConfig]);

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
    document.documentElement.classList.toggle('dark', darkMode);
    localStorage.setItem(STORAGE_KEYS.theme, JSON.stringify(darkMode ? 'dark' : 'light'));
    void syncNativeStatusBar(darkMode);
  }, [darkMode]);

  useEffect(() => {
    return registerAndroidBackHandler(() => {
      if (libraryPopoverOpen) {
        setLibraryPopoverOpen(false);
        return true;
      }
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
    inPlaceTranscriptRef.current = inPlaceTranscript;
  }, [inPlaceTranscript]);

  useEffect(() => {
    if (!inPlaceListening) return;
    setInPlaceSeconds(0);
    const id = window.setInterval(() => setInPlaceSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [inPlaceListening]);

  useEffect(() => {
    return () => {
      inPlaceSpeechRef.current?.stop();
    };
  }, []);

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
      if (config.mode !== 'dsh-bridge' || !/^https?:\/\/.+/i.test(config.serverUrl.trim())) return;
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
          showToast('同步云端会话列表失败，请确认 Cloudflare Tunnel 连接正常');
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

  const ingestCardsFromRemoteHistory = (hist: ChatMessage[]) => {
    const unseenCards: InteractiveCard[] = [];
    for (const msg of hist) {
      if (msg.role !== 'assistant' || !msg.cards?.length) continue;
      for (const card of msg.cards) {
        if (card.type === 'briefing' || card.type === 'reminder' || card.type === 'goal') {
          if (!ingestedCardIdsRef.current.has(card.data.id)) {
            unseenCards.push(card);
            ingestedCardIdsRef.current.add(card.data.id);
          }
        }
      }
    }
    if (unseenCards.length === 0) return;
    const applied = applyAgentUpdatesToAppState(
      {
        briefings: briefingsRef.current,
        reminders: remindersRef.current,
        goals: goalsRef.current,
        healthLog: healthLogRef.current,
      },
      unseenCards,
      []
    );
    if (applied.changed) {
      briefingsRef.current = applied.nextBriefings;
      remindersRef.current = applied.nextReminders;
      goalsRef.current = applied.nextGoals;
      healthLogRef.current = applied.nextHealthLog;
      setBriefings(applied.nextBriefings);
      setReminders(applied.nextReminders);
      setGoals(applied.nextGoals);
      setHealthLog(applied.nextHealthLog);
      try {
        localStorage.setItem(
          'relay_ingested_card_ids_v1',
          JSON.stringify(Array.from(ingestedCardIdsRef.current).slice(-300))
        );
      } catch {
        // ignore
      }
      const msg = formatSyncToast(applied.summary);
      if (msg) showToast(msg);
    }
  };

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
        ingestCardsFromRemoteHistory(hist);
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
        ingestCardsFromRemoteHistory(hist);
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
        const autoDeviceHeader = await buildAutoContextHeader(deviceContextConfig);
        const autoAppStateHeader =
          deviceContextConfig.autoSyncAppState !== false
            ? buildAppStateContextHeader({
                goals: goalsRef.current,
                reminders: remindersRef.current,
                briefings: briefingsRef.current,
                healthLog: healthLogRef.current,
                healthConfig: healthConfigRef.current,
              })
            : '';
        if (autoAppStateHeader || autoDeviceHeader) {
          promptToSend = `${autoAppStateHeader}${autoDeviceHeader}${text}`;
        }
      }

      let appliedTurnSync = false;

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
                    attachments: chunk.attachments ?? m.attachments,
                    streaming: !chunk.done,
                  }
                : m
            )
          );

          // Automatically push Agent-emitted briefings, reminders, goals, and relay-sync updates into the App
          if (
            chunk.done &&
            !appliedTurnSync &&
            ((chunk.cards && chunk.cards.length > 0) ||
              (chunk.syncPayloads && chunk.syncPayloads.length > 0))
          ) {
            appliedTurnSync = true;
            const applied = applyAgentUpdatesToAppState(
              {
                briefings: briefingsRef.current,
                reminders: remindersRef.current,
                goals: goalsRef.current,
                healthLog: healthLogRef.current,
              },
              chunk.cards ?? [],
              chunk.syncPayloads ?? []
            );
            if (applied.changed) {
              briefingsRef.current = applied.nextBriefings;
              remindersRef.current = applied.nextReminders;
              goalsRef.current = applied.nextGoals;
              healthLogRef.current = applied.nextHealthLog;
              setBriefings(applied.nextBriefings);
              setReminders(applied.nextReminders);
              setGoals(applied.nextGoals);
              setHealthLog(applied.nextHealthLog);
              // Record ingested card IDs so remote history reloads won't resurrect deleted items
              (chunk.cards ?? []).forEach((c) => {
                if (c.type === 'briefing' || c.type === 'reminder' || c.type === 'goal') {
                  ingestedCardIdsRef.current.add(c.data.id);
                }
              });
              try {
                localStorage.setItem(
                  'relay_ingested_card_ids_v1',
                  JSON.stringify(Array.from(ingestedCardIdsRef.current).slice(-300))
                );
              } catch {
                // ignore
              }
              const msg = formatSyncToast(applied.summary);
              if (msg) showToast(msg);
            }
          }
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

  // Optional manual sync trigger (automatic reading already happens on every message)
  const handleManualSyncStateWithAgent = () => {
    const prompt = buildManualAppStateSyncPrompt({
      goals: goalsRef.current,
      reminders: remindersRef.current,
      briefings: briefingsRef.current,
      healthLog: healthLogRef.current,
      healthConfig: healthConfigRef.current,
    });
    if (activeTab !== 'chat') {
      setInPlaceMiniReplyPrompt('同步任务与进度');
      setInPlaceBaselineMsgCount(messages.length);
    }
    void handleSendMessage(prompt);
  };

  const handleSelectLibraryPopover = (dest: LibraryPopoverDestination) => {
    if (dest === 'health') {
      setActiveTab('health');
      return;
    }
    if (dest === 'devices') {
      setSpaceSubTab('environment');
      setActiveTab('space');
      return;
    }
    if (dest === 'files') {
      setSpaceSubTab('library');
      setActiveTab('space');
      return;
    }
    setSpaceSubTab('device');
    setActiveTab('space');
  };

  const activeLibraryPopoverDest: LibraryPopoverDestination | null =
    activeTab === 'health'
      ? 'health'
      : activeTab === 'space'
        ? spaceSubTab === 'environment'
          ? 'devices'
          : spaceSubTab === 'library'
            ? 'files'
            : 'phone'
        : null;

  const handleStopStreaming = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      setIsStreaming(false);
      updateSessionMessages(activeSession.id, (prev) =>
        prev.map((m) => (m.streaming ? { ...m, streaming: false } : m))
      );
    }
  };

  // Global in-place voice controller (keeps user on Feeds / Goals / Health / Library)
  const dispatchInPlaceVoiceText = (rawText: string) => {
    const clean = rawText.trim();
    if (!clean) return;
    setInPlaceTranscript('');
    setInPlaceMiniReplyPrompt(clean);
    setInPlaceBaselineMsgCount(messages.length);
    void handleSendMessage(clean);
  };

  const handleCancelInPlaceVoice = () => {
    inPlaceDiscardRef.current = true;
    inPlaceAutoSendRef.current = false;
    inPlaceSpeechRef.current?.stop();
    inPlaceSpeechRef.current = null;
    setInPlaceListening(false);
    setInPlaceTranscribing(false);
    setInPlaceSeconds(0);
    setInPlaceTranscript('');
  };

  const handleStartInPlaceVoice = async () => {
    if (inPlaceListening || inPlaceTranscribing) return;
    inPlaceDiscardRef.current = false;
    inPlaceAutoSendRef.current = false;
    setInPlaceTranscript('');
    setInPlaceMiniReplyPrompt(null);

    const session = await startVoiceRecognition(
      {
        onTranscript: (transcript, isFinal) => {
          if (inPlaceDiscardRef.current) return;
          setInPlaceTranscript(transcript);
          if (isFinal) {
            inPlaceSpeechRef.current = null;
            if (inPlaceAutoSendRef.current && transcript.trim()) {
              inPlaceAutoSendRef.current = false;
              dispatchInPlaceVoiceText(transcript);
            }
          }
        },
        onStateChange: (active) => {
          setInPlaceListening(active);
        },
        onError: (msg) => {
          inPlaceSpeechRef.current = null;
          inPlaceAutoSendRef.current = false;
          setInPlaceListening(false);
          if (!inPlaceDiscardRef.current) {
            showToast(msg);
          }
        },
      },
      {
        serverUrl: config.serverUrl,
        onBusyChange: (busy) => {
          if (inPlaceDiscardRef.current) {
            setInPlaceTranscribing(false);
            return;
          }
          setInPlaceTranscribing(busy);
        },
      }
    );

    if (session) {
      inPlaceSpeechRef.current = session;
    }
  };

  const handleConfirmSendInPlaceVoice = () => {
    inPlaceDiscardRef.current = false;
    inPlaceAutoSendRef.current = true;
    if (inPlaceListening) {
      inPlaceSpeechRef.current?.stop();
      inPlaceSpeechRef.current = null;
      setInPlaceListening(false);
      window.setTimeout(() => {
        if (inPlaceAutoSendRef.current && !inPlaceTranscribing && inPlaceTranscriptRef.current.trim()) {
          inPlaceAutoSendRef.current = false;
          dispatchInPlaceVoiceText(inPlaceTranscriptRef.current);
        }
      }, 260);
    } else if (!inPlaceTranscribing && inPlaceTranscriptRef.current.trim()) {
      inPlaceAutoSendRef.current = false;
      dispatchInPlaceVoiceText(inPlaceTranscriptRef.current);
    }
  };

  const handleTapAvatarInPlace = () => {
    if (inPlaceListening || inPlaceTranscribing) {
      handleCancelInPlaceVoice();
    } else {
      void handleStartInPlaceVoice();
    }
  };

  const handleAskAboutReminder = (item: ReminderItem) => {
    setActiveTab('chat');
    void handleSendMessage(`关于提醒「${item.title}」（${item.dueLabel}），请帮我安排推进建议或准备相关事项。`);
  };

  const formattedInPlaceTime = useMemo(() => {
    const mins = Math.floor(inPlaceSeconds / 60);
    const secs = inPlaceSeconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }, [inPlaceSeconds]);

  const inPlaceMiniReply = useMemo(() => {
    if (!inPlaceMiniReplyPrompt || activeTab === 'chat') return null;
    const recent = messages.slice(inPlaceBaselineMsgCount);
    const assistantMsg = [...recent].reverse().find((m) => m.role === 'assistant');
    return {
      prompt: inPlaceMiniReplyPrompt,
      reply: assistantMsg?.content || '',
      streaming: Boolean(assistantMsg?.streaming || isStreaming),
    };
  }, [inPlaceMiniReplyPrompt, activeTab, messages, inPlaceBaselineMsgCount, isStreaming]);

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
      setInPlaceMiniReplyPrompt('获取今日汇报与提醒');
      setInPlaceBaselineMsgCount(messages.length);
      void handleSendMessage(
        '请帮我汇总今天的重点汇报、待办提醒与科技简报，并尽量用 relay-card（type: "briefing" / "reminder"）返回。'
      );
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

  const activeFeedsCount =
    briefings.length + reminders.filter((r) => !r.completed).length;

  const sidebarNavItems: {
    key: TabKey;
    label: string;
    Icon: React.FC<{ className?: string; active?: boolean }>;
    badge?: number;
  }[] = [
    { key: 'chat', label: 'Main chat', Icon: NavChatIcon },
    { key: 'research', label: 'Feeds', Icon: NavFeedsIcon, badge: activeFeedsCount },
    { key: 'goals', label: 'Goals', Icon: NavGoalsIcon, badge: pendingGoalsOrReminders },
    { key: 'health', label: 'Health', Icon: NavHealthIcon },
    { key: 'space', label: 'Library', Icon: NavLibraryIcon },
  ];

  // Exact 4-icon bottom capsule bar matching all 5 Muse screens: Chat / Feeds / Goals / Library
  const mobileBottomItems: {
    key: TabKey;
    label: string;
    Icon: React.FC<{ className?: string; active?: boolean }>;
  }[] = [
    { key: 'chat', label: 'Main chat', Icon: NavChatIcon },
    { key: 'research', label: 'Feeds', Icon: NavFeedsIcon },
    { key: 'goals', label: 'Goals', Icon: NavGoalsIcon },
    { key: 'space', label: 'Library', Icon: NavLibraryIcon },
  ];

  // Muse Sidebar/Drawer
  const renderSidebarContent = (isDrawer: boolean) => (
    <div className="flex h-full flex-col gap-3 p-3.5">
      {/* Card 1: Name of AI Header Card */}
      <div className="flex items-center justify-between gap-2 rounded-[22px] border border-black/[0.08] bg-white px-3.5 py-3 shadow-xs dark:border-white/10 dark:bg-zinc-900">
        <button
          type="button"
          onClick={() => {
            if (isDrawer) setDrawerOpen(false);
            setSettingsOpen(true);
          }}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left transition-opacity hover:opacity-80"
        >
          <img
            src={avatarSrc}
            alt={agentProfile.name}
            className="h-9 w-9 shrink-0 rounded-full object-cover ring-1 ring-black/[0.08] dark:ring-white/15"
          />
          <div className="min-w-0">
            <div className="truncate text-[15px] font-semibold tracking-tight text-[var(--relay-text)]">
              {agentProfile.name}
            </div>
          </div>
        </button>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={handleNewSession}
            aria-label="新对话"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-black/[0.08] bg-zinc-50 text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-white/10 dark:bg-zinc-800 dark:text-zinc-200"
          >
            <Plus weight="bold" className="h-4 w-4" />
          </button>
          {isDrawer && (
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              aria-label="关闭"
              className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Card 2: Grouped Navigation Card (Monochrome) */}
      <nav className="overflow-hidden rounded-[22px] border border-black/[0.08] bg-white shadow-xs divide-y divide-black/[0.06] dark:border-white/10 dark:bg-zinc-900 dark:divide-white/10">
        {sidebarNavItems.map(({ key, label, Icon, badge }) => {
          const isLibrary = key === 'space';
          const active = isLibrary
            ? libraryPopoverOpen || activeTab === 'space'
            : activeTab === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => {
                if (isLibrary) {
                  if (isDrawer) setDrawerOpen(false);
                  setLibraryPopoverOpen((prev) => !prev);
                } else {
                  setLibraryPopoverOpen(false);
                  setActiveTab(key);
                  if (isDrawer) setDrawerOpen(false);
                }
              }}
              className={`flex min-h-[46px] w-full items-center justify-between gap-2.5 px-3.5 py-2.5 text-left transition-colors ${
                active
                  ? 'bg-zinc-100/90 text-zinc-950 dark:bg-zinc-800 dark:text-white'
                  : 'text-[var(--relay-text-muted)] hover:bg-zinc-50 hover:text-[var(--relay-text)] dark:hover:bg-zinc-800/50'
              }`}
            >
              <span className="flex min-w-0 items-center gap-3">
                <Icon className="h-[19px] w-[19px] shrink-0" active={active} />
                <span className="truncate text-[14px] font-medium">{label}</span>
              </span>
              {badge !== undefined && badge > 0 && (
                <span className="font-mono-tabular text-[11px] text-[var(--relay-text-faint)]">
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Card 3: CHATS Bordered Session List Card */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[22px] border border-black/[0.08] bg-white shadow-xs dark:border-white/10 dark:bg-zinc-900">
        <div className="flex items-center justify-between border-b border-black/[0.06] px-3.5 py-2.5 dark:border-white/10">
          <span className="text-[11px] font-semibold tracking-wider text-[var(--relay-text-muted)] uppercase">
            CHATS
          </span>
          <div className="flex items-center gap-0.5">
            {config.mode === 'dsh-bridge' && (
              <>
                <button
                  type="button"
                  onClick={() => setShowSidebarBind((v) => !v)}
                  aria-label="Session ID"
                  className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors ${
                    showSidebarBind
                      ? 'bg-zinc-100 text-[#1B6EF3] dark:bg-zinc-800'
                      : 'text-[var(--relay-text-muted)] hover:bg-zinc-100 hover:text-[var(--relay-text)] dark:hover:bg-zinc-800'
                  }`}
                >
                  <Hash className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => void handleRefreshSessions(false)}
                  disabled={isLoadingSessions}
                  aria-label="同步"
                  className="flex h-7 w-7 items-center justify-center rounded-full text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-950 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                >
                  <ArrowsClockwise
                    weight="regular"
                    className={`h-3.5 w-3.5 ${isLoadingSessions ? 'animate-spin' : ''}`}
                  />
                </button>
              </>
            )}
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col px-2.5 pt-2">
          {showSidebarBind && config.mode === 'dsh-bridge' && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!sidebarBindInput.trim()) return;
                void handleBindSessionId(sidebarBindInput);
                setSidebarBindInput('');
                setShowSidebarBind(false);
              }}
              className="mb-2 flex items-center gap-1.5"
            >
              <input
                type="text"
                value={sidebarBindInput}
                onChange={(e) => setSidebarBindInput(e.target.value)}
                placeholder="粘贴 Session ID…"
                className="min-h-[34px] min-w-0 flex-1 rounded-xl border border-black/[0.09] bg-zinc-50 px-2.5 font-mono-tabular text-[11px] text-[var(--relay-text)] placeholder:text-[var(--relay-text-faint)] focus:border-[#1B6EF3] focus:bg-white focus:outline-none dark:border-white/12 dark:bg-zinc-800"
              />
              <button
                type="submit"
                disabled={!sidebarBindInput.trim()}
                className="min-h-[34px] shrink-0 rounded-xl bg-zinc-900 px-2.5 text-[11px] font-semibold text-white disabled:opacity-40 dark:bg-[#1B6EF3]"
              >
                接入
              </button>
            </form>
          )}

          {sessions.length > 3 && (
            <div className="relative mb-2">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-[var(--relay-text-faint)]" />
              <input
                type="text"
                value={sidebarSearch}
                onChange={(e) => setSidebarSearch(e.target.value)}
                placeholder="搜索会话…"
                className="min-h-[34px] w-full rounded-xl border border-black/[0.08] bg-zinc-50 py-1 pr-2.5 pl-8 text-xs text-[var(--relay-text)] placeholder:text-[var(--relay-text-faint)] focus:border-[#1B6EF3] focus:bg-white focus:outline-none dark:border-white/10 dark:bg-zinc-800"
              />
            </div>
          )}

          <div className="flex-1 overflow-y-auto space-y-1 pb-2">
            {filteredSidebarSessions.map((s) => {
              const isActive = s.id === activeSession.id && activeTab === 'chat';
              const isRenaming = renamingSessionId === s.id;

              return (
                <div
                  key={s.id}
                  className={`group flex items-center justify-between gap-1.5 rounded-xl px-2.5 py-2 transition-colors ${
                    isActive
                      ? 'bg-zinc-100 text-zinc-950 dark:bg-zinc-800 dark:text-white'
                      : 'text-[var(--relay-text-muted)] hover:bg-zinc-50 hover:text-[var(--relay-text)] dark:hover:bg-zinc-800/50'
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
                        className="min-w-0 flex-1 rounded-lg border border-[#1B6EF3] bg-white px-2 py-0.5 text-xs text-[var(--relay-text)] focus:outline-none dark:bg-zinc-900"
                      />
                      <button
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          handleRenameSession(s.id, renameDraft);
                        }}
                        aria-label="保存名称"
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-zinc-900 text-white dark:bg-[#1B6EF3]"
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
                        <div className="truncate text-[13px] font-medium text-[var(--relay-text)]">
                          {s.title}
                        </div>
                        <div className="mt-0.5 font-mono-tabular text-[10px] text-[var(--relay-text-faint)]">
                          {s.source === 'remote' ? '云端' : '本地'} · {s.updatedAt}
                        </div>
                      </button>

                      <div className="flex items-center gap-0.5 opacity-70 sm:opacity-0 transition-opacity sm:group-hover:opacity-100">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setRenamingSessionId(s.id);
                            setRenameDraft(s.title);
                          }}
                          aria-label="重命名会话"
                          className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-200/70 hover:text-zinc-800 dark:hover:bg-zinc-700 dark:hover:text-zinc-100"
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
                            className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/15"
                          >
                            <Trash weight="duotone" className="h-3.5 w-3.5" />
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
      </div>

      {/* Bottom Dock: Circular Settings Gear Button */}
      <div className="flex items-center justify-between gap-2 pt-0.5">
        <button
          type="button"
          onClick={() => {
            if (isDrawer) setDrawerOpen(false);
            setSettingsOpen(true);
          }}
          aria-label="设置"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-black/[0.08] bg-white shadow-xs transition-colors hover:bg-zinc-50 active:scale-95 dark:border-white/10 dark:bg-zinc-900"
        >
          <NavSettingsIcon className="h-[20px] w-[20px]" />
        </button>

        <div className="flex-1 min-w-0">
          <PWAInstallButton />
        </div>
      </div>
    </div>
  );

  const isInPlaceVoiceActive = inPlaceListening || inPlaceTranscribing;

  return (
    <div className="board-backdrop flex h-dvh flex-col overflow-hidden text-[var(--relay-text)] lg:flex-row">
      {/* Desktop Clean White Sidebar */}
      <aside className="hidden lg:flex lg:w-[276px] lg:shrink-0 lg:flex-col border-r border-black/[0.06] bg-[var(--relay-bg)] dark:border-white/[0.07]">
        {renderSidebarContent(false)}
      </aside>

      {/* Mobile Floating Inset White Drawer */}
      <AnimatePresence>
        {drawerOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-50 flex bg-black/25 p-2.5 backdrop-blur-[2px] lg:hidden"
            onClick={() => setDrawerOpen(false)}
          >
            <motion.aside
              initial={{ x: '-100%', opacity: 0.8 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: '-100%', opacity: 0.8 }}
              transition={{ type: 'spring', stiffness: 380, damping: 36 }}
              onClick={(e) => e.stopPropagation()}
              className="h-full w-[82vw] max-w-[310px] overflow-hidden rounded-[28px] border border-black/[0.08] bg-[#F7F8FA] shadow-2xl dark:border-white/10 dark:bg-[#12151B]"
            >
              {renderSidebarContent(true)}
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Persistent 5-Tab Stage (all panels stay mounted via visibility so scroll & state are preserved) */}
      <main className="relative min-h-0 flex-1 overflow-hidden">
        {/* Panel 1: Main Chat */}
        <div
          aria-hidden={activeTab !== 'chat'}
          className={`absolute inset-0 h-full transition-opacity duration-150 ${
            activeTab === 'chat'
              ? 'visible opacity-100 z-10'
              : 'invisible pointer-events-none opacity-0 z-0'
          }`}
        >
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
            onOpenDrawer={() => setDrawerOpen(true)}
            onToggleSaveBriefing={handleToggleSaveBriefing}
            onOpenBriefing={(item) => {
              setSelectedBriefing(item);
              setSpaceSubTab('library');
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

        {/* Panel 2: AI Feeds (Reports & Reminders) */}
        <div
          aria-hidden={activeTab !== 'research'}
          className={`absolute inset-0 h-full overflow-y-auto transition-opacity duration-150 ${
            activeTab === 'research'
              ? 'visible opacity-100 z-10'
              : 'invisible pointer-events-none opacity-0 z-0'
          }`}
        >
          <ResearchView
            briefings={briefings}
            reminders={reminders}
            agentProfile={agentProfile}
            isFetchingDigest={isFetchingDigest}
            isVoiceActive={isInPlaceVoiceActive}
            onOpenDrawer={() => setDrawerOpen(true)}
            onTapAvatar={handleTapAvatarInPlace}
            onToggleSaveBriefing={handleToggleSaveBriefing}
            onAskAboutBriefing={handleAskAboutBriefing}
            onToggleReminder={handleToggleReminderById}
            onSnoozeReminder={handleSnoozeReminderById}
            onAskAboutReminder={handleAskAboutReminder}
            onFetchFreshDigest={handleFetchFreshDigest}
          />
        </div>

        {/* Panel 3: Health */}
        <div
          aria-hidden={activeTab !== 'health'}
          className={`absolute inset-0 h-full overflow-y-auto transition-opacity duration-150 ${
            activeTab === 'health'
              ? 'visible opacity-100 z-10'
              : 'invisible pointer-events-none opacity-0 z-0'
          }`}
        >
          <HealthView
            healthConfig={healthConfig}
            todayLog={healthLog}
            agentProfile={agentProfile}
            isVoiceActive={isInPlaceVoiceActive}
            onOpenDrawer={() => setDrawerOpen(true)}
            onTapAvatar={handleTapAvatarInPlace}
            onUpdateConfig={setHealthConfig}
            onUpdateTodayLog={setHealthLog}
            onScheduleBedtimeReminder={handleScheduleBedtimeReminder}
            onAskAgentHealthCheck={handleAskAgentHealthCheck}
          />
        </div>

        {/* Panel 4: Goals */}
        <div
          aria-hidden={activeTab !== 'goals'}
          className={`absolute inset-0 h-full overflow-y-auto transition-opacity duration-150 ${
            activeTab === 'goals'
              ? 'visible opacity-100 z-10'
              : 'invisible pointer-events-none opacity-0 z-0'
          }`}
        >
          <GoalsView
            goals={goals}
            reminders={reminders}
            config={config}
            agentProfile={agentProfile}
            isVoiceActive={isInPlaceVoiceActive}
            onOpenDrawer={() => setDrawerOpen(true)}
            onTapAvatar={handleTapAvatarInPlace}
            onSyncStateWithAgent={handleManualSyncStateWithAgent}
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
        </div>

        {/* Panel 5: Library / Space */}
        <div
          aria-hidden={activeTab !== 'space'}
          className={`absolute inset-0 h-full overflow-y-auto transition-opacity duration-150 ${
            activeTab === 'space'
              ? 'visible opacity-100 z-10'
              : 'invisible pointer-events-none opacity-0 z-0'
          }`}
        >
          <SpaceView
            config={config}
            agentProfile={agentProfile}
            isVoiceActive={isInPlaceVoiceActive}
            onOpenDrawer={() => setDrawerOpen(true)}
            onTapAvatar={handleTapAvatarInPlace}
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
        </div>
      </main>

      {/* Global In-Place Voice Bar & Mini AI Reply (shown directly on current non-chat tab) */}
      {activeTab !== 'chat' && (
        <InPlaceVoiceDock
          listening={inPlaceListening}
          transcribing={inPlaceTranscribing}
          formattedTime={formattedInPlaceTime}
          transcript={inPlaceTranscript}
          onCancel={handleCancelInPlaceVoice}
          onConfirmSend={handleConfirmSendInPlaceVoice}
          miniReply={inPlaceMiniReply}
          onDismissMiniReply={() => setInPlaceMiniReplyPrompt(null)}
          onOpenChat={() => setActiveTab('chat')}
        />
      )}

      {/* Floating Library Quick Popover (Left-Middle Sketch Layout) */}
      <LibraryFloatingPopover
        open={libraryPopoverOpen}
        activeDestination={activeLibraryPopoverDest}
        onClose={() => setLibraryPopoverOpen(false)}
        onSelect={handleSelectLibraryPopover}
        variant="mobile-bottom"
      />
      <LibraryFloatingPopover
        open={libraryPopoverOpen}
        activeDestination={activeLibraryPopoverDest}
        onClose={() => setLibraryPopoverOpen(false)}
        onSelect={handleSelectLibraryPopover}
        variant="desktop-sidebar"
      />

      {/* Mobile Floating 4-Icon Muse Capsule Navigation Bar (Crisp Monochrome) */}
      <div className="shrink-0 px-3.5 pt-0.5 pb-2.5 pb-safe lg:hidden">
        <nav
          aria-label="主导航"
          className="muse-pill mx-auto grid h-[56px] max-w-[440px] grid-cols-4 items-center rounded-[28px] px-2"
        >
          {mobileBottomItems.map(({ key, label, Icon }) => {
            const isLibraryBtn = key === 'space';
            const active = isLibraryBtn
              ? libraryPopoverOpen || activeTab === 'space' || activeTab === 'health'
              : !libraryPopoverOpen && activeTab === key;
            return (
              <motion.button
                key={key}
                type="button"
                whileTap={{ scale: 0.92 }}
                onClick={() => {
                  if (isLibraryBtn) {
                    setLibraryPopoverOpen((prev) => !prev);
                  } else {
                    setLibraryPopoverOpen(false);
                    setActiveTab(key);
                  }
                }}
                aria-label={label}
                aria-expanded={isLibraryBtn ? libraryPopoverOpen : undefined}
                title={label}
                className="relative flex h-[44px] items-center justify-center rounded-full transition-colors"
              >
                {active && (
                  <motion.span
                    layoutId="muse-mobile-tab-halo"
                    transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                    className="absolute h-[40px] w-[52px] rounded-full bg-zinc-100/95 dark:bg-zinc-800"
                  />
                )}
                <Icon className="relative z-10 h-[22px] w-[22px]" active={active} />
              </motion.button>
            );
          })}
        </nav>
      </div>

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
