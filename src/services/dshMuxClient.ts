import type {
  AgentToolStep,
  ChatAttachment,
  ChatMessage,
  ConnectionConfig,
  RemoteSessionSummary,
} from '../types/relay';
import { extractRelayCards, type AgentReplyChunk } from './agentClient';
import { createDshWebSocket, type DshWebSocketLike } from './nativeSocket';

/**
 * DeepSeek Harness (/api/remote.mux) stream-protocol.ts frames
 * packages/api/gateway/src/stream-protocol.ts
 */
export interface DshRemoteStreamOpenFrame {
  type: 'open';
  streamId: string;
  endpoint: string;
  payload: {
    args: Record<string, unknown>;
  };
}

export interface DshRemoteStreamCancelFrame {
  type: 'cancel';
  streamId: string;
}

export interface DshWsTestResult {
  ok: boolean;
  wsUrl: string;
  latencyMs: number;
  message: string;
  rawFrame?: string;
}

// Cache auto-created dsh sessionId per server+workspace across chat turns
const sessionCache = new Map<string, string>();
// Remember which HTTP unary base path worked (`/api/remote/` vs `/api/`)
const unaryPrefixCache = new Map<string, string>();

const SESSION_STORE_PREFIX = 'relay.dsh.session.';

function loadStoredSession(cacheKey: string): string {
  try {
    return window.localStorage.getItem(SESSION_STORE_PREFIX + cacheKey) || '';
  } catch {
    return '';
  }
}

function storeSession(cacheKey: string, sessionId: string): void {
  try {
    window.localStorage.setItem(SESSION_STORE_PREFIX + cacheKey, sessionId);
  } catch {
    // ignore quota/private-mode errors
  }
}

export function resetDshSession(config?: ConnectionConfig): void {
  if (!config) {
    sessionCache.clear();
    try {
      for (const key of Object.keys(window.localStorage)) {
        if (key.startsWith(SESSION_STORE_PREFIX)) window.localStorage.removeItem(key);
      }
    } catch {
      // ignore
    }
    return;
  }
  const cacheKey = `${config.serverUrl.trim()}::${config.workspace.trim()}`;
  sessionCache.delete(cacheKey);
  try {
    window.localStorage.removeItem(SESSION_STORE_PREFIX + cacheKey);
  } catch {
    // ignore
  }
}

