export type TabKey = 'chat' | 'research' | 'health' | 'goals' | 'space';

export type ConnectionMode = 'sandbox' | 'dsh-bridge' | 'openai-compatible';

export interface AgentProfile {
  name: string;
  subtitle: string;
  avatarId: string; // 'muse-pearl' | 'amber-dawn' | 'emerald-glass' | 'obsidian-ring' | 'custom'
  customAvatarUrl?: string;
}

export interface ResearchItem {
  id: string;
  title: string;
  category: 'paper' | 'experiment' | 'idea';
  status: 'reading' | 'running' | 'writing' | 'archived';
  progress: number; // 0 - 100
  venueOrSource?: string;
  url?: string;
  notes: string;
  updatedAt: string;
}

export interface HealthConfig {
  sleepGoalHours: number; // e.g. 7.5
  bedtimeTarget: string; // e.g. '23:30'
  wakeTarget: string; // e.g. '07:00'
  stepsGoal: number; // e.g. 8000
  waterGoalCups: number; // e.g. 8
  exerciseGoalMinutes: number; // e.g. 30
  autoRemindBedtime: boolean;
}

export interface HealthDailyLog {
  dateKey: string; // YYYY-MM-DD
  sleepHours: number;
  steps: number;
  waterCups: number;
  exerciseMinutes: number;
}

export type DeviceCapabilityKey =
  | 'time'
  | 'clipboard'
  | 'calendar'
  | 'alarm'
  | 'notifications'
  | 'postNotifications'
  | 'sms'
  | 'location'
  | 'files';

export interface DeviceContextConfig {
  autoAttachTime: boolean;
  autoAttachCalendar: boolean;
  autoAttachClipboard: boolean;
  autoAttachLocation: boolean;
  autoAttachNotifications: boolean;
  autoSyncAppState?: boolean;
}

export type DeviceActionKind =
  | 'set_alarm'
  | 'set_timer'
  | 'add_calendar_event'
  | 'write_clipboard'
  | 'save_file'
  | 'send_notification'
  | 'read_clipboard'
  | 'read_calendar'
  | 'read_notifications'
  | 'read_sms'
  | 'get_location'
  | 'list_files';

export interface DeviceActionItem {
  id: string;
  action: DeviceActionKind;
  title: string;
  summary: string;
  params: Record<string, unknown>;
  status: 'pending' | 'executed' | 'failed';
  resultText?: string;
}

export interface ConnectionConfig {
  mode: ConnectionMode;
  serverUrl: string;
  wsEndpoint: string;
  token: string;
  model: string;
  workspace: string;
  rpcMethod?: string;
  sessionId?: string;
  ntfyUrl: string;
  ntfyTopic: string;
}

export interface BriefingItem {
  id: string;
  kind: 'paper' | 'news';
  title: string;
  source: string;
  identifier?: string;
  publishedAt: string;
  readMinutes: number;
  imageUrl?: string;
  summary: string;
  takeaways: string[];
  relevanceNote: string;
  saved: boolean;
  url: string;
  origin?: 'agent' | 'user';
}

export interface ReminderItem {
  id: string;
  title: string;
  dueLabel: string;
  dayGroup: 'today' | 'tomorrow' | 'week';
  startAtMs?: number;
  endAtMs?: number;
  allDay?: boolean;
  location?: string;
  calendarEventId?: string;
  source?: 'calendar' | 'reminder';
  repeat?: string;
  priority: 'normal' | 'high';
  channel: 'app' | 'browser' | 'ntfy';
  completed: boolean;
  note?: string;
  origin?: 'agent' | 'user' | 'calendar';
}

export interface GoalMilestone {
  id: string;
  text: string;
  done: boolean;
}

export interface GoalItem {
  id: string;
  title: string;
  notes?: string;
  status: 'active' | 'paused' | 'completed';
  milestones: GoalMilestone[];
  updatedAt: string;
  origin?: 'agent' | 'user';
}

