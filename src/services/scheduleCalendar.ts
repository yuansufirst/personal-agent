import type { ReminderItem } from '../types/relay';
import type { DeviceCalendarEvent } from './deviceBridge';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime();
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function normTitle(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function computeDayGroupFromMs(
  startAtMs: number,
  nowMs = Date.now()
): 'today' | 'tomorrow' | 'week' {
  const todayStart = startOfLocalDay(nowMs);
  const targetDayStart = startOfLocalDay(startAtMs);
  const diffDays = Math.round((targetDayStart - todayStart) / ONE_DAY_MS);
  if (diffDays <= 0) return 'today';
  if (diffDays === 1) return 'tomorrow';
  return 'week';
}

export function formatCalendarDueLabel(
  startAtMs: number,
  endAtMs?: number,
  allDay?: boolean,
  nowMs = Date.now()
): string {
  const start = new Date(startAtMs);
  const todayStart = startOfLocalDay(nowMs);
  const targetDayStart = startOfLocalDay(startAtMs);
  const diffDays = Math.round((targetDayStart - todayStart) / ONE_DAY_MS);

  const dayPrefix =
    diffDays === 0
      ? '今天'
      : diffDays === 1
        ? '明天'
        : diffDays === 2
          ? '后天'
          : `${start.getMonth() + 1}月${start.getDate()}日`;

  if (allDay) {
    return `${dayPrefix} 全天`;
  }

  const startHHMM = `${pad2(start.getHours())}:${pad2(start.getMinutes())}`;
  if (
    typeof endAtMs === 'number' &&
    Number.isFinite(endAtMs) &&
    endAtMs > startAtMs + 60_000
  ) {
    const end = new Date(endAtMs);
    const sameDay = startOfLocalDay(endAtMs) === targetDayStart;
    const endHHMM = `${pad2(end.getHours())}:${pad2(end.getMinutes())}`;
    if (sameDay) {
      return `${dayPrefix} ${startHHMM}–${endHHMM}`;
    }
    return `${dayPrefix} ${startHHMM} – ${end.getMonth() + 1}月${end.getDate()}日 ${endHHMM}`;
  }

  return `${dayPrefix} ${startHHMM}`;
}

function resolveChineseWeekdayOffset(ch: string, currentDow: number): number {
  const map: Record<string, number> = {
    日: 0,
    天: 0,
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
  };
  const target = map[ch];
  if (target === undefined) return 0;
  let diff = target - currentDow;
  if (diff < 0) diff += 7;
  return diff;
}

export interface ParsedScheduleTiming {
  startAtMs?: number;
  endAtMs?: number;
  allDay?: boolean;
  dayGroup: 'today' | 'tomorrow' | 'week';
  dueLabel: string;
}

/**
 * Parses structured timestamps, ISO strings, or natural Chinese/24h time labels
 * into real calendar timestamps so schedules follow real calendar time.
 */
export function parseScheduleTiming(
  input: {
    startAtMs?: number;
    endAtMs?: number;
    startTime?: string;
    endTime?: string;
    dueLabel?: string;
    dayGroup?: 'today' | 'tomorrow' | 'week';
    allDay?: boolean;
  },
  nowMs = Date.now()
): ParsedScheduleTiming {
  let startAtMs: number | undefined =
    typeof input.startAtMs === 'number' && Number.isFinite(input.startAtMs) && input.startAtMs > 0
      ? input.startAtMs
      : undefined;
  let endAtMs: number | undefined =
    typeof input.endAtMs === 'number' && Number.isFinite(input.endAtMs) && input.endAtMs > 0
      ? input.endAtMs
      : undefined;
  let allDay = Boolean(input.allDay);

  if (startAtMs === undefined && typeof input.startTime === 'string' && input.startTime.trim()) {
    const parsed = Date.parse(input.startTime.trim());
    if (Number.isFinite(parsed)) {
      startAtMs = parsed;
    }
  }
  if (endAtMs === undefined && typeof input.endTime === 'string' && input.endTime.trim()) {
    const parsed = Date.parse(input.endTime.trim());
    if (Number.isFinite(parsed)) {
      endAtMs = parsed;
    }
  }

  const rawLabel = (input.dueLabel || '').trim();

  if (startAtMs === undefined && rawLabel) {
    const now = new Date(nowMs);
    const cleaned = rawLabel.replace(/（已延后.*?）/g, '').trim();

    // 1. Full date YYYY-MM-DD or YYYY/MM/DD [HH:mm [- HH:mm]]
    const fullDateMatch = cleaned.match(
      /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:\s+(\d{1,2})[:：](\d{2})(?:\s*[-~–到]\s*(\d{1,2})[:：](\d{2}))?)?/
    );
    if (fullDateMatch) {
      const year = Number(fullDateMatch[1]);
      const month = Number(fullDateMatch[2]) - 1;
      const day = Number(fullDateMatch[3]);
      if (fullDateMatch[4] !== undefined) {
        const sh = Number(fullDateMatch[4]);
        const sm = Number(fullDateMatch[5]);
        startAtMs = new Date(year, month, day, sh, sm, 0, 0).getTime();
        if (fullDateMatch[6] !== undefined) {
          const eh = Number(fullDateMatch[6]);
          const em = Number(fullDateMatch[7]);
          endAtMs = new Date(year, month, day, eh, em, 0, 0).getTime();
        }
      } else {
        allDay = true;
        startAtMs = new Date(year, month, day, 0, 0, 0, 0).getTime();
        endAtMs = new Date(year, month, day, 23, 59, 59, 999).getTime();
      }
    }

    // 2. Month-Day: 11-28 15:00 or 11月28日 15:00-16:30
    if (startAtMs === undefined) {
      const mdMatch = cleaned.match(
        /(\d{1,2})(?:[-/月])(\d{1,2})日?(?:\s*(\d{1,2})[:：](\d{2})(?:\s*[-~–到]\s*(\d{1,2})[:：](\d{2}))?)?/
      );
      if (mdMatch) {
        const month = Number(mdMatch[1]) - 1;
        const day = Number(mdMatch[2]);
        if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
          const year = now.getFullYear();
          if (mdMatch[3] !== undefined) {
            const sh = Number(mdMatch[3]);
            const sm = Number(mdMatch[4]);
            startAtMs = new Date(year, month, day, sh, sm, 0, 0).getTime();
            if (mdMatch[5] !== undefined) {
              const eh = Number(mdMatch[5]);
              const em = Number(mdMatch[6]);
              endAtMs = new Date(year, month, day, eh, em, 0, 0).getTime();
            }
          } else {
            allDay = true;
            startAtMs = new Date(year, month, day, 0, 0, 0, 0).getTime();
            endAtMs = new Date(year, month, day, 23, 59, 59, 999).getTime();
          }
        }
      }
    }

    // 3. Relative Chinese label + time: 今天 14:30 / 明天 09:00-10:30 / 周三 15:00 / 20:00
    if (startAtMs === undefined) {
      const relMatch = cleaned.match(
        /(今天|今日|今晚|明天|明日|后天|下?周([一二三四五六日天])|星期([一二三四五六日天])|本周)?\s*(\d{1,2})[:：](\d{2})(?:\s*[-~–到]\s*(\d{1,2})[:：](\d{2}))?/
      );
      if (relMatch) {
        const prefix = relMatch[1] || '';
        const wkCh = relMatch[2] || relMatch[3] || '';
        const sh = Number(relMatch[4]);
        const sm = Number(relMatch[5]);
        if (sh >= 0 && sh <= 23 && sm >= 0 && sm <= 59) {
          let dayOffset = 0;
          if (prefix === '明天' || prefix === '明日') {
            dayOffset = 1;
          } else if (prefix === '后天') {
            dayOffset = 2;
          } else if (wkCh) {
            dayOffset = resolveChineseWeekdayOffset(wkCh, now.getDay());
            if (prefix.startsWith('下周') && dayOffset < 7) {
              dayOffset += 7;
            }
          } else if (!prefix && input.dayGroup === 'tomorrow') {
            dayOffset = 1;
          } else if (prefix === '本周' || (!prefix && input.dayGroup === 'week')) {
            dayOffset = 2;
          }

          const base = new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate() + dayOffset,
            sh,
            sm,
            0,
            0
          );
          startAtMs = base.getTime();

          if (relMatch[6] !== undefined) {
            const eh = Number(relMatch[6]);
            const em = Number(relMatch[7]);
            if (eh >= 0 && eh <= 23 && em >= 0 && em <= 59) {
              const endDate = new Date(
                base.getFullYear(),
                base.getMonth(),
                base.getDate(),
                eh,
                em,
                0,
                0
              );
              endAtMs =
                endDate.getTime() > startAtMs
                  ? endDate.getTime()
                  : endDate.getTime() + ONE_DAY_MS;
            }
          }
        }
      }
    }

    // 4. All-day relative labels: 今天 全天 / 明天 全天 / 后天 全天
    if (startAtMs === undefined && /全天/.test(cleaned)) {
      let dayOffset = 0;
      if (/明天|明日/.test(cleaned)) dayOffset = 1;
      else if (/后天/.test(cleaned)) dayOffset = 2;
      allDay = true;
      startAtMs = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + dayOffset,
        0,
        0,
        0,
        0
      ).getTime();
      endAtMs = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + dayOffset,
        23,
        59,
        59,
        999
      ).getTime();
    }
  }

  if (startAtMs !== undefined && Number.isFinite(startAtMs)) {
    if (endAtMs !== undefined && endAtMs < startAtMs) {
      endAtMs = startAtMs;
    }
    const dayGroup = computeDayGroupFromMs(startAtMs, nowMs);
    const dueLabel = formatCalendarDueLabel(startAtMs, endAtMs, allDay, nowMs);
    return {
      startAtMs,
      endAtMs,
      allDay: allDay || undefined,
      dayGroup,
      dueLabel,
    };
  }

  const fallbackDayGroup: 'today' | 'tomorrow' | 'week' =
    input.dayGroup === 'tomorrow' || input.dayGroup === 'week' ? input.dayGroup : 'today';
  return {
    dayGroup: fallbackDayGroup,
    dueLabel: rawLabel || (fallbackDayGroup === 'tomorrow' ? '明天' : fallbackDayGroup === 'week' ? '本周' : '今天'),
  };
}

