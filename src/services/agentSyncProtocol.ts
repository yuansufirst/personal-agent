import type {
  AgentAppSyncPayload,
  BriefingItem,
  GoalItem,
  HealthConfig,
  HealthDailyLog,
  InteractiveCard,
  ReminderItem,
} from '../types/relay';
import { parseScheduleTiming, pruneExpiredSchedules } from './scheduleCalendar';

function nowHHMM(): string {
  return new Date().toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function normTitle(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

function matchesIdentifierOrTitle(
  itemId: string,
  itemTitle: string,
  targets: string[]
): boolean {
  const nId = normTitle(itemId);
  const nTitle = normTitle(itemTitle);
  for (const raw of targets) {
    const q = normTitle(String(raw || ''));
    if (!q) continue;
    if (nId === q || nTitle === q) return true;
    if (q.length >= 3 && (nTitle.includes(q) || q.includes(nTitle))) return true;
  }
  return false;
}

/**
 * Extracts ```relay-sync ... ``` blocks emitted by the cloud Agent and returns
 * the cleaned user-facing message text + parsed sync payloads.
 */
export function extractAgentSyncPayloads(rawText: string): {
  cleanText: string;
  syncPayloads: AgentAppSyncPayload[];
} {
  const syncPayloads: AgentAppSyncPayload[] = [];
  const blocksToStrip: string[] = [];

  const syncRegex = /```relay[-_]sync\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;

  while ((match = syncRegex.exec(rawText)) !== null) {
    blocksToStrip.push(match[0]);
    const body = match[1].trim();
    try {
      const parsed = JSON.parse(body);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        if (item && typeof item === 'object') {
          syncPayloads.push(item as AgentAppSyncPayload);
        }
      }
    } catch {
      // Ignore partial JSON while streaming
    }
  }

  let cleanText = rawText;
  for (const block of blocksToStrip) {
    cleanText = cleanText.replace(block, '');
  }
  cleanText = cleanText.replace(/\n{3,}/g, '\n\n').trim();
  return { cleanText, syncPayloads };
}

export interface AppStateSnapshotInput {
  goals: GoalItem[];
  reminders: ReminderItem[];
  briefings: BriefingItem[];
  healthLog: HealthDailyLog;
  healthConfig: HealthConfig;
}

/**
 * Compact, hidden context header automatically prepended to outgoing prompts
 * so the cloud Agent always knows the user's latest Goals, Calendar/Reminders,
 * Feed items, and completion states without requiring manual user action.
 */
export function buildAppStateContextHeader(input: AppStateSnapshotInput): string {
  const { goals, briefings, healthLog, healthConfig } = input;
  const activeReminders = pruneExpiredSchedules(input.reminders).items;

  const pendingReminders = activeReminders.filter((r) => !r.completed);
  const doneReminders = activeReminders.filter((r) => r.completed);

  const lines: string[] = [
    `[Relay App 自动状态同步 · ${new Date().toLocaleString('zh-CN', { hour12: false })}]`,
  ];

  // Calendar Schedules & Reminders
  if (pendingReminders.length > 0) {
    lines.push(
      `当前日程与提醒(${pendingReminders.length}): ` +
        pendingReminders
          .slice(0, 12)
          .map((r) => {
            const tag = r.source === 'calendar' ? '日历' : '提醒';
            const loc = r.location ? `, @${r.location}` : '';
            return `[ ] [${tag}] ${r.title} (${r.dueLabel}${loc}, id:${r.id}${r.priority === 'high' ? ', 重要' : ''})`;
          })
          .join(' | ')
    );
  } else {
    lines.push('当前日程与提醒(0): 无');
  }

  if (doneReminders.length > 0) {
    lines.push(
      `已完成提醒(${doneReminders.length}): ` +
        doneReminders
          .slice(0, 6)
          .map((r) => `[x] ${r.title} (id:${r.id})`)
          .join(' | ')
    );
  }

  // Goals & Milestones completion progress
  if (goals.length > 0) {
    const goalSummaries = goals.slice(0, 8).map((g) => {
      const done = g.milestones.filter((m) => m.done).length;
      const total = g.milestones.length;
      const msStr =
        total > 0
          ? ` {${g.milestones.map((m) => `${m.done ? '[x]' : '[ ]'}${m.text}`).join('; ')}}`
          : '';
      return `${g.title} (${done}/${total}, id:${g.id})${msStr}`;
    });
    lines.push(`当前目标(${goals.length}): ${goalSummaries.join(' | ')}`);
  } else {
    lines.push('当前目标(0): 无');
  }

  // Recent Feeds / Briefings
  if (briefings.length > 0) {
    lines.push(
      `已有简报(${briefings.length}, 收藏${briefings.filter((b) => b.saved).length}): ` +
        briefings
          .slice(0, 5)
          .map((b) => `${b.saved ? '★' : ''}${b.title.slice(0, 28)} (id:${b.id})`)
          .join(' | ')
    );
  }

  // Today's health snapshot
  lines.push(
    `今日健康(${healthLog.dateKey}): 睡眠 ${healthLog.sleepHours.toFixed(1)}/${healthConfig.sleepGoalHours}h, 步数 ${healthLog.steps}/${healthConfig.stepsGoal}, 饮水 ${healthLog.waterCups}/${healthConfig.waterGoalCups}杯, 运动 ${healthLog.exerciseMinutes}m`
  );

  lines.push(
    '写入与删改指令: 如需自动向 App 新增/修改/删除提醒或日程、目标、论文简报，请在回复末尾附带 ```relay-sync JSON 块（支持 addReminders / updateReminders / deleteReminderIds / completeReminderIds / addGoals / updateGoals / deleteGoalIds / completeMilestoneMatches / addBriefings / deleteBriefingIds / updateHealth）。日程请尽量附带标准 ISO startTime/endTime，日历时间一过前端会自动移除，新增提醒会自动安排手机通知栏提醒。'
  );

  return `${lines.join('\n')}\n---\n`;
}

/**
 * Optional manual trigger prompt when the user taps the explicit "Sync" button.
 */
export function buildManualAppStateSyncPrompt(input: AppStateSnapshotInput): string {
  const activeReminders = pruneExpiredSchedules(input.reminders).items;
  const pendingRem = activeReminders.filter((r) => !r.completed).length;
  const doneRem = activeReminders.filter((r) => r.completed).length;
  const totalMs = input.goals.reduce((acc, g) => acc + g.milestones.length, 0);
  const doneMs = input.goals.reduce(
    (acc, g) => acc + g.milestones.filter((m) => m.done).length,
    0
  );

  return `请读取我最新的 App 完成情况（待办/日程 ${pendingRem} 条未完成 / ${doneRem} 条已完成；目标里程碑 ${doneMs}/${totalMs} 已完成），根据当前进度帮我新增、修改或清理接下来的提醒、目标或简报（请用 \`\`\`relay-sync 返回，我会直接自动同步进界面并更新通知栏提醒）。`;
}

export interface AppliedSyncSummary {
  addedBriefings: number;
  deletedBriefings: number;
  addedReminders: number;
  updatedReminders: number;
  deletedReminders: number;
  completedReminders: number;
  addedGoals: number;
  updatedGoals: number;
  deletedGoals: number;
  updatedHealth: boolean;
}

export interface AppSyncApplyResult {
  nextBriefings: BriefingItem[];
  nextReminders: ReminderItem[];
  nextGoals: GoalItem[];
  nextHealthLog: HealthDailyLog;
  addedReminderItems: ReminderItem[];
  updatedReminderItems: ReminderItem[];
  deletedReminderIds: string[];
  summary: AppliedSyncSummary;
  changed: boolean;
}

/**
 * Applies structured cards (`briefing`, `reminder`, `goal`) and `relay-sync` payloads
 * (including create, update, complete, and delete) automatically into App state.
 */
export function applyAgentUpdatesToAppState(
  current: {
    briefings: BriefingItem[];
    reminders: ReminderItem[];
    goals: GoalItem[];
    healthLog: HealthDailyLog;
  },
  cards: InteractiveCard[] = [],
  syncPayloads: AgentAppSyncPayload[] = []
): AppSyncApplyResult {
  const nowMs = Date.now();
  let nextBriefings = [...current.briefings];
  let nextReminders = [...current.reminders];
  let nextGoals = [...current.goals];
  let nextHealthLog = { ...current.healthLog };

  const addedReminderItems: ReminderItem[] = [];
  const updatedReminderItems: ReminderItem[] = [];
  const deletedReminderIds: string[] = [];

  const summary: AppliedSyncSummary = {
    addedBriefings: 0,
    deletedBriefings: 0,
    addedReminders: 0,
    updatedReminders: 0,
    deletedReminders: 0,
    completedReminders: 0,
    addedGoals: 0,
    updatedGoals: 0,
    deletedGoals: 0,
    updatedHealth: false,
  };

  const upsertBriefing = (item: BriefingItem) => {
    const key = normTitle(item.title);
    if (!key) return;
    const exists = nextBriefings.some((b) => b.id === item.id || normTitle(b.title) === key);
    if (!exists) {
      nextBriefings = [{ ...item, origin: 'agent' }, ...nextBriefings];
      summary.addedBriefings += 1;
    }
  };

  const upsertReminder = (item: ReminderItem) => {
    const key = normTitle(item.title);
    if (!key) return;
    const existsIdx = nextReminders.findIndex(
      (r) => r.id === item.id || (normTitle(r.title) === key && !r.completed)
    );
    if (existsIdx === -1) {
      const normalizedItem: ReminderItem = { ...item, origin: item.origin || 'agent' };
      nextReminders = [normalizedItem, ...nextReminders];
      addedReminderItems.push(normalizedItem);
      summary.addedReminders += 1;
    } else {
      // Update timing/note if agent re-emitted the same reminder with updated details
      const existing = nextReminders[existsIdx];
      const merged: ReminderItem = {
        ...existing,
        dueLabel: item.dueLabel || existing.dueLabel,
        dayGroup: item.dayGroup || existing.dayGroup,
        startAtMs: item.startAtMs ?? existing.startAtMs,
        endAtMs: item.endAtMs ?? existing.endAtMs,
        allDay: item.allDay ?? existing.allDay,
        location: item.location ?? existing.location,
        priority: item.priority || existing.priority,
        note: item.note ?? existing.note,
        repeat: item.repeat ?? existing.repeat,
      };
      if (
        merged.dueLabel !== existing.dueLabel ||
        merged.startAtMs !== existing.startAtMs ||
        merged.note !== existing.note ||
        merged.priority !== existing.priority
      ) {
        nextReminders = nextReminders.map((r, i) => (i === existsIdx ? merged : r));
        updatedReminderItems.push(merged);
        summary.updatedReminders += 1;
      }
    }
  };

  const upsertGoal = (item: GoalItem) => {
    const key = normTitle(item.title);
    if (!key) return;
    const existsIdx = nextGoals.findIndex(
      (g) => g.id === item.id || normTitle(g.title) === key
    );
    if (existsIdx === -1) {
      nextGoals = [{ ...item, origin: 'agent' }, ...nextGoals];
      summary.addedGoals += 1;
    } else if (item.milestones.length > 0) {
      const existing = nextGoals[existsIdx];
      const existingSet = new Set(existing.milestones.map((m) => normTitle(m.text)));
      const extraMs = item.milestones.filter((m) => !existingSet.has(normTitle(m.text)));
      if (extraMs.length > 0) {
        nextGoals = nextGoals.map((g, idx) =>
          idx === existsIdx
            ? {
                ...g,
                updatedAt: nowHHMM(),
                milestones: [...g.milestones, ...extraMs],
              }
            : g
        );
        summary.updatedGoals += 1;
      }
    }
  };

  // 1. Auto-ingest InteractiveCards emitted in the reply
  for (const card of cards) {
    if (card.type === 'briefing') {
      upsertBriefing(card.data);
    } else if (card.type === 'reminder') {
      const timing = parseScheduleTiming(
        {
          startAtMs: card.data.startAtMs,
          endAtMs: card.data.endAtMs,
          dueLabel: card.data.dueLabel,
          dayGroup: card.data.dayGroup,
          allDay: card.data.allDay,
        },
        nowMs
      );
      upsertReminder({
        ...card.data,
        dueLabel: timing.dueLabel,
        dayGroup: timing.dayGroup,
        startAtMs: timing.startAtMs,
        endAtMs: timing.endAtMs,
        allDay: timing.allDay,
      });
    } else if (card.type === 'goal') {
      upsertGoal(card.data);
    }
  }

  // 2. Auto-ingest explicit ```relay-sync payloads
  for (const payload of syncPayloads) {
    if (Array.isArray(payload.addBriefings)) {
      payload.addBriefings.forEach((b, idx) => {
        if (!b || typeof b.title !== 'string' || !b.title.trim()) return;
        upsertBriefing({
          id: b.id || `brief-ag-${Date.now().toString(36)}-${idx}`,
          kind: b.kind === 'news' ? 'news' : 'paper',
          title: b.title.trim(),
          source: b.source?.trim() || 'AI 助理汇报',
          identifier: b.identifier,
          publishedAt: b.publishedAt || `今天 ${nowHHMM()}`,
          readMinutes: typeof b.readMinutes === 'number' ? b.readMinutes : 3,
          summary: b.summary?.trim() || b.title.trim(),
          takeaways: Array.isArray(b.takeaways) ? b.takeaways.filter(Boolean) : [],
          relevanceNote: b.relevanceNote || '',
          saved: false,
          url: b.url || '',
          origin: 'agent',
        });
      });
    }

    if (Array.isArray(payload.deleteBriefingIds) && payload.deleteBriefingIds.length > 0) {
      const targets = payload.deleteBriefingIds.map(String);
      const before = nextBriefings.length;
      nextBriefings = nextBriefings.filter(
        (b) => !matchesIdentifierOrTitle(b.id, b.title, targets)
      );
      summary.deletedBriefings += before - nextBriefings.length;
    }

    if (Array.isArray(payload.addReminders)) {
      payload.addReminders.forEach((r, idx) => {
        if (!r || typeof r.title !== 'string' || !r.title.trim()) return;
        const timing = parseScheduleTiming(
          {
            startAtMs: r.startAtMs,
            endAtMs: r.endAtMs,
            startTime: r.startTime,
            endTime: r.endTime,
            dueLabel: r.dueLabel,
            dayGroup: r.dayGroup,
            allDay: r.allDay,
          },
          nowMs
        );
        upsertReminder({
          id: r.id || `rem-ag-${Date.now().toString(36)}-${idx}`,
          title: r.title.trim(),
          dueLabel: timing.dueLabel,
          dayGroup: timing.dayGroup,
          startAtMs: timing.startAtMs,
          endAtMs: timing.endAtMs,
          allDay: timing.allDay,
          location: r.location?.trim() || undefined,
          source: r.isCalendarEvent ? 'calendar' : 'reminder',
          priority: r.priority === 'high' ? 'high' : 'normal',
          channel:
            r.channel === 'ntfy' || r.channel === 'browser' ? r.channel : 'app',
          completed: false,
          note: r.note,
          repeat: r.repeat,
          origin: 'agent',
        });
      });
    }

    if (Array.isArray(payload.updateReminders) && payload.updateReminders.length > 0) {
      for (const patch of payload.updateReminders) {
        if (!patch || typeof patch !== 'object') continue;
        const matchTargets: string[] = [];
        if (patch.id) matchTargets.push(patch.id);
        if (patch.matchTitle) matchTargets.push(patch.matchTitle);
        if (!patch.id && !patch.matchTitle && patch.title) matchTargets.push(patch.title);
        if (matchTargets.length === 0) continue;

        let idx = nextReminders.findIndex(
          (r) =>
            (patch.id && normTitle(r.id) === normTitle(patch.id)) ||
            (patch.matchTitle && normTitle(r.title) === normTitle(patch.matchTitle))
        );
        if (idx === -1) {
          idx = nextReminders.findIndex((r) =>
            matchesIdentifierOrTitle(r.id, r.title, matchTargets)
          );
        }
        if (idx === -1) continue;

        const existing = nextReminders[idx];
        const hasTimingPatch =
          patch.startAtMs !== undefined ||
          patch.endAtMs !== undefined ||
          patch.startTime !== undefined ||
          patch.endTime !== undefined ||
          patch.dueLabel !== undefined ||
          patch.dayGroup !== undefined ||
          patch.allDay !== undefined;

        const timing = hasTimingPatch
          ? parseScheduleTiming(
              {
                startAtMs: patch.startAtMs,
                endAtMs: patch.endAtMs,
                startTime: patch.startTime,
                endTime: patch.endTime,
                dueLabel: patch.dueLabel,
                dayGroup: patch.dayGroup ?? existing.dayGroup,
                allDay: patch.allDay ?? existing.allDay,
              },
              nowMs
            )
          : null;

        const updated: ReminderItem = {
          ...existing,
          title: patch.title?.trim() || existing.title,
          dueLabel: timing ? timing.dueLabel : existing.dueLabel,
          dayGroup: timing ? timing.dayGroup : existing.dayGroup,
          startAtMs: timing ? timing.startAtMs : existing.startAtMs,
          endAtMs: timing ? timing.endAtMs : existing.endAtMs,
          allDay: timing ? timing.allDay : existing.allDay,
          location: patch.location !== undefined ? patch.location.trim() || undefined : existing.location,
          priority:
            patch.priority === 'high' || patch.priority === 'normal'
              ? patch.priority
              : existing.priority,
          channel:
            patch.channel === 'app' || patch.channel === 'browser' || patch.channel === 'ntfy'
              ? patch.channel
              : existing.channel,
          note: patch.note !== undefined ? patch.note : existing.note,
          repeat: patch.repeat !== undefined ? patch.repeat : existing.repeat,
          completed: patch.completed !== undefined ? Boolean(patch.completed) : existing.completed,
        };

        nextReminders = nextReminders.map((r, i) => (i === idx ? updated : r));
        updatedReminderItems.push(updated);
        summary.updatedReminders += 1;
      }
    }

    if (Array.isArray(payload.completeReminderIds) && payload.completeReminderIds.length > 0) {
      const targets = payload.completeReminderIds.map(String);
      nextReminders = nextReminders.map((r) => {
        if (!r.completed && matchesIdentifierOrTitle(r.id, r.title, targets)) {
          summary.completedReminders += 1;
          deletedReminderIds.push(r.id);
          return { ...r, completed: true };
        }
        return r;
      });
    }

    const deleteTargets = [
      ...(Array.isArray(payload.deleteReminderIds) ? payload.deleteReminderIds : []),
      ...(Array.isArray(payload.removeReminders) ? payload.removeReminders : []),
    ].map(String);

    if (deleteTargets.length > 0) {
      const kept: ReminderItem[] = [];
      for (const r of nextReminders) {
        if (matchesIdentifierOrTitle(r.id, r.title, deleteTargets)) {
          deletedReminderIds.push(r.id);
          summary.deletedReminders += 1;
        } else {
          kept.push(r);
        }
      }
      nextReminders = kept;
    }

    if (Array.isArray(payload.addGoals)) {
      payload.addGoals.forEach((g, idx) => {
        if (!g || typeof g.title !== 'string' || !g.title.trim()) return;
        const milestones = Array.isArray(g.milestones)
          ? g.milestones
              .map((m, mIdx) => {
                if (typeof m === 'string') {
                  return m.trim()
                    ? {
                        id: `ms-ag-${Date.now().toString(36)}-${idx}-${mIdx}`,
                        text: m.trim(),
                        done: false,
                      }
                    : null;
                }
                if (m && typeof m === 'object' && typeof m.text === 'string' && m.text.trim()) {
                  return {
                    id: m.id || `ms-ag-${Date.now().toString(36)}-${idx}-${mIdx}`,
                    text: m.text.trim(),
                    done: Boolean(m.done),
                  };
                }
                return null;
              })
              .filter((x): x is { id: string; text: string; done: boolean } => Boolean(x))
          : [];
        upsertGoal({
          id: g.id || `goal-ag-${Date.now().toString(36)}-${idx}`,
          title: g.title.trim(),
          notes: g.notes?.trim() || undefined,
          status: 'active',
          updatedAt: nowHHMM(),
          milestones,
          origin: 'agent',
        });
      });
    }

    if (Array.isArray(payload.updateGoals) && payload.updateGoals.length > 0) {
      for (const patch of payload.updateGoals) {
        if (!patch || typeof patch !== 'object') continue;
        const targets = [patch.id, patch.matchTitle, patch.title].filter(Boolean) as string[];
        if (targets.length === 0) continue;
        const idx = nextGoals.findIndex((g) =>
          matchesIdentifierOrTitle(g.id, g.title, targets)
        );
        if (idx === -1) continue;
        const existing = nextGoals[idx];
        const extraMs = Array.isArray(patch.addMilestones)
          ? patch.addMilestones
              .filter((t) => typeof t === 'string' && t.trim())
              .filter((t) => !existing.milestones.some((m) => normTitle(m.text) === normTitle(t)))
              .map((t, mIdx) => ({
                id: `ms-up-${Date.now().toString(36)}-${mIdx}`,
                text: t.trim(),
                done: false,
              }))
          : [];
        nextGoals = nextGoals.map((g, i) =>
          i === idx
            ? {
                ...g,
                title: patch.title?.trim() || g.title,
                notes: patch.notes !== undefined ? patch.notes : g.notes,
                status:
                  patch.status === 'active' ||
                  patch.status === 'paused' ||
                  patch.status === 'completed'
                    ? patch.status
                    : g.status,
                milestones: [...g.milestones, ...extraMs],
                updatedAt: nowHHMM(),
              }
            : g
        );
        summary.updatedGoals += 1;
      }
    }

    if (Array.isArray(payload.deleteGoalIds) && payload.deleteGoalIds.length > 0) {
      const targets = payload.deleteGoalIds.map(String);
      const before = nextGoals.length;
      nextGoals = nextGoals.filter((g) => !matchesIdentifierOrTitle(g.id, g.title, targets));
      summary.deletedGoals += before - nextGoals.length;
    }

    if (Array.isArray(payload.completeMilestoneMatches) && payload.completeMilestoneMatches.length > 0) {
      for (const rule of payload.completeMilestoneMatches) {
        if (!rule || !rule.milestoneText) continue;
        const targetMs = normTitle(rule.milestoneText);
        const targetDone = rule.done !== undefined ? Boolean(rule.done) : true;
        nextGoals = nextGoals.map((g) => {
          const matchesGoal =
            (!rule.goalId && !rule.goalTitle) ||
            (rule.goalId && g.id === rule.goalId) ||
            (rule.goalTitle && normTitle(g.title).includes(normTitle(rule.goalTitle)));
          if (!matchesGoal) return g;
          let touched = false;
          const nextMs = g.milestones.map((m) => {
            if (normTitle(m.text).includes(targetMs) && m.done !== targetDone) {
              touched = true;
              return { ...m, done: targetDone };
            }
            return m;
          });
          if (touched) {
            summary.updatedGoals += 1;
            return { ...g, updatedAt: nowHHMM(), milestones: nextMs };
          }
          return g;
        });
      }
    }

    if (payload.updateHealth && typeof payload.updateHealth === 'object') {
      const uh = payload.updateHealth;
      if (typeof uh.sleepHours === 'number' && Number.isFinite(uh.sleepHours)) {
        nextHealthLog.sleepHours = Math.max(0, Math.min(16, uh.sleepHours));
        summary.updatedHealth = true;
      }
      if (typeof uh.steps === 'number' && Number.isFinite(uh.steps)) {
        nextHealthLog.steps = Math.max(0, Math.min(100000, Math.round(uh.steps)));
        summary.updatedHealth = true;
      }
      if (typeof uh.waterCups === 'number' && Number.isFinite(uh.waterCups)) {
        nextHealthLog.waterCups = Math.max(0, Math.min(30, Math.round(uh.waterCups)));
        summary.updatedHealth = true;
      }
      if (typeof uh.exerciseMinutes === 'number' && Number.isFinite(uh.exerciseMinutes)) {
        nextHealthLog.exerciseMinutes = Math.max(0, Math.min(480, Math.round(uh.exerciseMinutes)));
        summary.updatedHealth = true;
      }
    }
  }

  // Prune any schedules that already expired
  const pruned = pruneExpiredSchedules(nextReminders, nowMs);
  nextReminders = pruned.items;
  if (pruned.removedIds.length > 0) {
    deletedReminderIds.push(...pruned.removedIds);
  }

  const changed =
    summary.addedBriefings > 0 ||
    summary.deletedBriefings > 0 ||
    summary.addedReminders > 0 ||
    summary.updatedReminders > 0 ||
    summary.deletedReminders > 0 ||
    summary.completedReminders > 0 ||
    summary.addedGoals > 0 ||
    summary.updatedGoals > 0 ||
    summary.deletedGoals > 0 ||
    summary.updatedHealth ||
    pruned.removedIds.length > 0;

  return {
    nextBriefings,
    nextReminders,
    nextGoals,
    nextHealthLog,
    addedReminderItems,
    updatedReminderItems,
    deletedReminderIds: Array.from(new Set(deletedReminderIds)),
    summary,
    changed,
  };
}

export function formatSyncToast(summary: AppliedSyncSummary): string {
  const parts: string[] = [];
  if (summary.addedBriefings > 0) parts.push(`新增 ${summary.addedBriefings} 条汇报`);
  if (summary.deletedBriefings > 0) parts.push(`删除 ${summary.deletedBriefings} 条汇报`);
  if (summary.addedReminders > 0) parts.push(`新增 ${summary.addedReminders} 条提醒`);
  if (summary.updatedReminders > 0) parts.push(`修改 ${summary.updatedReminders} 条提醒`);
  if (summary.deletedReminders > 0) parts.push(`删除 ${summary.deletedReminders} 条提醒`);
  if (summary.completedReminders > 0) parts.push(`完成 ${summary.completedReminders} 条提醒`);
  if (summary.addedGoals > 0) parts.push(`新增 ${summary.addedGoals} 个目标`);
  if (summary.updatedGoals > 0) parts.push(`更新 ${summary.updatedGoals} 个目标`);
  if (summary.deletedGoals > 0) parts.push(`删除 ${summary.deletedGoals} 个目标`);
  if (summary.updatedHealth) parts.push('健康记录');
  return parts.length > 0 ? `已自动同步：${parts.join('、')}` : '';
}