export interface AgentAppSyncPayload {
  addReminders?: Array<{
    id?: string;
    title: string;
    dueLabel?: string;
    startAtMs?: number;
    endAtMs?: number;
    startTime?: string;
    endTime?: string;
    allDay?: boolean;
    location?: string;
    isCalendarEvent?: boolean;
    dayGroup?: 'today' | 'tomorrow' | 'week';
    priority?: 'normal' | 'high';
    channel?: 'app' | 'browser' | 'ntfy';
    note?: string;
    repeat?: string;
  }>;
  updateReminders?: Array<{
    id?: string;
    matchTitle?: string;
    title?: string;
    dueLabel?: string;
    startAtMs?: number;
    endAtMs?: number;
    startTime?: string;
    endTime?: string;
    allDay?: boolean;
    location?: string;
    dayGroup?: 'today' | 'tomorrow' | 'week';
    priority?: 'normal' | 'high';
    channel?: 'app' | 'browser' | 'ntfy';
    note?: string;
    repeat?: string;
    completed?: boolean;
  }>;
  completeReminderIds?: string[];
  deleteReminderIds?: string[];
  removeReminders?: string[];
  addGoals?: Array<{
    id?: string;
    title: string;
    notes?: string;
    milestones?: Array<string | { id?: string; text: string; done?: boolean }>;
  }>;
  updateGoals?: Array<{
    id?: string;
    matchTitle?: string;
    title?: string;
    notes?: string;
    status?: 'active' | 'paused' | 'completed';
    addMilestones?: string[];
  }>;
  deleteGoalIds?: string[];
  completeMilestoneMatches?: Array<{
    goalId?: string;
    goalTitle?: string;
    milestoneText: string;
    done?: boolean;
  }>;
  addBriefings?: Array<{
    id?: string;
    kind?: 'paper' | 'news';
    title: string;
    source?: string;
    identifier?: string;
    publishedAt?: string;
    readMinutes?: number;
    summary: string;
    takeaways?: string[];
    relevanceNote?: string;
    url?: string;
  }>;
  deleteBriefingIds?: string[];
  updateHealth?: {
    sleepHours?: number;
    steps?: number;
    waterCups?: number;
    exerciseMinutes?: number;
  };
}

export interface ApprovalAction {
  id: string;
  title: string;
  targetDevice: string;
  commandPreview: string;
  impactNote: string;
  status: 'pending' | 'approved' | 'rejected';
  resultOutput?: string;
}

export interface MeshFileItem {
  id: string;
  name: string;
  size: string;
  mimeType?: string;
  sourceNode: 'cloud' | 'pc' | 'android';
  targetNode?: 'cloud' | 'pc' | 'android';
  path: string;
  updatedAt: string;
  status: 'synced' | 'transferring' | 'ready';
  previewText?: string;
  downloadUrl?: string;
  receiptId?: string;
  dataUrl?: string;
  base64Data?: string;
}

export interface MeshNode {
  id: string;
  role: 'cloud' | 'pc' | 'android';
  name: string;
  tailscaleIp: string;
  transport?: 'cloudflare-tunnel' | 'tailscale' | 'local';
  os: string;
  online: boolean;
  latencyMs: number;
  activeService: string;
}

export interface QuickMacro {
  id: string;
  label: string;
  targetRole: 'cloud' | 'pc' | 'android';
  command: string;
  description: string;
}

export interface MapWaypoint {
  label: string;
  lat: number;
  lng: number;
  kind?: 'origin' | 'destination' | 'stop';
  note?: string;
}

export interface MapCardItem {
  id: string;
  title: string;
  address?: string;
  lat: number;
  lng: number;
  zoom?: number;
  coordSystem?: 'gcj02' | 'wgs84';
  origin?: {
    label: string;
    lat: number;
    lng: number;
  };
  waypoints?: MapWaypoint[];
  polyline?: [number, number][];
  travelMode?: 'transit' | 'driving' | 'walking' | 'cycling';
  distanceText?: string;
  durationText?: string;
  routeSummary?: string;
  overview: string;
  highlights?: string[];
  openHours?: string;
}

export type InteractiveCard =
  | { type: 'briefing'; data: BriefingItem }
  | { type: 'reminder'; data: ReminderItem }
  | { type: 'goal'; data: GoalItem }
  | { type: 'approval'; data: ApprovalAction }
  | { type: 'file'; data: MeshFileItem }
  | { type: 'map'; data: MapCardItem }
  | { type: 'device-action'; data: DeviceActionItem };

export interface ChatAttachment {
  name: string;
  size: string;
  sizeBytes?: number;
  mimeType: string;
  dataUrl?: string;
  base64Data?: string;
  rawFile?: File;
  textContent?: string;
  url?: string;
  receiptId?: string;
  sessionId?: string;
  filePath?: string;
  direction?: 'upload' | 'download';
}

export interface AgentToolStep {
  id: string;
  name: string;
  status: 'running' | 'done' | 'error';
  detail?: string;
  output?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  attachments?: ChatAttachment[];
  cards?: InteractiveCard[];
  thinking?: string;
  toolSteps?: AgentToolStep[];
  elapsedMs?: number;
  streaming?: boolean;
  commandUsed?: string;
}

export interface RemoteSessionSummary {
  sessionId: string;
  title: string;
  updatedAt: string;
  preview?: string;
}

export interface SessionRecord {
  id: string;
  remoteSessionId?: string;
  title: string;
  updatedAt: string;
  source: 'remote' | 'local';
  messages: ChatMessage[];
  historyLoaded?: boolean;
}