function getEffectiveExpiryMs(item: ReminderItem, nowMs: number): number | undefined {
  if (typeof item.endAtMs === 'number' && Number.isFinite(item.endAtMs) && item.endAtMs > 0) {
    return item.endAtMs;
  }
  if (typeof item.startAtMs === 'number' && Number.isFinite(item.startAtMs) && item.startAtMs > 0) {
    return item.startAtMs;
  }
  const parsed = parseScheduleTiming({ dueLabel: item.dueLabel, dayGroup: item.dayGroup }, nowMs);
  return parsed.endAtMs ?? parsed.startAtMs;
}

function rollRepeatingForward(item: ReminderItem, nowMs: number): ReminderItem {
  const start = item.startAtMs;
  if (!start || !Number.isFinite(start)) return item;
  const duration =
    typeof item.endAtMs === 'number' && item.endAtMs > start ? item.endAtMs - start : 0;
  const stepMs = /每周|每星期|周[一二三四五六日天]/.test(item.repeat || '')
    ? 7 * ONE_DAY_MS
    : ONE_DAY_MS;
  let nextStart = start;
  let guard = 0;
  while (nextStart + duration < nowMs && guard < 400) {
    nextStart += stepMs;
    guard += 1;
  }
  const nextEnd = duration > 0 ? nextStart + duration : undefined;
  return {
    ...item,
    completed: false,
    startAtMs: nextStart,
    endAtMs: nextEnd,
    dayGroup: computeDayGroupFromMs(nextStart, nowMs),
    dueLabel: formatCalendarDueLabel(nextStart, nextEnd, item.allDay, nowMs),
  };
}

