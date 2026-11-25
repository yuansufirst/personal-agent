import type { ConnectionConfig } from '../types/relay';
import { extractRelayCards, type AgentReplyChunk } from './agentClient';

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

export function resetDshSession(config?: ConnectionConfig): void {
  if (!config) {
    sessionCache.clear();
    return;
  }
  sessionCache.delete(`${config.serverUrl.trim()}::${config.workspace.trim()}`);
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
    let ws: WebSocket | null = null;
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
      ws = new WebSocket(wsUrl);
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

  // Never echo back user messages or tool input messages as assistant output
  if (
    eventType.startsWith('user/') ||
    eventType === 'user' ||
    inner.role === 'user' ||
    eventType.startsWith('turn/start')
  ) {
    return {};
  }

  // Assistant text streaming deltas
  if (
    eventType.includes('chunk') ||
    eventType.includes('delta') ||
    eventType === 'assistant/stream' ||
    eventType === 'assistant-stream' ||
    eventType === 'assistant/text' ||
    frameType === 'assistant-stream' ||
    frameType === 'delta'
  ) {
    // Skip reasoning-only deltas
    if (
      inner.channel === 'reasoning' ||
      inner.partType === 'reasoning' ||
      inner.kind === 'reasoning' ||
      eventType.includes('reasoning') ||
      eventType.includes('thinking')
    ) {
      return {};
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
    const fullText =
      extractTextParts(inner.content) ||
      (typeof inner.text === 'string' ? inner.text : '') ||
      (inner.message && typeof inner.message === 'object'
        ? extractTextParts((inner.message as Record<string, unknown>).content)
        : '');
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
  private ws: WebSocket;
  private handlers = new Map<string, MultiplexerStreamHandlers>();

  constructor(ws: WebSocket) {
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

/**
 * Full DeepSeek Harness Typert Gateway conversation turn:
 * 1. Unary HTTP POST `session/create` (never via WS stream carrier) to obtain/reuse `sessionId`
 * 2. Stream WS `/api/remote.mux` `session/follow` to subscribe to real-time assistant chunks
 * 3. Unary HTTP POST `session/prompt` (with `args.request` and automatic content format adaptation)
 */
export function streamDshMuxReply(
  prompt: string,
  config: ConnectionConfig,
  onChunk: (chunk: AgentReplyChunk) => void,
  signal?: AbortSignal
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
    let ws: WebSocket | null = null;
    let mux: SingleTurnMuxHelper | null = null;
    let followStreamId: string | null = null;
    let sawPostPromptEvent = false;
    const recentRawFrames: string[] = [];

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
      ws = new WebSocket(wsUrl);
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
        let sessionId = config.sessionId?.trim() || sessionCache.get(cacheKey) || '';

        if (!sessionId) {
          let createRes: unknown;
          try {
            createRes = await callDshHttpUnary(
              config,
              'session/create',
              {
                request: {
                  workspaceId: config.workspace.trim() || undefined,
                },
              },
              signal
            );
          } catch (createErr) {
            const msg = createErr instanceof Error ? createErr.message : String(createErr);
            if (msg.includes('unexpected "request"')) {
              createRes = await callDshHttpUnary(
                config,
                'session/create',
                {
                  workspaceId: config.workspace.trim() || undefined,
                },
                signal
              );
            } else {
              throw new Error(`创建会话 (HTTP POST session/create) 失败：${msg}`);
            }
          }

          sessionId = findSessionIdInPayload(createRes) || '';
          if (!sessionId) {
            throw new Error(
              `session/create 未返回 sessionId，原始返回：${JSON.stringify(createRes)}`
            );
          }
          sessionCache.set(cacheKey, sessionId);
        }

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
                if (info.delta) {
                  accumulated += info.delta;
                  const { cleanText, cards } = extractRelayCards(accumulated);
                  onChunk({ text: cleanText, cards, done: false });
                } else if (info.fullText) {
                  accumulated = info.fullText;
                  const { cleanText, cards } = extractRelayCards(accumulated);
                  onChunk({ text: cleanText, cards, done: Boolean(info.done) });
                }
                if (info.done || (info.idleSignal && accumulated.length > 0)) {
                  const { cleanText, cards } = extractRelayCards(accumulated);
                  onChunk({
                    text: cleanText || accumulated || '（Agent 已完成本轮回复）',
                    cards,
                    done: true,
                  });
                  succeed();
                  return;
                }
              }
            },
            onEnd: () => {
              if (!settled && accumulated) {
                const { cleanText, cards } = extractRelayCards(accumulated);
                onChunk({ text: cleanText, cards, done: true });
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

        // Step 3: Submit prompt via HTTP POST unary carrier (`session/prompt`)
        const requestId = mintStreamId();
        const clientTimeZone = getClientTimeZone();
        sawPostPromptEvent = true;

        const baseRequest: Record<string, unknown> = {
          requestId,
          sessionId,
          mode: 'queue',
          content: [{ type: 'text', text: prompt }],
          clientTimeZone,
        };

        let promptRes: unknown;
        try {
          promptRes = await callDshHttpUnary(
            config,
            promptEndpoint,
            { request: baseRequest },
            signal
          );
        } catch (promptErr) {
          const msg = promptErr instanceof Error ? promptErr.message : String(promptErr);

          if (
            msg.toLowerCase().includes('content') &&
            (msg.toLowerCase().includes('string') || msg.toLowerCase().includes('expected'))
          ) {
            promptRes = await callDshHttpUnary(
              config,
              promptEndpoint,
              {
                request: {
                  ...baseRequest,
                  content: prompt,
                },
              },
              signal
            );
          } else if (msg.includes('unexpected "mode"')) {
            const withoutMode = { ...baseRequest };
            delete withoutMode.mode;
            promptRes = await callDshHttpUnary(
              config,
              promptEndpoint,
              { request: withoutMode },
              signal
            );
          } else {
            throw new Error(`提交消息 (${promptEndpoint}) 失败：${msg}`);
          }
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