export function buildDshWsUrl(serverUrl: string, wsEndpoint: string): string {
  const rawBase = serverUrl.trim().replace(/\/+$/, '');
  if (!rawBase) return '';

  const wsBase = rawBase
    .replace(/^https:\/\//i, 'wss://')
    .replace(/^http:\/\//i, 'ws://');

  const cleanPath = wsEndpoint.trim()
    ? wsEndpoint.trim().startsWith('/')
      ? wsEndpoint.trim()
      : `/${wsEndpoint.trim()}`
    : '/api/remote.mux';

  if (wsBase.endsWith(cleanPath)) {
    return wsBase;
  }
  return `${wsBase}${cleanPath}`;
}

export function mintStreamId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `stream-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function getClientTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai';
  } catch {
    return 'Asia/Shanghai';
  }
}

function parseErrorMessage(rawError: unknown): string {
  if (typeof rawError === 'string') return rawError;
  if (rawError && typeof rawError === 'object') {
    const obj = rawError as Record<string, unknown>;
    if (typeof obj.message === 'string') return obj.message;
    if (obj.error) return parseErrorMessage(obj.error);
  }
  try {
    return JSON.stringify(rawError);
  } catch {
    return String(rawError);
  }
}

function findSessionIdInPayload(val: unknown): string | undefined {
  if (!val || typeof val !== 'object') return undefined;
  const obj = val as Record<string, unknown>;
  if (typeof obj.sessionId === 'string' && obj.sessionId) return obj.sessionId;
  if (typeof obj.id === 'string' && obj.id) return obj.id;
  for (const key of ['session', 'result', 'data', 'payload', 'value']) {
    if (obj[key] && typeof obj[key] === 'object') {
      const nested = findSessionIdInPayload(obj[key]);
      if (nested) return nested;
    }
  }
  return undefined;
}

/**
 * Calls a Typert Gateway unary Remote method over HTTP POST (never sends Authorization).
 * Automatically discovers whether the host mounts unary routes at `/api/remote/<endpoint>`
 * or `/api/<endpoint>`, and handles both plain `{ args }` and `{ type: "client-request", ... }`.
 */
async function callDshHttpUnary(
  config: ConnectionConfig,
  endpoint: string,
  args: Record<string, unknown>,
  signal?: AbortSignal
): Promise<unknown> {
  const base = config.serverUrl.trim().replace(/\/+$/, '');
  const cleanEndpoint = endpoint.replace(/^\/+/, '');
  const cachedPrefix = unaryPrefixCache.get(base);
  const candidatePrefixes = cachedPrefix
    ? [cachedPrefix, cachedPrefix === '/api' ? '/api/remote' : '/api']
    : ['/api', '/api/remote'];

  let lastErr: Error | null = null;

  for (const prefix of candidatePrefixes) {
    const url = `${base}${prefix}/${cleanEndpoint}`;
    const body = {
      type: 'client-request',
      rpcId: mintStreamId(),
      method: cleanEndpoint,
      payload: { args },
    };

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw err;
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `HTTP POST ${url} 无法访问（${msg}）。请确认已连接 Tailscale 且反代允许 CORS。`
      );
    }

    const rawText = await res.text();
    let parsed: unknown = rawText;
    try {
      parsed = rawText ? JSON.parse(rawText) : null;
    } catch {
      // keep raw text
    }

    if (res.status === 404 || res.status === 405) {
      lastErr = new Error(`HTTP ${res.status} (${url})`);
      continue;
    }

    const unwrapEnvelope = (node: unknown): unknown => {
      if (!node || typeof node !== 'object') return node;
      const obj = node as Record<string, unknown>;

      if (obj.type === 'server-response' && obj.payload !== undefined) {
        return unwrapEnvelope(obj.payload);
      }
      if (obj.ok === false || obj.error) {
        const errObj = obj.error ?? obj;
        const msg = parseErrorMessage(errObj);
        const details =
          errObj &&
          typeof errObj === 'object' &&
          (errObj as Record<string, unknown>).details
            ? ` | ${JSON.stringify((errObj as Record<string, unknown>).details)}`
            : '';
        throw new Error(`${msg}${details}`);
      }
      if ('result' in obj) return obj.result;
      if ('value' in obj) return obj.value;
      if ('data' in obj) return obj.data;
      return obj;
    };

    if (res.ok) {
      unaryPrefixCache.set(base, prefix);
      return unwrapEnvelope(parsed);
    }

    const errMsg = parseErrorMessage(parsed) || `HTTP ${res.status}`;
    throw new Error(`HTTP ${res.status} ${errMsg} (${url})`);
  }

  throw lastErr || new Error(`无法调用 unary 接口 ${cleanEndpoint}`);
}

/**
 * Probes the corresponding HTTPS URL when a WebSocket handshake fails,
 * distinguishing Tailscale/TUN network blocks from server-side 403/404/502 errors.
 */
async function diagnoseWsHandshakeFailure(serverUrl: string, wsUrl: string): Promise<string> {
  const httpWsTarget = wsUrl.replace(/^wss:\/\//i, 'https://').replace(/^ws:\/\//i, 'http://');
  const baseTarget = serverUrl.trim().replace(/\/+$/, '');

  const probe = async (url: string): Promise<{ reached: boolean; status?: number; err?: string }> => {
    try {
      const res = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      return { reached: true, status: res.status };
    } catch (err) {
      return {
        reached: false,
        err: err instanceof Error ? err.message : String(err),
      };
    }
  };

  const wsProbe = await probe(httpWsTarget);
  if (wsProbe.reached) {
    if (wsProbe.status === 403) {
      return `WebSocket 握手被服务端拒绝（HTTPS 探测返回 403 Forbidden）。请检查反代是否为 WebSocket Upgrade 同样改写了 Origin / Sec-Fetch-Site 头。`;
    }
    if (wsProbe.status === 502 || wsProbe.status === 503) {
      return `Tailscale 网络已通，但反代返回 HTTP ${wsProbe.status}（后端 dsh 进程可能未启动或监听端口异常）。`;
    }
    if (wsProbe.status === 404) {
      return `Tailscale 网络已通，但 ${httpWsTarget} 返回 404（请检查反代路径与 WebSocket 路径 /api/remote.mux）。`;
    }
    return `HTTPS 已可达（${httpWsTarget} 返回 HTTP ${wsProbe.status}），但 WebSocket 升级（Upgrade）失败。请检查服务端反代是否开启 WebSocket 转发（Upgrade / Connection 头）或是否允许跨域 Origin。`;
  }

  const baseProbe = baseTarget && baseTarget !== httpWsTarget ? await probe(baseTarget) : wsProbe;
  if (baseProbe.reached) {
    return `根地址可达（HTTP ${baseProbe.status}），但 ${httpWsTarget} 无法访问（${wsProbe.err || 'CORS/网络错误'}）。`;
  }

  return `无法访问 ${baseTarget || httpWsTarget}（${baseProbe.err || 'Failed to fetch'}）。当前设备到 Tailscale 域名的网络不通——请确认 Tailscale 已开启、代理软件 TUN 已关闭或已将 *.ts.net 加入直连，也可先点击上方“浏览器直接打开 HTTPS 测通”验证。`;
}

/**
 * Tests real WebSocket handshake and optional RemoteStreamClientMessage (`type: "open"`)
 * against DeepSeek Harness /api/remote.mux. Never sends Authorization header.
 */
export function testDshWebSocket(
  config: ConnectionConfig,
  probeEndpoint?: string
): Promise<DshWsTestResult> {
  const wsUrl = buildDshWsUrl(config.serverUrl, config.wsEndpoint);
  if (!wsUrl) {
    return Promise.resolve({
      ok: false,
      wsUrl: '',
      latencyMs: 0,
      message: '请先填写服务器地址。',
    });
  }

  return new Promise((resolve) => {
    const started = performance.now();
    let settled = false;
    let diagnosingError = false;
    let ws: DshWebSocketLike | null = null;
    let receivedFrame: string | undefined;

    const finish = (result: DshWsTestResult) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        try {
          ws.close(1000, 'probe-complete');
        } catch {
          // ignore
        }
      }
      resolve(result);
    };

    const timer = window.setTimeout(() => {
      finish({
        ok: false,
        wsUrl,
        latencyMs: Math.round(performance.now() - started),
        message:
          'WebSocket 连接超时（15s）。请确认已连接 Tailscale 且代理/TUN 已放行 *.ts.net。',
      });
    }, 15000);

    try {
      ws = createDshWebSocket(wsUrl);
    } catch (err) {
      finish({
        ok: false,
        wsUrl,
        latencyMs: 0,
        message: `无法创建 WebSocket：${err instanceof Error ? err.message : '地址格式无效'}`,
      });
      return;
    }

    ws.onopen = () => {
      const latencyMs = Math.round(performance.now() - started);

      if (!probeEndpoint) {
        window.setTimeout(() => {
          finish({
            ok: true,
            wsUrl,
            latencyMs,
            message: `WebSocket 握手成功（${latencyMs} ms），已联通 ${wsUrl}。`,
            rawFrame: receivedFrame,
          });
        }, 350);
        return;
      }

      const streamId = mintStreamId();
      const args: Record<string, unknown> =
        probeEndpoint === 'session/follow'
          ? {
              request: {
                address: {
                  kind: 'session',
                  sessionId: config.sessionId?.trim() || '',
                },
              },
            }
          : probeEndpoint.startsWith('session/')
            ? {
                request: {
                  workspaceId: config.workspace.trim() || undefined,
                  sessionId: config.sessionId?.trim() || undefined,
                },
              }
            : {};

      const frame: DshRemoteStreamOpenFrame = {
        type: 'open',
        streamId,
        endpoint: probeEndpoint,
        payload: { args },
      };

      try {
        ws?.send(JSON.stringify(frame));
      } catch (err) {
        finish({
          ok: false,
          wsUrl,
          latencyMs,
          message: `已连接但发送 open 帧失败：${err instanceof Error ? err.message : String(err)}`,
        });
      }
    };

    ws.onmessage = (event) => {
      const raw = typeof event.data === 'string' ? event.data : '[Binary Frame]';
      receivedFrame = raw.slice(0, 1800);
      if (probeEndpoint) {
        const latencyMs = Math.round(performance.now() - started);
        let ok = true;
        let msg = `stream-protocol 探测成功（${latencyMs} ms），收到服务端返回帧：`;
        try {
          const parsed = JSON.parse(raw) as Record<string, unknown>;
          if (parsed.type === 'error') {
            ok = false;
            msg = `WebSocket 已联通，但 endpoint="${probeEndpoint}" 返回校验信息（${latencyMs} ms）：`;
          }
        } catch {
          // keep default
        }
        finish({
          ok,
          wsUrl,
          latencyMs,
          message: msg,
          rawFrame: receivedFrame,
        });
      }
    };

    ws.onerror = () => {
      diagnosingError = true;
      const latencyMs = Math.round(performance.now() - started);
      window.clearTimeout(timer);
      void diagnoseWsHandshakeFailure(config.serverUrl, wsUrl).then((detail) => {
        finish({
          ok: false,
          wsUrl,
          latencyMs,
          message: detail,
        });
      });
    };

    ws.onclose = (ev) => {
      if (!settled && !diagnosingError) {
        const latencyMs = Math.round(performance.now() - started);
        finish({
          ok: false,
          wsUrl,
          latencyMs,
          message: `连接已关闭（code ${ev.code}${ev.reason ? `: ${ev.reason}` : ''}）。`,
          rawFrame: receivedFrame,
        });
      }
    };
  });
}

function extractTextParts(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object') {
          const p = part as Record<string, unknown>;
          // Skip thinking/reasoning blocks if text blocks exist, or include text parts
          if (p.type === 'reasoning' || p.type === 'thinking') return '';
          if (typeof p.text === 'string') return p.text;
          if (typeof p.content === 'string') return p.content;
        }
        return '';
      })
      .filter(Boolean)
      .join('');
  }
  if (content && typeof content === 'object') {
    const obj = content as Record<string, unknown>;
    if (typeof obj.text === 'string') return obj.text;
    if (typeof obj.delta === 'string') return obj.delta;
    if (obj.parts) return extractTextParts(obj.parts);
    if (obj.content) return extractTextParts(obj.content);
  }
  return '';
}

interface FollowParsedEvent {
  isSnapshot?: boolean;
  delta?: string;
  reasoningDelta?: string;
  toolStep?: AgentToolStep;
  fullText?: string;
  done?: boolean;
  idleSignal?: boolean;
  error?: string;
}

function parseSingleEventObject(obj: Record<string, unknown>): FollowParsedEvent {
  const frameType =
    (typeof obj.kind === 'string' && obj.kind) ||
    (typeof obj.type === 'string' && obj.type) ||
    '';

  if (frameType === 'snapshot' || frameType === 'opening' || frameType === 'init') {
    return { isSnapshot: true };
  }

  // Live assistant stream frames: { type: 'assistant-stream', frame: { type: 'chunk', chunk } }
  if (frameType === 'assistant-stream') {
    const streamFrame = (obj.frame && typeof obj.frame === 'object'
      ? (obj.frame as Record<string, unknown>)
      : {}) as Record<string, unknown>;
    if (streamFrame.type === 'chunk') {
      const chunk = (streamFrame.chunk && typeof streamFrame.chunk === 'object'
        ? (streamFrame.chunk as Record<string, unknown>)
        : {}) as Record<string, unknown>;
      if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
        return { delta: chunk.text };
      }
      if (
        (chunk.type === 'reasoning-delta' || chunk.type === 'reasoning' || chunk.type === 'thinking-delta') &&
        (typeof chunk.text === 'string' || typeof chunk.delta === 'string')
      ) {
        return { reasoningDelta: String(chunk.text ?? chunk.delta ?? '') };
      }
      if (
        chunk.type === 'tool-call' ||
        chunk.type === 'tool-input-start' ||
        chunk.type === 'tool-call-start'
      ) {
        const name = String(chunk.toolName ?? chunk.name ?? 'tool');
        const id = String(chunk.toolCallId ?? chunk.id ?? `${name}-${Date.now()}`);
        const detail =
          chunk.args || chunk.input
            ? JSON.stringify(chunk.args ?? chunk.input).slice(0, 180)
            : undefined;
        return { toolStep: { id, name, status: 'running', detail } };
      }
      if (chunk.type === 'tool-result' || chunk.type === 'tool-output-available') {
        const name = String(chunk.toolName ?? chunk.name ?? 'tool');
        const id = String(chunk.toolCallId ?? chunk.id ?? name);
        const output =
          chunk.result || chunk.output
            ? (typeof (chunk.result ?? chunk.output) === 'string'
                ? String(chunk.result ?? chunk.output)
                : JSON.stringify(chunk.result ?? chunk.output)
              ).slice(0, 260)
            : undefined;
        return { toolStep: { id, name, status: 'done', output } };
      }
      return {};
    }
    return {};
  }

  // Unwrap wrapper envelopes like { kind: 'event', event: {...} } or { entry: {...} }
  const inner =
    (obj.event && typeof obj.event === 'object' ? (obj.event as Record<string, unknown>) : null) ||
    (obj.entry && typeof obj.entry === 'object' ? (obj.entry as Record<string, unknown>) : null) ||
    (obj.chunk && typeof obj.chunk === 'object' ? (obj.chunk as Record<string, unknown>) : null) ||
    (obj.stream && typeof obj.stream === 'object' ? (obj.stream as Record<string, unknown>) : null) ||
    (obj.item && typeof obj.item === 'object' ? (obj.item as Record<string, unknown>) : null) ||
    (obj.payload && typeof obj.payload === 'object' ? (obj.payload as Record<string, unknown>) : null) ||
    obj;

  const eventType =
    (typeof inner.type === 'string' && inner.type) ||
    (typeof inner.kind === 'string' && inner.kind) ||
    frameType;

  // Never echo back user messages as assistant output
  if (
    eventType.startsWith('user/') ||
    eventType === 'user' ||
    inner.role === 'user' ||
    eventType.startsWith('turn/start')
  ) {
    return {};
  }

  // Tool lifecycle events (top-level event format)
  if (eventType.includes('tool')) {
    const data =
      inner.data && typeof inner.data === 'object' ? (inner.data as Record<string, unknown>) : inner;
    const name = String(data.toolName ?? data.name ?? inner.name ?? 'tool');
    const id = String(data.toolCallId ?? data.callId ?? data.id ?? `${name}-step`);
    const isDone =
      eventType.includes('result') ||
      eventType.includes('end') ||
      eventType.includes('done') ||
      eventType.includes('complete');
    const isErr = eventType.includes('error') || eventType.includes('fail');
    const detail =
      data.input || data.args ? JSON.stringify(data.input ?? data.args).slice(0, 180) : undefined;
    const output =
      data.output || data.result
        ? (typeof (data.output ?? data.result) === 'string'
            ? String(data.output ?? data.result)
            : JSON.stringify(data.output ?? data.result)
          ).slice(0, 260)
        : undefined;
    return {
      toolStep: {
        id,
        name,
        status: isErr ? 'error' : isDone ? 'done' : 'running',
        detail,
        output,
      },
    };
  }

  // Assistant text & reasoning streaming deltas
  if (
    eventType.includes('chunk') ||
    eventType.includes('delta') ||
    eventType === 'assistant/stream' ||
    eventType === 'assistant-stream' ||
    eventType === 'assistant/text' ||
    frameType === 'assistant-stream' ||
    frameType === 'delta'
  ) {
    if (
      inner.channel === 'reasoning' ||
      inner.partType === 'reasoning' ||
      inner.kind === 'reasoning' ||
      eventType.includes('reasoning') ||
      eventType.includes('thinking')
    ) {
      const rText =
        (typeof inner.delta === 'string' && inner.delta) ||
        (typeof inner.text === 'string' && inner.text) ||
        '';
      return rText ? { reasoningDelta: rText } : {};
    }
    const deltaObj =
      inner.delta && typeof inner.delta === 'object'
        ? (inner.delta as Record<string, unknown>)
        : null;
    const delta =
      (typeof inner.delta === 'string' && inner.delta) ||
      (deltaObj && typeof deltaObj.text === 'string' && deltaObj.text) ||
      (typeof inner.textDelta === 'string' && inner.textDelta) ||
      (typeof inner.contentDelta === 'string' && inner.contentDelta) ||
      (typeof inner.text === 'string' && inner.text) ||
      extractTextParts(inner.content) ||
      extractTextParts(inner.part);
    return { delta: delta || undefined, done: false };
  }

  // Final assistant message or message append/update
  if (
    eventType === 'assistant/message' ||
    eventType === 'assistant' ||
    eventType === 'assistant/final' ||
    ((eventType === 'message' || eventType === 'message/append' || eventType === 'message/update') &&
      inner.role === 'assistant') ||
    (inner.message &&
      typeof inner.message === 'object' &&
      (inner.message as Record<string, unknown>).role === 'assistant')
  ) {
    const data = (inner.data && typeof inner.data === 'object'
      ? (inner.data as Record<string, unknown>)
      : {}) as Record<string, unknown>;
    const dataMessage = data.message && typeof data.message === 'object'
      ? (data.message as Record<string, unknown>)
      : null;
    const innerMessage = inner.message && typeof inner.message === 'object'
      ? (inner.message as Record<string, unknown>)
      : null;
    const fullText =
      (dataMessage ? extractTextParts(dataMessage.content) : '') ||
      extractTextParts(inner.content) ||
      (typeof inner.text === 'string' ? inner.text : '') ||
      extractTextParts(data.content) ||
      (innerMessage ? extractTextParts(innerMessage.content) : '') ||
      '';
    return { fullText: fullText || undefined, done: false };
  }

  // Turn completion signals
  if (
    eventType === 'turn/end' ||
    eventType === 'turn/complete' ||
    eventType === 'turn/completed' ||
    eventType === 'turn/finished' ||
    eventType === 'turn/done' ||
    eventType === 'run/end' ||
    eventType === 'run/completed' ||
    eventType === 'done'
  ) {
    const maybeText =
      extractTextParts(inner.content) || (typeof inner.text === 'string' ? inner.text : undefined);
    return { fullText: maybeText, done: true };
  }

  // Idle / status signals (only treat as done once assistant text has been received)
  if (
    eventType === 'session/idle' ||
    eventType === 'idle' ||
    inner.status === 'idle' ||
    inner.state === 'idle' ||
    (inner.session &&
      typeof inner.session === 'object' &&
      (inner.session as Record<string, unknown>).status === 'idle')
  ) {
    return { idleSignal: true };
  }

  // Turn failure
  if (eventType === 'turn/error' || eventType === 'turn/failed' || eventType === 'error') {
    return { error: parseErrorMessage(inner.error ?? inner.message ?? inner), done: true };
  }

  return {};
}

function extractFollowEvents(rawItem: unknown): FollowParsedEvent[] {
  if (!rawItem || typeof rawItem !== 'object') return [];
  const obj = rawItem as Record<string, unknown>;
  const frameType =
    (typeof obj.kind === 'string' && obj.kind) ||
    (typeof obj.type === 'string' && obj.type) ||
    '';

  if (frameType === 'snapshot' || frameType === 'opening' || frameType === 'init') {
    return [{ isSnapshot: true }];
  }

  // Batch array frames (e.g. { kind: 'events', events: [...] } or { entries: [...] })
  const batch = Array.isArray(obj.events)
    ? obj.events
    : Array.isArray(obj.entries)
      ? obj.entries
      : null;

  if (batch) {
    return batch
      .filter((e): e is Record<string, unknown> => Boolean(e && typeof e === 'object'))
      .map((e) => parseSingleEventObject(e));
  }

  return [parseSingleEventObject(obj)];
}

interface MultiplexerStreamHandlers {
  onItem: (item: unknown) => void;
  onEnd: () => void;
  onError: (errMsg: string) => void;
}

class SingleTurnMuxHelper {
  private ws: DshWebSocketLike;
  private handlers = new Map<string, MultiplexerStreamHandlers>();

  constructor(ws: DshWebSocketLike) {
    this.ws = ws;
    this.ws.onmessage = (event) => {
      const raw = typeof event.data === 'string' ? event.data : '';
      if (!raw) return;
      const lines = raw.split('\n').filter((l) => l.trim().length > 0);
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line) as Record<string, unknown>;
          const sid = typeof parsed.streamId === 'string' ? parsed.streamId : '';
          const h = this.handlers.get(sid);
          if (!h) continue;

          if (parsed.type === 'item') {
            h.onItem(parsed.item ?? parsed.value ?? parsed.data ?? parsed.payload);
          } else if (parsed.type === 'end') {
            this.handlers.delete(sid);
            h.onEnd();
          } else if (parsed.type === 'error') {
            this.handlers.delete(sid);
            h.onError(parseErrorMessage(parsed.error ?? parsed.payload ?? parsed));
          }
        } catch {
          // ignore non-JSON frames
        }
      }
    };
  }

  openStream(
    endpoint: string,
    args: Record<string, unknown>,
    handlers: MultiplexerStreamHandlers
  ): string {
    const streamId = mintStreamId();
    this.handlers.set(streamId, handlers);
    const frame: DshRemoteStreamOpenFrame = {
      type: 'open',
      streamId,
      endpoint,
      payload: { args },
    };
    this.ws.send(JSON.stringify(frame));
    return streamId;
  }

  cancelStream(streamId: string): void {
    this.handlers.delete(streamId);
    if (this.ws.readyState === WebSocket.OPEN) {
      const cancel: DshRemoteStreamCancelFrame = { type: 'cancel', streamId };
      try {
        this.ws.send(JSON.stringify(cancel));
      } catch {
        // ignore
      }
    }
  }
}

function formatShortTime(raw?: unknown): string {
  if (typeof raw === 'number' || (typeof raw === 'string' && raw.trim())) {
    const d = new Date(typeof raw === 'number' ? raw : raw);
    if (!Number.isNaN(d.getTime())) {
      const now = new Date();
      const sameDay =
        d.getFullYear() === now.getFullYear() &&
        d.getMonth() === now.getMonth() &&
        d.getDate() === now.getDate();
      const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      return sameDay ? hhmm : `${d.getMonth() + 1}/${d.getDate()} ${hhmm}`;
    }
  }
  return '刚刚';
}

function collectSessionSummaries(node: unknown, out: Map<string, RemoteSessionSummary>, depth = 0): void {
  if (!node || depth > 5) return;
  if (Array.isArray(node)) {
    for (const item of node) {
      collectSessionSummaries(item, out, depth + 1);
    }
    return;
  }
  if (typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;

  const candidateId =
    (typeof obj.sessionId === 'string' && obj.sessionId) ||
    (typeof obj.id === 'string' &&
      obj.id &&
      (obj.workspaceId !== undefined ||
        obj.cwd !== undefined ||
        obj.title !== undefined ||
        obj.updatedAt !== undefined ||
        obj.createdAt !== undefined ||
        obj.lastActiveAt !== undefined ||
        obj.status !== undefined) &&
      obj.id);

  if (candidateId) {
    const titleRaw =
      (typeof obj.title === 'string' && obj.title.trim()) ||
      (typeof obj.name === 'string' && obj.name.trim()) ||
      (typeof obj.summary === 'string' && obj.summary.trim()) ||
      (typeof obj.preview === 'string' && obj.preview.trim()) ||
      `会话 ${candidateId.slice(0, 8)}`;
    const ts = obj.updatedAt ?? obj.lastActiveAt ?? obj.lastMessageAt ?? obj.createdAt;
    out.set(candidateId, {
      sessionId: candidateId,
      title: titleRaw.slice(0, 48),
      updatedAt: formatShortTime(ts),
      preview: typeof obj.preview === 'string' ? obj.preview : undefined,
    });
  }

  for (const key of ['sessions', 'items', 'entries', 'list', 'data', 'snapshot', 'workspace', 'result', 'payload', 'value']) {
    if (obj[key]) {
      collectSessionSummaries(obj[key], out, depth + 1);
    }
  }
}

/**
 * Fetches existing sessions from the DeepSeek Harness workspace.
 * Tries HTTP unary `session/list` first, then falls back to WS `workspace/follow` initial snapshot.
 */
export async function listDshSessions(config: ConnectionConfig): Promise<RemoteSessionSummary[]> {
  const workspaceId = config.workspace.trim() || undefined;
  const found = new Map<string, RemoteSessionSummary>();

  const listRequests: Array<Record<string, unknown>> = [
    { cwd: '/root/.dsh/im' },
    ...(workspaceId ? [{ workspaceId }] : []),
    {},
  ];

  for (const endpoint of ['session/list', 'workspace/sessions']) {
    for (const req of listRequests) {
      try {
        const res = await callDshHttpUnary(config, endpoint, { request: req });
        collectSessionSummaries(res, found);
        if (found.size > 0) return Array.from(found.values());
      } catch {
        // Try next candidate
      }
    }
  }

  const wsUrl = buildDshWsUrl(config.serverUrl, config.wsEndpoint);
  if (!wsUrl) return [];

  const wsCandidateArgs: Record<string, unknown>[] = [
    ...(workspaceId ? [{ request: { address: { kind: 'workspace', workspaceId } } }] : []),
    ...(workspaceId ? [{ request: { workspaceId } }] : []),
    { request: {} },
    {},
  ];

  for (const args of wsCandidateArgs) {
    const items = await new Promise<RemoteSessionSummary[]>((resolve) => {
      let done = false;
      let ws: DshWebSocketLike | null = null;
      const localMap = new Map<string, RemoteSessionSummary>();

      const finish = () => {
        if (done) return;
        done = true;
        window.clearTimeout(timer);
        if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
          try {
            ws.close(1000, 'list-done');
          } catch {
            // ignore
          }
        }
        resolve(Array.from(localMap.values()));
      };

      const timer = window.setTimeout(finish, 3500);

      try {
        ws = createDshWebSocket(wsUrl);
      } catch {
        finish();
        return;
      }

      ws.onopen = () => {
        if (!ws) return;
        const mux = new SingleTurnMuxHelper(ws);
        mux.openStream('workspace/follow', args, {
          onItem: (item) => {
            collectSessionSummaries(item, localMap);
            if (localMap.size > 0) {
              window.setTimeout(finish, 180);
            }
          },
          onEnd: finish,
          onError: finish,
        });
      };

      ws.onerror = finish;
      ws.onclose = finish;
    });

    if (items.length > 0) {
      return items;
    }
  }

  return Array.from(found.values());
}

function extractHistoryMessagesFromSnapshot(raw: unknown): ChatMessage[] {
  const results: ChatMessage[] = [];
  const seenKeys = new Set<string>();

  const pushMsg = (role: 'user' | 'assistant', text: string, ts?: unknown, idx?: number) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const dedup = `${role}:${trimmed.slice(0, 60)}:${idx ?? results.length}`;
    if (seenKeys.has(dedup)) return;
    seenKeys.add(dedup);
    const parsed = role === 'assistant' ? extractRelayCards(trimmed) : { cleanText: trimmed, cards: [] };
    results.push({
      id: `hist-${role}-${results.length}-${Date.now().toString(36)}`,
      role,
      content: parsed.cleanText || trimmed,
      cards: parsed.cards.length > 0 ? parsed.cards : undefined,
      timestamp: formatShortTime(ts),
    });
  };

  const walk = (node: unknown, depth = 0) => {
    if (!node || depth > 6) return;
    if (Array.isArray(node)) {
      node.forEach((entry, i) => {
        if (!entry || typeof entry !== 'object') return;
        const obj = entry as Record<string, unknown>;
        const dataObj = obj.data && typeof obj.data === 'object' ? (obj.data as Record<string, unknown>) : null;
        const dataMessage =
          dataObj?.message && typeof dataObj.message === 'object'
            ? (dataObj.message as Record<string, unknown>)
            : null;
        const inner =
          dataMessage ||
          (obj.message && typeof obj.message === 'object' ? (obj.message as Record<string, unknown>) : null) ||
          (obj.event && typeof obj.event === 'object' ? (obj.event as Record<string, unknown>) : null) ||
          obj;
        const type =
          (typeof obj.type === 'string' && obj.type) ||
          (typeof inner.type === 'string' && inner.type) ||
          (typeof inner.kind === 'string' && inner.kind) ||
          '';
        const roleRaw =
          (typeof inner.role === 'string' && inner.role) ||
          (type.startsWith('user') ? 'user' : type.startsWith('assistant') ? 'assistant' : '');

        if (roleRaw === 'user' || roleRaw === 'assistant') {
          const text =
            extractTextParts(inner.content) ||
            (typeof inner.text === 'string' ? inner.text : '') ||
            (dataObj ? extractTextParts(dataObj.content) : '') ||
            extractTextParts(inner.parts);
          pushMsg(roleRaw, text, inner.createdAt ?? inner.timestamp ?? obj.timestamp, i);
          return;
        }
        walk(entry, depth + 1);
      });
      return;
    }

    if (typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    for (const key of ['messages', 'entries', 'events', 'turns', 'history', 'items', 'snapshot', 'session', 'data', 'payload', 'value']) {
      if (obj[key]) {
        walk(obj[key], depth + 1);
      }
    }
  };

  walk(raw);
  return results;
}

/**
 * Loads historical messages for a specific remote sessionId by reading the initial
 * `session/follow` snapshot (or HTTP `session/get` if available).
 */
export async function loadDshSessionHistory(
  config: ConnectionConfig,
  sessionId: string
): Promise<ChatMessage[]> {
  const cleanId = sessionId.trim();
  if (!cleanId) return [];

  const wsUrl = buildDshWsUrl(config.serverUrl, config.wsEndpoint);
  if (wsUrl) {
    const fromWs = await new Promise<ChatMessage[]>((resolve) => {
      let done = false;
      let ws: DshWebSocketLike | null = null;
      let collected: ChatMessage[] = [];

      const finish = () => {
        if (done) return;
        done = true;
        window.clearTimeout(timer);
        if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
          try {
            ws.close(1000, 'history-loaded');
          } catch {
            // ignore
          }
        }
        resolve(collected);
      };

      const timer = window.setTimeout(finish, 3200);

      try {
        ws = createDshWebSocket(wsUrl);
      } catch {
        finish();
        return;
      }

      ws.onopen = () => {
        if (!ws) return;
        const mux = new SingleTurnMuxHelper(ws);
        mux.openStream(
          'session/follow',
          {
            request: {
              address: {
                kind: 'session',
                sessionId: cleanId,
              },
              assistantStream: true,
            },
          },
          {
            onItem: (item) => {
              const msgs = extractHistoryMessagesFromSnapshot(item);
              if (msgs.length > 0) {
                collected = msgs;
                window.setTimeout(finish, 150);
              }
            },
            onEnd: finish,
            onError: finish,
          }
        );
      };

      ws.onerror = finish;
      ws.onclose = finish;
    });

    if (fromWs.length > 0) return fromWs;
  }

  try {
    const res = await callDshHttpUnary(config, 'session/get', {
      request: { sessionId: cleanId },
    });
    return extractHistoryMessagesFromSnapshot(res);
  } catch {
    return [];
  }
}

export interface StreamDshOptions {
  attachments?: ChatAttachment[];
  sessionIdOverride?: string;
  onSessionResolved?: (sessionId: string) => void;
}

function buildTextWithFileAttachments(prompt: string, attachments?: ChatAttachment[]): string {
  if (!attachments || attachments.length === 0) return prompt;
  const textBlocks: string[] = [];
  for (const att of attachments) {
    if (att.textContent) {
      textBlocks.push(
        `[附件文件: ${att.name} (${att.size})]\n\`\`\`\n${att.textContent.slice(0, 60000)}\n\`\`\``
      );
    }
  }
  if (textBlocks.length === 0) return prompt;
  return `${prompt}\n\n${textBlocks.join('\n\n')}`;
}

