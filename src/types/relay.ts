export type TabKey = 'chat' | 'briefings' | 'mesh' | 'reminders';

export type ConnectionMode = 'sandbox' | 'dsh-bridge' | 'openai-compatible';

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
  | { type: 'file'; data: MeshFileItem };

export interface ChatAttachment {
  name: string;
  size: string;
  mimeType: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  attachments?: ChatAttachment[];
  cards?: InteractiveCard[];
  streaming?: boolean;
  commandUsed?: string;
}
