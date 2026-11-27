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
  | 'sms'
  | 'location'
  | 'files';

export interface DeviceContextConfig {
  autoAttachTime: boolean;
  autoAttachCalendar: boolean;
  autoAttachClipboard: boolean;
  autoAttachLocation: boolean;
  autoAttachNotifications: boolean;
}

export type DeviceActionKind =
  | 'set_alarm'
  | 'set_timer'
  | 'add_calendar_event'
  | 'write_clipboard'
  | 'save_file'
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
}

export interface ReminderItem {
  id: string;
  title: string;
  dueLabel: string;
  dayGroup: 'today' | 'tomorrow' | 'week';
  repeat?: string;
  priority: 'normal' | 'high';
  channel: 'app' | 'browser' | 'ntfy';
  completed: boolean;
  note?: string;
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
  sourceNode: 'cloud' | 'pc' | 'android';
  targetNode?: 'cloud' | 'pc' | 'android';
  path: string;
  updatedAt: string;
  status: 'synced' | 'transferring' | 'ready';
  previewText?: string;
}

export interface MeshNode {
  id: string;
  role: 'cloud' | 'pc' | 'android';
  name: string;
  tailscaleIp: string;
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

export type InteractiveCard =
  | { type: 'briefing'; data: BriefingItem }
  | { type: 'reminder'; data: ReminderItem }
  | { type: 'approval'; data: ApprovalAction }
  | { type: 'file'; data: MeshFileItem }
  | { type: 'device-action'; data: DeviceActionItem };

export interface ChatAttachment {
  name: string;
  size: string;
  mimeType: string;
  dataUrl?: string;
  base64Data?: string;
  textContent?: string;
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