function buildMultimodalContentCandidates(
  prompt: string,
  attachments?: ChatAttachment[]
): Record<string, unknown>[][] {
  const combinedText = buildTextWithFileAttachments(prompt, attachments);
  const mediaAttachments = (attachments || []).filter(
    (att) => !att.textContent && (att.base64Data || att.dataUrl)
  );

  if (mediaAttachments.length === 0) {
    return [[{ type: 'text', text: combinedText }]];
  }

  const makeParts = (
    mapper: (att: ChatAttachment) => Record<string, unknown>
  ): Record<string, unknown>[] => [
    { type: 'text', text: combinedText },
    ...mediaAttachments.map(mapper),
  ];

  return [
    makeParts((att) =>
      att.mimeType.startsWith('image/')
        ? {
            type: 'image',
            mimeType: att.mimeType,
            data: att.base64Data || att.dataUrl || '',
          }
        : {
            type: 'file',
            filename: att.name,
            mimeType: att.mimeType,
            data: att.base64Data || att.dataUrl || '',
          }
    ),
    makeParts((att) =>
      att.mimeType.startsWith('image/')
        ? {
            type: 'image',
            mediaType: att.mimeType,
            data: att.base64Data || att.dataUrl || '',
          }
        : {
            type: 'file',
            filename: att.name,
            mediaType: att.mimeType,
            data: att.base64Data || att.dataUrl || '',
          }
    ),
    makeParts((att) =>
      att.mimeType.startsWith('image/')
        ? {
            type: 'image',
            url: att.dataUrl || '',
            mimeType: att.mimeType,
          }
        : {
            type: 'file',
            filename: att.name,
            url: att.dataUrl || '',
            mediaType: att.mimeType,
          }
    ),
    makeParts((att) => ({
      type: 'image',
      image: att.dataUrl || att.base64Data || '',
      mimeType: att.mimeType,
    })),
    makeParts((att) => ({
      type: 'image_url',
      image_url: { url: att.dataUrl || '' },
    })),
    makeParts((att) => ({
      type: 'image',
      source: {
        type: 'base64',
        media_type: att.mimeType,
        data: att.base64Data || '',
      },
    })),
  ];
}