/**
 * Checks whether a schedule/reminder has passed its calendar time.
 * Repeating items do not expire (they roll forward).
 */
export function isScheduleExpired(item: ReminderItem, nowMs = Date.now()): boolean {
  if (item.repeat && item.repeat.trim()) return false;
  const expiryMs = getEffectiveExpiryMs(item, nowMs);
  if (expiryMs === undefined) return false;
  return nowMs > expiryMs;
}

/**
 * Removes schedules whose calendar time has already passed, rolls repeating
 * reminders forward, refreshes dynamic dayGroup/dueLabel, and sorts by start time.
 */
export function pruneExpiredSchedules(
  items: ReminderItem[],
  nowMs = Date.now()
): { items: ReminderItem[]; removedIds: string[]; changed: boolean } {
  const removedIds: string[] = [];
  const next: ReminderItem[] = [];
  let changed = false;

  for (const raw of items) {
    // Hydrate missing startAtMs from dueLabel once if parseable
    let item = raw;
    if (item.startAtMs === undefined && item.dueLabel) {
      const parsed = parseScheduleTiming(
        { dueLabel: item.dueLabel, dayGroup: item.dayGroup, allDay: item.allDay },
        nowMs
      );
      if (parsed.startAtMs !== undefined) {
        item = {
          ...item,
          startAtMs: parsed.startAtMs,
          endAtMs: parsed.endAtMs,
          allDay: parsed.allDay,
          dayGroup: parsed.dayGroup,
          dueLabel: parsed.dueLabel,
        };
        changed = true;
      }
    }

    // Roll repeating reminders to next occurrence once past
    if (item.repeat && item.repeat.trim() && item.startAtMs !== undefined) {
      const expiry = item.endAtMs ?? item.startAtMs;
      if (nowMs > expiry) {
        const rolled = rollRepeatingForward(item, nowMs);
        next.push(rolled);
        changed = true;
        continue;
      }
    }

    // Auto-remove non-repeating schedules/reminders once their calendar time has passed
    if (isScheduleExpired(item, nowMs)) {
      removedIds.push(item.id);
      changed = true;
      continue;
    }

    // Keep dynamic relative labels ("今天" / "明天") and dayGroup accurate as days advance
    if (item.startAtMs !== undefined) {
      const freshGroup = computeDayGroupFromMs(item.startAtMs, nowMs);
      const freshLabel = formatCalendarDueLabel(item.startAtMs, item.endAtMs, item.allDay, nowMs);
      if (freshGroup !== item.dayGroup || freshLabel !== item.dueLabel) {
        item = { ...item, dayGroup: freshGroup, dueLabel: freshLabel };
        changed = true;
      }
    }

    next.push(item);
  }

  // Sort upcoming items chronologically (timed items first by startAtMs ascending)
  const sorted = [...next].sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    const ta = a.startAtMs ?? Number.MAX_SAFE_INTEGER;
    const tb = b.startAtMs ?? Number.MAX_SAFE_INTEGER;
    if (ta !== tb) return ta - tb;
    return 0;
  });

  if (!changed && sorted.length === items.length) {
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i].id !== items[i].id) {
        changed = true;
        break;
      }
    }
  }

  return { items: sorted, removedIds, changed };
}

