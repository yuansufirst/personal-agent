import type {
  AgentAppSyncPayload,
  BriefingItem,
  GoalItem,
  HealthConfig,
  HealthDailyLog,
  InteractiveCard,
  ReminderItem,
} from '../types/relay';

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
 * so the cloud Agent always knows the user's latest Goals, Reminders, Feed items,
 * and completion states without the user needing to click any button.
 */
export function buildAppStateContextHeader(input: AppStateSnapshotInput): string {
  const { goals, reminders, briefings, healthLog, healthConfig } = input;

  const pendingReminders = reminders.filter((r) => !r.completed);
  const doneReminders = reminders.filter((r) => r.completed);

  const lines: string[] = [
    `[Relay App 自动状态同步 · ${new Date().toLocaleString('zh-CN', { hour12: false })}]`,
  ];

  // Reminders / Schedule
  if (pendingReminders.length > 0) {
    lines.push(
      `待完成提醒(${pendingReminders.length}): ` +
        pendingReminders
          .slice(0, 10)
          .map((r) => `[ ] ${r.title} (${r.dueLabel}, id:${r.id}${r.priority === 'high' ? ', 重要' : ''})`)
          .join(' | ')
    );
  } else {
    lines.push('待完成提醒(0): 无');
  }

  if (doneReminders.length > 0) {
    lines.push(
      `已完成提醒(${doneReminders.length}): ` +
        doneReminders
          .slice(0, 6)
          .map((r) => `[x] ${r.title}`)
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

  // Recent Feeds / Briefings (so agent avoids duplicates and knows bookmarked items)
  if (briefings.length > 0) {
    lines.push(
      `已有简报(${briefings.length}, 收藏${briefings.filter((b) => b.saved).length}): ` +
        briefings
          .slice(0, 5)
          .map((b) => `${b.saved ? '★' : ''}${b.title.slice(0, 28)}`)
          .join(' | ')
    );
  }

  // Today's health snapshot
  lines.push(
    `今日健康(${healthLog.dateKey}): 睡眠 ${healthLog.sleepHours.toFixed(1)}/${healthConfig.sleepGoalHours}h, 步数 ${healthLog.steps}/${healthConfig.stepsGoal}, 饮水 ${healthLog.waterCups}/${healthConfig.waterGoalCups}杯, 运动 ${healthLog.exerciseMinutes}m`
  );

  lines.push(
    '写入指令: 如需自动向 App 推送新提醒/目标/论文简报或更新完成状态，请在回复末尾附带 ```relay-sync JSON 块（支持 addReminders / completeReminderIds / addGoals / completeMilestoneMatches / addBriefings / updateHealth），前端将自动静默同步，无需用户手动添加。'
  );

  return `${lines.join('\n')}\n---\n`;
}

/**
 * Optional manual trigger prompt when the user taps the explicit "Sync" button.
 */
export function buildManualAppStateSyncPrompt(input: AppStateSnapshotInput): string {
  const pendingRem = input.reminders.filter((r) => !r.completed).length;
  const doneRem = input.reminders.filter((r) => r.completed).length;
  const totalMs = input.goals.reduce((acc, g) => acc + g.milestones.length, 0);
  const doneMs = input.goals.reduce(
    (acc, g) => acc + g.milestones.filter((m) => m.done).length,
    0
  );

  return `请读取我最新的 App 完成情况（待办提醒 ${pendingRem} 条未完成 / ${doneRem} 条已完成；目标里程碑 ${doneMs}/${totalMs} 已完成），根据当前进度帮我更新或推送接下来需要的提醒、目标或简报（请用 \`\`\`relay-sync 或 \`\`\`relay-card 返回，我会直接自动同步进界面）。`;
}

export interface AppliedSyncSummary {
  addedBriefings: number;
  addedReminders: number;
  completedReminders: number;
  addedGoals: number;
  updatedGoals: number;
  updatedHealth: boolean;
}

export interface AppSyncApplyResult {
  nextBriefings: BriefingItem[];
  nextReminders: ReminderItem[];
  nextGoals: GoalItem[];
  nextHealthLog: HealthDailyLog;
  summary: AppliedSyncSummary;
  changed: boolean;
}

/**
 * Applies any structured cards (`briefing`, `reminder`, `goal`) and `relay-sync` payloads
 * automatically into App state without requiring manual user action.
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
  let nextBriefings = [...current.briefings];
  let nextReminders = [...current.reminders];
  let nextGoals = [...current.goals];
  let nextHealthLog = { ...current.healthLog };

  const summary: AppliedSyncSummary = {
    addedBriefings: 0,
    addedReminders: 0,
    completedReminders: 0,
    addedGoals: 0,
    updatedGoals: 0,
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
      nextReminders = [{ ...item, origin: 'agent' }, ...nextReminders];
      summary.addedReminders += 1;
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
      // Merge any new milestones into existing goal
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
      upsertReminder(card.data);
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

    if (Array.isArray(payload.addReminders)) {
      payload.addReminders.forEach((r, idx) => {
        if (!r || typeof r.title !== 'string' || !r.title.trim()) return;
        upsertReminder({
          id: r.id || `rem-ag-${Date.now().toString(36)}-${idx}`,
          title: r.title.trim(),
          dueLabel: r.dueLabel?.trim() || `今天 ${nowHHMM()}`,
          dayGroup:
            r.dayGroup === 'tomorrow' || r.dayGroup === 'week' ? r.dayGroup : 'today',
          priority: r.priority === 'high' ? 'high' : 'normal',
          channel:
            r.channel === 'browser' || r.channel === 'app' ? r.channel : 'ntfy',
          completed: false,
          note: r.note,
          repeat: r.repeat,
          origin: 'agent',
        });
      });
    }

    if (Array.isArray(payload.completeReminderIds) && payload.completeReminderIds.length > 0) {
      const targetSet = new Set(payload.completeReminderIds.map((x) => normTitle(String(x))));
      nextReminders = nextReminders.map((r) => {
        if (!r.completed && (targetSet.has(normTitle(r.id)) || targetSet.has(normTitle(r.title)))) {
          summary.completedReminders += 1;
          return { ...r, completed: true };
        }
        return r;
      });
    }

    if (Array.isArray(payload.deleteReminderIds) && payload.deleteReminderIds.length > 0) {
      const delSet = new Set(payload.deleteReminderIds.map((x) => normTitle(String(x))));
      nextReminders = nextReminders.filter(
        (r) => !delSet.has(normTitle(r.id)) && !delSet.has(normTitle(r.title))
      );
    }

    if (Array.isArray(payload.addGoals)) {
      payload.addGoals.forEach((g, idx) => {
        if (!g || typeof g.title !== 'string' || !g.title.trim()) return;
        const milestones = Array.isArray(g.milestones)
          ? g.milestones
              .map((m, mIdx) => {
                if (typeof m === 'string') {
                  return m.trim()
                    ? { id: `ms-ag-${Date.now().toString(36)}-${idx}-${mIdx}`, text: m.trim(), done: false }
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

  const changed =
    summary.addedBriefings > 0 ||
    summary.addedReminders > 0 ||
    summary.completedReminders > 0 ||
    summary.addedGoals > 0 ||
    summary.updatedGoals > 0 ||
    summary.updatedHealth;

  return {
    nextBriefings,
    nextReminders,
    nextGoals,
    nextHealthLog,
    summary,
    changed,
  };
}

export function formatSyncToast(summary: AppliedSyncSummary): string {
  const parts: string[] = [];
  if (summary.addedBriefings > 0) parts.push(`${summary.addedBriefings} 条汇报`);
  if (summary.addedReminders > 0) parts.push(`${summary.addedReminders} 条提醒`);
  if (summary.completedReminders > 0) parts.push(`完成 ${summary.completedReminders} 条提醒`);
  if (summary.addedGoals > 0) parts.push(`${summary.addedGoals} 个目标`);
  if (summary.updatedGoals > 0) parts.push(`更新 ${summary.updatedGoals} 个目标`);
  if (summary.updatedHealth) parts.push('健康记录');
  return parts.length > 0 ? `已自动同步：${parts.join('、')}` : '';
}