/**
 * Full DeepSeek Harness Typert Gateway conversation turn:
 * 1. Unary HTTP POST `session/create` (never via WS stream carrier) to obtain/reuse `sessionId`
 * 2. Stream WS `/api/remote.mux` `session/follow` (`assistantStream: true`) to subscribe to live chunks
 * 3. Unary HTTP POST `session/prompt` (with `args.request` and automatic multimodal adaptation)
 */
export function streamDshMuxReply(
  prompt: string,
  config: ConnectionConfig,
  onChunk: (chunk: AgentReplyChunk) => void,
  signal?: AbortSignal,
  options?: StreamDshOptions
): Promise<void> {
  const wsUrl = buildDshWsUrl(config.serverUrl, config.wsEndpoint);
  if (!wsUrl) {
    return Promise.reject(new Error('请先在连接配置中填写 DeepSeek Harness 地址。'));
  }

  const promptEndpoint = (config.rpcMethod?.trim() || 'session/prompt').replace(/\./g, '/');
  const cacheKey = `${config.serverUrl.trim()}::${config.workspace.trim()}`;

  return new Promise((resolve, reject) => {
    let settled = false;
    let diagnosingError = false;
    let accumulated = '';
    let accumulatedThinking = '';
    const toolStepsMap = new Map<string, AgentToolStep>();
    const startedAt = performance.now();
    let ws: DshWebSocketLike | null = null;
    let mux: SingleTurnMuxHelper | null = null;
    let followStreamId: string | null = null;
    let sawPostPromptEvent = false;
    const recentRawFrames: string[] = [];

    const emitUpdate = (done: boolean) => {
      const { cleanText, cards } = extractRelayCards(accumulated);
      const steps = Array.from(toolStepsMap.values()).map((s) =>
        done && s.status === 'running' ? { ...s, status: 'done' as const } : s
      );
      onChunk({
        text: done ? cleanText || accumulated || '（Agent 已完成本轮回复）' : cleanText,
        cards,
        thinking: accumulatedThinking || undefined,
        toolSteps: steps.length > 0 ? steps : undefined,
        elapsedMs: Math.round(performance.now() - startedAt),
        done,
      });
    };

    const cleanup = () => {
      window.clearTimeout(connectTimer);
      window.clearTimeout(idleTimer);
      if (mux && followStreamId) {
        mux.cancelStream(followStreamId);
      }
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        try {
          ws.close(1000, 'turn-complete');
        } catch {
          // ignore
        }
      }
    };

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    const succeed = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };

    if (signal) {
      signal.addEventListener(
        'abort',
        () => {
          const abortErr = new Error('已手动停止生成');
          abortErr.name = 'AbortError';
          fail(abortErr);
        },
        { once: true }
      );
    }

    const connectTimer = window.setTimeout(() => {
      fail(new Error(`连接 ${wsUrl} 超时（15s），请确认设备已连入 Tailscale。`));
    }, 15000);

    let idleTimer = window.setTimeout(() => {}, 0);
    const resetIdleTimer = (ms = 45000) => {
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => {
        if (accumulated) {
          const { cleanText, cards } = extractRelayCards(accumulated);
          onChunk({ text: cleanText, cards, done: true });
          succeed();
        } else {
          const sample =
            recentRawFrames.length > 0
              ? ` 期间收到原始帧样本：${recentRawFrames.join(' | ')}`
              : '';
          fail(new Error(`已提交消息到 DeepSeek Harness，但等待流式回复超时（45s）。${sample}`));
        }
      }, ms);
    };

    try {
      ws = createDshWebSocket(wsUrl);
    } catch (err) {
      fail(new Error(`WebSocket 地址无效：${err instanceof Error ? err.message : wsUrl}`));
      return;
    }

    ws.onopen = async () => {
      window.clearTimeout(connectTimer);
      resetIdleTimer(45000);
      if (!ws) return;
      mux = new SingleTurnMuxHelper(ws);

      try {
        // Step 1: Ensure sessionId via HTTP POST unary carrier (NEVER through stream carrier)
        const hasExplicitOverride = options?.sessionIdOverride !== undefined;
        let sessionId = hasExplicitOverride
          ? options?.sessionIdOverride?.trim() || ''
          : config.sessionId?.trim() || sessionCache.get(cacheKey) || loadStoredSession(cacheKey) || '';

        if (!sessionId) {
          // Prefer the personal-assistant workspace (AGENTS.md persona/tools);
          // fall back to the configured workspace id when cwd creation is refused.
          const createRequests: Array<Record<string, unknown>> = [
            { cwd: '/root/.dsh/im' },
            { workspaceId: config.workspace.trim() || undefined },
          ];
          let createRes: unknown = null;
          let lastErr = '';
          for (const request of createRequests) {
            try {
              createRes = await callDshHttpUnary(config, 'session/create', { request }, signal);
              if (findSessionIdInPayload(createRes)) break;
            } catch (createErr) {
              lastErr = createErr instanceof Error ? createErr.message : String(createErr);
              const msg = lastErr;
              if (msg.includes('unexpected "request"')) {
                try {
                  createRes = await callDshHttpUnary(
                    config,
                    'session/create',
                    request,
                    signal
                  );
                  if (findSessionIdInPayload(createRes)) break;
                } catch (retryErr) {
                  lastErr = retryErr instanceof Error ? retryErr.message : String(retryErr);
                }
              }
            }
          }
          if (!createRes && lastErr) {
            throw new Error(`创建会话 (HTTP POST session/create) 失败：${lastErr}`);
          }

          sessionId = findSessionIdInPayload(createRes) || '';
          if (!sessionId) {
            throw new Error(
              `session/create 未返回 sessionId，原始返回：${JSON.stringify(createRes)}`
            );
          }
          sessionCache.set(cacheKey, sessionId);
          storeSession(cacheKey, sessionId);
        } else {
          sessionCache.set(cacheKey, sessionId);
          storeSession(cacheKey, sessionId);
        }

        options?.onSessionResolved?.(sessionId);

        // Step 2: Subscribe to live output via stream carrier (`/api/remote.mux` -> `session/follow`)
        // Verified SessionFollowRequest shape: { address: { kind: "session", sessionId } }
        const startFollow = () => {
          if (!mux) return;
          const followArgs: Record<string, unknown> = {
            request: {
              address: {
                kind: 'session',
                sessionId,
              },
              assistantStream: true,
            },
          };

          followStreamId = mux.openStream('session/follow', followArgs, {
            onItem: (item) => {
              resetIdleTimer(60000);
              try {
                const rawPreview = JSON.stringify(item).slice(0, 320);
                if (rawPreview) {
                  recentRawFrames.push(rawPreview);
                  if (recentRawFrames.length > 3) recentRawFrames.shift();
                }
              } catch {
                // ignore serialization error
              }
              const events = extractFollowEvents(item);
              for (const info of events) {
                if (info.isSnapshot) continue;
                if (!sawPostPromptEvent) continue;

                if (info.error) {
                  fail(new Error(`Agent 执行出错：${info.error}`));
                  return;
                }
                if (info.reasoningDelta) {
                  accumulatedThinking += info.reasoningDelta;
                  emitUpdate(false);
                }
                if (info.toolStep) {
                  const prev = toolStepsMap.get(info.toolStep.id);
                  toolStepsMap.set(info.toolStep.id, {
                    id: info.toolStep.id,
                    name: info.toolStep.name || prev?.name || 'tool',
                    status: info.toolStep.status,
                    detail: info.toolStep.detail ?? prev?.detail,
                    output: info.toolStep.output ?? prev?.output,
                  });
                  emitUpdate(false);
                }
                if (info.delta) {
                  accumulated += info.delta;
                  emitUpdate(false);
                } else if (info.fullText) {
                  accumulated = info.fullText;
                  emitUpdate(Boolean(info.done));
                }
                if (info.done || (info.idleSignal && accumulated.length > 0)) {
                  emitUpdate(true);
                  succeed();
                  return;
                }
              }
            },
            onEnd: () => {
              if (!settled && accumulated) {
                emitUpdate(true);
                succeed();
              }
            },
            onError: (errMsg) => {
              if (!settled && !accumulated) {
                fail(new Error(`订阅会话流 (session/follow) 失败：${errMsg}`));
              }
            },
          });
        };

        startFollow();

        // Step 3: Submit prompt (with text + multimodal image/file attachments) via HTTP POST unary carrier
        const requestId = mintStreamId();
        const clientTimeZone = getClientTimeZone();
        sawPostPromptEvent = true;

        const contentCandidates = buildMultimodalContentCandidates(prompt, options?.attachments);
        let promptRes: unknown;
        let lastPromptError: Error | null = null;

        for (let idx = 0; idx < contentCandidates.length; idx++) {
          const candidateContent = contentCandidates[idx];
          const reqBody: Record<string, unknown> = {
            requestId: idx === 0 ? requestId : mintStreamId(),
            sessionId,
            mode: 'queue',
            content: candidateContent,
            clientTimeZone,
          };

          try {
            promptRes = await callDshHttpUnary(
              config,
              promptEndpoint,
              { request: reqBody },
              signal
            );
            lastPromptError = null;
            break;
          } catch (promptErr) {
            if ((promptErr as Error).name === 'AbortError') throw promptErr;
            const msg = promptErr instanceof Error ? promptErr.message : String(promptErr);
            lastPromptError = new Error(msg);

            const isBoundaryError =
              msg.includes('boundary validation') ||
              msg.includes('invalid_value') ||
              msg.includes('invalid_union') ||
              msg.includes('invalid_type') ||
              msg.toLowerCase().includes('content');

            if (isBoundaryError && idx < contentCandidates.length - 1) {
              continue;
            }

            if (msg.includes('unexpected "mode"')) {
              const withoutMode = { ...reqBody };
              delete withoutMode.mode;
              promptRes = await callDshHttpUnary(
                config,
                promptEndpoint,
                { request: withoutMode },
                signal
              );
              lastPromptError = null;
              break;
            }

            if (
              contentCandidates.length === 1 &&
              msg.toLowerCase().includes('content') &&
              (msg.toLowerCase().includes('string') || msg.toLowerCase().includes('expected'))
            ) {
              promptRes = await callDshHttpUnary(
                config,
                promptEndpoint,
                {
                  request: {
                    ...reqBody,
                    content: buildTextWithFileAttachments(prompt, options?.attachments),
                  },
                },
                signal
              );
              lastPromptError = null;
              break;
            }

            break;
          }
        }

        if (lastPromptError) {
          throw new Error(`提交消息 (${promptEndpoint}) 失败：${lastPromptError.message}`);
        }

        // If the unary prompt response itself already contains reply text, render it immediately
        if (promptRes && typeof promptRes === 'object') {
          const maybeText =
            extractTextParts((promptRes as Record<string, unknown>).content) ||
            (typeof (promptRes as Record<string, unknown>).reply === 'string'
              ? String((promptRes as Record<string, unknown>).reply)
              : '');
          if (maybeText && !accumulated) {
            const { cleanText, cards } = extractRelayCards(maybeText);
            onChunk({ text: cleanText, cards, done: true });
            succeed();
          }
        }
      } catch (err) {
        fail(err instanceof Error ? err : new Error(String(err)));
      }
    };

    ws.onerror = () => {
      diagnosingError = true;
      window.clearTimeout(connectTimer);
      window.clearTimeout(idleTimer);
      void diagnoseWsHandshakeFailure(config.serverUrl, wsUrl).then((detail) => {
        fail(new Error(detail));
      });
    };

    ws.onclose = (ev) => {
      if (!settled && !diagnosingError) {
        if (accumulated) {
          const { cleanText, cards } = extractRelayCards(accumulated);
          onChunk({ text: cleanText, cards, done: true });
          succeed();
        } else {
          fail(
            new Error(
              `WebSocket 连接被关闭（code ${ev.code}${ev.reason ? `: ${ev.reason}` : ''}）。`
            )
          );
        }
      }
    };
  });
}