/**
 * Merges real Android CalendarContract events into the schedule list,
 * replacing stale calendar entries, deduplicating against manual/agent entries,
 * and pruning any expired events.
 */
export function mergeSystemCalendarEvents(
  existing: ReminderItem[],
  calendarEvents: DeviceCalendarEvent[],
  nowMs = Date.now()
): { items: ReminderItem[]; removedIds: string[]; syncedCount: number; changed: boolean } {
  const prevCalendarByKey = new Map<string, ReminderItem>();
  const nonCalendarItems: ReminderItem[] = [];

  for (const item of existing) {
    if (item.source === 'calendar' || item.origin === 'calendar') {
      const key = item.calendarEventId
        ? `${item.calendarEventId}:${item.startAtMs ?? 0}`
        : item.id;
      prevCalendarByKey.set(key, item);
    } else {
      nonCalendarItems.push(item);
    }
  }

  const upcomingEvents = calendarEvents.filter((ev) => {
    const end = ev.endMs > 0 ? ev.endMs : ev.startMs;
    return end > nowMs;
  });

  const calendarItems: ReminderItem[] = upcomingEvents.map((ev) => {
    const key = `${ev.id}:${ev.startMs}`;
    const prev = prevCalendarByKey.get(key);
    const endMs = ev.endMs > ev.startMs ? ev.endMs : ev.startMs;
    return {
      id: prev?.id || `cal-${ev.id}-${ev.startMs}`,
      title: ev.title?.trim() || '（无标题日程）',
      dueLabel: formatCalendarDueLabel(ev.startMs, endMs, ev.allDay, nowMs),
      dayGroup: computeDayGroupFromMs(ev.startMs, nowMs),
      startAtMs: ev.startMs,
      endAtMs: endMs,
      allDay: ev.allDay || undefined,
      location: ev.location?.trim() || undefined,
      calendarEventId: ev.id,
      source: 'calendar',
      origin: 'calendar',
      priority: prev?.priority || 'normal',
      channel: 'app',
      completed: prev?.completed ?? false,
      note:
        ev.description?.trim() ||
        (ev.location?.trim() ? `地点：${ev.location.trim()}` : ev.calendarName || undefined),
    };
  });

  // Deduplicate manual/agent entries that match an existing system calendar event
  const dedupedNonCalendar = nonCalendarItems.filter((item) => {
    return !calendarItems.some((cal) => {
      if (item.calendarEventId && cal.calendarEventId === item.calendarEventId) {
        return true;
      }
      if (
        normTitle(item.title) === normTitle(cal.title) &&
        item.startAtMs !== undefined &&
        cal.startAtMs !== undefined &&
        Math.abs(item.startAtMs - cal.startAtMs) <= 10 * 60_000
      ) {
        return true;
      }
      return false;
    });
  });

  const combined = [...calendarItems, ...dedupedNonCalendar];
  const pruned = pruneExpiredSchedules(combined, nowMs);

  // Track any old calendar IDs that vanished (either ended or deleted in system calendar)
  const nextIdSet = new Set(pruned.items.map((i) => i.id));
  const vanishedIds = existing
    .filter((i) => !nextIdSet.has(i.id))
    .map((i) => i.id);
  const allRemoved = Array.from(new Set([...pruned.removedIds, ...vanishedIds]));

  const changed =
    pruned.changed ||
    allRemoved.length > 0 ||
    pruned.items.length !== existing.length ||
    pruned.items.some((item, idx) => {
      const old = existing[idx];
      return (
        !old ||
        old.id !== item.id ||
        old.title !== item.title ||
        old.dueLabel !== item.dueLabel ||
        old.startAtMs !== item.startAtMs ||
        old.endAtMs !== item.endAtMs
      );
    });

  return {
    items: pruned.items,
    removedIds: allRemoved,
    syncedCount: calendarItems.length,
    changed,
  };
}
