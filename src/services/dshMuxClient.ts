import type {
  AgentToolStep,
  ChatAttachment,
  ChatMessage,
  ConnectionConfig,
  RemoteSessionSummary,
} from '../types/relay';
import { extractRelayCards, type AgentReplyChunk } from './agentClient';
import {
  createDshWebSocket,
  httpRequestNativeIfAvailable,
  isNativeDshSocketAvailable,
  uploadBinaryNativeIfAvailable,
  type DshWebSocketLike,
} from './nativeSocket';
import {
  formatFileBytes,
  inferMimeTypeFromName,
  resolveCloudFileUrl,
} from './fileTransfer';

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

function createTimedAbortController(
  parentSignal: AbortSignal | undefined,
  timeoutMs: number
): { signal: AbortSignal; cleanup: () => void; didTimeout: () => boolean } {
  const controller = new AbortController();
  let timedOut = false;

  const onParentAbort = () => {
    controller.abort(parentSignal?.reason);
  };
  if (parentSignal) {
    if (parentSignal.aborted) {
      controller.abort(parentSignal.reason);
    } else {
      parentSignal.addEventListener('abort', onParentAbort, { once: true });
    }
  }

  const timer = window.setTimeout(() => {
    timedOut = true;
    controller.abort(new Error(`请求超时（${Math.round(timeoutMs / 1000)}s）`));
  }, timeoutMs);

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    cleanup: () => {
      window.clearTimeout(timer);
      if (parentSignal) {
        parentSignal.removeEventListener('abort', onParentAbort);
      }
    },
  };
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
  signal?: AbortSignal,
  timeoutMs = 25000
): Promise<unknown> {
  const base = config.serverUrl.trim().replace(/\/+$/, '');
  if (!/^https?:\/\/.+/i.test(base)) {
    throw new Error('未配置有效的云端 Agent 地址（请在设置中填写 https:// 开头的域名）');
  }
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

    const bodyJson = JSON.stringify(body);
    let status = 0;
    let ok = false;
    let rawText = '';

    // Prefer native OkHttp on Android APK (real timeouts + same-origin header, avoids CapacitorHttp quirks)
    let handledNatively = false;
    try {
      const nativeRes = await httpRequestNativeIfAvailable({
        url,
        method: 'POST',
        body: bodyJson,
        contentType: 'application/json; charset=utf-8',
        timeoutMs,
      });
      if (nativeRes) {
        handledNatively = true;
        status = nativeRes.status;
        ok = nativeRes.ok;
        rawText = nativeRes.body || '';
      }
    } catch (nativeErr) {
      if (signal?.aborted) {
        const abortErr = new Error('已取消请求');
        abortErr.name = 'AbortError';
        throw abortErr;
      }
      const msg = nativeErr instanceof Error ? nativeErr.message : String(nativeErr);
      if (/timeout|timed out/i.test(msg)) {
        throw new Error(
          `HTTP POST ${cleanEndpoint} 请求超时（${Math.round(timeoutMs / 1000)}s）。若发送了图片或文件，可能是体积过大或 Cloudflare Tunnel 源站响应过慢。`
        );
      }
      throw new Error(
        `HTTP POST ${url} 无法访问（${msg}）。请确认 Cloudflare Tunnel 域名可达且源站正常运行。`
      );
    }

    if (!handledNatively) {
      const timed = createTimedAbortController(signal, timeoutMs);
      let res: Response;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: bodyJson,
          signal: timed.signal,
        });
      } catch (err) {
        const wasTimeout = timed.didTimeout();
        timed.cleanup();
        if (wasTimeout) {
          throw new Error(
            `HTTP POST ${cleanEndpoint} 请求超时（${Math.round(timeoutMs / 1000)}s）。若发送了图片或文件，可能是单次请求体过大或 Cloudflare Tunnel 源站响应过慢。`
          );
        }
        if ((err as Error).name === 'AbortError') throw err;
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(
          `HTTP POST ${url} 无法访问（${msg}）。请确认 Cloudflare Tunnel 域名可达且源站允许跨域 CORS。`
        );
      }

      status = res.status;
      ok = res.ok;
      rawText = await res.text();
      timed.cleanup();
    }

    let parsed: unknown = rawText;
    try {
      parsed = rawText ? JSON.parse(rawText) : null;
    } catch {
      // keep raw text
    }

    if (status === 404 || status === 405) {
      lastErr = new Error(`HTTP ${status} (${url})`);
      continue;
    }

    if (status === 413) {
      throw new Error(`HTTP 413 请求体超过反代/网关上限（${url}），请尝试发送更小体积的文件。`);
    }
    if (status === 524 || status === 504) {
      throw new Error(`HTTP ${status} Cloudflare Tunnel 等待源站响应超时（${url}）。`);
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

    if (ok) {
      unaryPrefixCache.set(base, prefix);
      return unwrapEnvelope(parsed);
    }

    const errMsg = parseErrorMessage(parsed) || `HTTP ${status}`;
    throw new Error(`HTTP ${status} ${errMsg} (${url})`);
  }

  throw lastErr || new Error(`无法调用 unary 接口 ${cleanEndpoint}`);
}

/**
 * Probes the corresponding HTTPS URL when a WebSocket handshake fails,
 * distinguishing Cloudflare Tunnel / DNS issues from server-side 403/404/502 errors.
 */
async function diagnoseWsHandshakeFailure(serverUrl: string, wsUrl: string): Promise<string> {
  const httpWsTarget = wsUrl.replace(/^wss:\/\//i, 'https://').replace(/^ws:\/\//i, 'http://');
  const baseTarget = serverUrl.trim().replace(/\/+$/, '');

  const probe = async (url: string): Promise<{ reached: boolean; status?: number; err?: string }> => {
    try {
      const res = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(6000),
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
      return `WebSocket 握手被服务端或 Cloudflare Access 拒绝（HTTPS 探测返回 403 Forbidden）。请检查域名 Access 规则及 Origin / Sec-Fetch-Site 头转发。`;
    }
    if (wsProbe.status === 502 || wsProbe.status === 503 || wsProbe.status === 530) {
      return `Cloudflare Tunnel 边缘已连通，但源站返回 HTTP ${wsProbe.status}（请检查云端 cloudflared 隧道与后端 dsh 进程是否正常运行）。`;
    }
    if (wsProbe.status === 404) {
      return `Cloudflare Tunnel 域名已通，但 ${httpWsTarget} 返回 404（请检查反代路径与 WebSocket 路径 /api/remote.mux）。`;
    }
    return `HTTPS 已可达（${httpWsTarget} 返回 HTTP ${wsProbe.status}），但 WebSocket 升级（Upgrade）失败。请检查 Cloudflare 面板 WebSockets 开关与源站反代 Upgrade/Connection 头转发。`;
  }

  const baseProbe = baseTarget && baseTarget !== httpWsTarget ? await probe(baseTarget) : wsProbe;
  if (baseProbe.reached) {
    return `根地址可达（HTTP ${baseProbe.status}），但 ${httpWsTarget} 无法访问（${wsProbe.err || 'CORS/网络错误'}）。`;
  }

  return `无法访问 ${baseTarget || httpWsTarget}（${baseProbe.err || 'Failed to fetch'}）。请检查 Cloudflare Tunnel 自定义域名解析、HTTPS 证书或当前手机网络状态，也可先点击“浏览器直接打开 HTTPS 测通”验证。`;
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
          'WebSocket 连接超时（15s）。请确认 Cloudflare Tunnel 域名可达且已开启 WebSockets 转发。',
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

function buildAttachmentFromPart(
  raw: Record<string, unknown>,
  serverUrl?: string,
  sessionId?: string
): ChatAttachment | null {
  const partType = String(raw.type || raw.kind || '').toLowerCase();
  const isKnownMediaType =
    partType === 'image' ||
    partType === 'image_url' ||
    partType === 'file' ||
    partType === 'attachment' ||
    partType === 'resource' ||
    partType === 'audio' ||
    partType === 'video';

  const nestedAttachment =
    raw.attachment && typeof raw.attachment === 'object'
      ? (raw.attachment as Record<string, unknown>)
      : null;
  const nestedFile =
    raw.file && typeof raw.file === 'object'
      ? (raw.file as Record<string, unknown>)
      : null;
  const refObj = nestedAttachment || nestedFile;

  const imgUrlObj =
    raw.image_url && typeof raw.image_url === 'object'
      ? (raw.image_url as Record<string, unknown>)
      : null;
  const sourceObj =
    raw.source && typeof raw.source === 'object'
      ? (raw.source as Record<string, unknown>)
      : null;

  const receiptId =
    (typeof raw.receiptId === 'string' && raw.receiptId) ||
    (typeof raw.attachmentId === 'string' && raw.attachmentId) ||
    (typeof raw.fileId === 'string' && raw.fileId) ||
    (refObj && typeof refObj.receiptId === 'string' && refObj.receiptId) ||
    (refObj && typeof refObj.attachmentId === 'string' && refObj.attachmentId) ||
    (refObj && typeof refObj.fileId === 'string' && refObj.fileId) ||
    undefined;

  const rawUrl =
    (typeof raw.downloadUrl === 'string' && raw.downloadUrl) ||
    (typeof raw.url === 'string' && raw.url) ||
    (typeof raw.imageUrl === 'string' && raw.imageUrl) ||
    (typeof raw.fileUrl === 'string' && raw.fileUrl) ||
    (refObj && typeof refObj.downloadUrl === 'string' && refObj.downloadUrl) ||
    (refObj && typeof refObj.url === 'string' && refObj.url) ||
    (typeof raw.image === 'string' && /^(https?:|data:|\/)/i.test(raw.image) ? raw.image : '') ||
    (imgUrlObj && typeof imgUrlObj.url === 'string' ? imgUrlObj.url : '') ||
    undefined;

  const filePath =
    (typeof raw.path === 'string' && raw.path) ||
    (typeof raw.filePath === 'string' && raw.filePath) ||
    (refObj && typeof refObj.path === 'string' && refObj.path) ||
    (refObj && typeof refObj.filePath === 'string' && refObj.filePath) ||
    undefined;

  const rawData =
    (typeof raw.dataUrl === 'string' && raw.dataUrl) ||
    (typeof raw.data === 'string' && raw.data) ||
    (typeof raw.base64 === 'string' && raw.base64) ||
    (typeof raw.base64Data === 'string' && raw.base64Data) ||
    (sourceObj && typeof sourceObj.data === 'string' ? sourceObj.data : '') ||
    (typeof raw.image === 'string' && !/^(https?:|\/)/i.test(raw.image) ? raw.image : '') ||
    '';

  if (!isKnownMediaType && !receiptId && !rawUrl && !rawData) {
    return null;
  }
  if (!receiptId && !rawUrl && !rawData && !filePath) {
    return null;
  }

  let mimeType =
    (typeof raw.mimeType === 'string' && raw.mimeType) ||
    (typeof raw.mediaType === 'string' && raw.mediaType) ||
    (typeof raw.contentType === 'string' && raw.contentType) ||
    (refObj && typeof refObj.mimeType === 'string' && refObj.mimeType) ||
    (refObj && typeof refObj.mediaType === 'string' && refObj.mediaType) ||
    (sourceObj && typeof sourceObj.media_type === 'string' ? sourceObj.media_type : '') ||
    '';

  if (!mimeType && rawData.startsWith('data:')) {
    const m = /^data:([^;,]+)/i.exec(rawData);
    if (m?.[1]) mimeType = m[1];
  }

  const nameFromPath = filePath ? filePath.split('/').pop() || '' : '';
  const nameFromUrl = rawUrl && !rawUrl.startsWith('data:')
    ? rawUrl.split('?')[0].split('/').pop() || ''
    : '';

  const fallbackExt =
    partType === 'image' || partType === 'image_url' || mimeType.startsWith('image/')
      ? 'png'
      : partType === 'audio' || mimeType.startsWith('audio/')
        ? 'mp3'
        : partType === 'video' || mimeType.startsWith('video/')
          ? 'mp4'
          : 'bin';

  const name =
    (typeof raw.filename === 'string' && raw.filename) ||
    (typeof raw.name === 'string' && raw.name) ||
    (typeof raw.fileName === 'string' && raw.fileName) ||
    (refObj && typeof refObj.name === 'string' && refObj.name) ||
    (refObj && typeof refObj.filename === 'string' && refObj.filename) ||
    nameFromPath ||
    (nameFromUrl.includes('.') ? decodeURIComponent(nameFromUrl) : '') ||
    `cloud-file.${fallbackExt}`;

  if (!mimeType) {
    mimeType = inferMimeTypeFromName(
      name,
      partType === 'image' || partType === 'image_url' ? 'image/png' : 'application/octet-stream'
    );
  }

  let dataUrl: string | undefined;
  let base64Data: string | undefined;
  if (rawData) {
    if (rawData.startsWith('data:')) {
      dataUrl = rawData;
      const comma = rawData.indexOf(',');
      base64Data = comma >= 0 ? rawData.slice(comma + 1) : undefined;
    } else if (rawData.length > 32 && /^[A-Za-z0-9+/=\s]+$/.test(rawData.slice(0, 128))) {
      base64Data = rawData.replace(/\s+/g, '');
      dataUrl = `data:${mimeType};base64,${base64Data}`;
    }
  } else if (rawUrl && rawUrl.startsWith('data:')) {
    dataUrl = rawUrl;
    const comma = rawUrl.indexOf(',');
    base64Data = comma >= 0 ? rawUrl.slice(comma + 1) : undefined;
  }

  const resolvedUrl = rawUrl && !rawUrl.startsWith('data:')
    ? resolveCloudFileUrl(rawUrl, serverUrl)
    : undefined;

  const sizeRaw = raw.size ?? raw.sizeBytes ?? raw.bytes ?? refObj?.bytes ?? refObj?.size;
  const size =
    typeof sizeRaw === 'string' && sizeRaw
      ? sizeRaw
      : typeof sizeRaw === 'number'
        ? formatFileBytes(sizeRaw)
        : base64Data
          ? formatFileBytes(Math.round((base64Data.length * 3) / 4))
          : '云端附件';

  return {
    name,
    size,
    mimeType,
    dataUrl,
    base64Data,
    url: resolvedUrl,
    receiptId,
    sessionId,
    filePath,
    direction: 'download',
  };
}

function extractMediaAttachments(
  node: unknown,
  serverUrl?: string,
  sessionId?: string,
  depth = 0
): ChatAttachment[] {
  if (!node || depth > 5) return [];
  const out: ChatAttachment[] = [];
  const seen = new Set<string>();

  const push = (att: ChatAttachment | null) => {
    if (!att) return;
    const key = `${att.receiptId || ''}|${att.url || ''}|${att.filePath || ''}|${att.name}|${att.dataUrl?.slice(0, 48) || ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(att);
  };

  if (Array.isArray(node)) {
    for (const item of node) {
      for (const a of extractMediaAttachments(item, serverUrl, sessionId, depth + 1)) {
        push(a);
      }
    }
    return out;
  }

  if (typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    push(buildAttachmentFromPart(obj, serverUrl, sessionId));

    for (const key of ['parts', 'content', 'attachments', 'files', 'images', 'media', 'artifacts', 'output', 'result']) {
      if (obj[key] && typeof obj[key] === 'object') {
        for (const a of extractMediaAttachments(obj[key], serverUrl, sessionId, depth + 1)) {
          push(a);
        }
      }
    }
  }

  return out;
}

interface FollowParsedEvent {
  isSnapshot?: boolean;
  delta?: string;
  reasoningDelta?: string;
  toolStep?: AgentToolStep;
  attachments?: ChatAttachment[];
  fullText?: string;
  done?: boolean;
  idleSignal?: boolean;
  error?: string;
}

function parseSingleEventObject(
  obj: Record<string, unknown>,
  serverUrl?: string,
  sessionId?: string
): FollowParsedEvent {
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
        chunk.type === 'file' ||
        chunk.type === 'image' ||
        chunk.type === 'attachment' ||
        chunk.type === 'resource'
      ) {
        const atts = extractMediaAttachments(chunk, serverUrl, sessionId);
        return atts.length > 0 ? { attachments: atts } : {};
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
        const rawOut = chunk.result ?? chunk.output;
        const output = rawOut
          ? (typeof rawOut === 'string' ? rawOut : JSON.stringify(rawOut)).slice(0, 260)
          : undefined;
        const atts = extractMediaAttachments(rawOut, serverUrl, sessionId);
        return {
          toolStep: { id, name, status: 'done', output },
          attachments: atts.length > 0 ? atts : undefined,
        };
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
    const rawOut = data.output ?? data.result;
    const output = rawOut
      ? (typeof rawOut === 'string' ? rawOut : JSON.stringify(rawOut)).slice(0, 260)
      : undefined;
    const atts = isDone ? extractMediaAttachments(rawOut, serverUrl, sessionId) : [];
    return {
      toolStep: {
        id,
        name,
        status: isErr ? 'error' : isDone ? 'done' : 'running',
        detail,
        output,
      },
      attachments: atts.length > 0 ? atts : undefined,
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
    const atts = extractMediaAttachments(
      dataMessage || innerMessage || inner,
      serverUrl,
      sessionId
    );
    return {
      fullText: fullText || undefined,
      attachments: atts.length > 0 ? atts : undefined,
      done: false,
    };
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
    const atts = extractMediaAttachments(inner, serverUrl, sessionId);
    return { fullText: maybeText, attachments: atts.length > 0 ? atts : undefined, done: true };
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

function extractFollowEvents(
  rawItem: unknown,
  serverUrl?: string,
  sessionId?: string
): FollowParsedEvent[] {
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
      .map((e) => parseSingleEventObject(e, serverUrl, sessionId));
  }

  return [parseSingleEventObject(obj, serverUrl, sessionId)];
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
  if (!/^https?:\/\/.+/i.test(config.serverUrl.trim())) {
    return [];
  }
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

function extractHistoryMessagesFromSnapshot(
  raw: unknown,
  serverUrl?: string,
  sessionId?: string
): ChatMessage[] {
  const results: ChatMessage[] = [];
  const seenKeys = new Set<string>();

  const pushMsg = (
    role: 'user' | 'assistant',
    text: string,
    ts?: unknown,
    idx?: number,
    attachments?: ChatAttachment[]
  ) => {
    const trimmed = text.trim();
    const hasAtts = Boolean(attachments && attachments.length > 0);
    if (!trimmed && !hasAtts) return;
    const dedup = `${role}:${trimmed.slice(0, 60)}:${idx ?? results.length}:${attachments?.length || 0}`;
    if (seenKeys.has(dedup)) return;
    seenKeys.add(dedup);
    const parsed = role === 'assistant' ? extractRelayCards(trimmed) : { cleanText: trimmed, cards: [] };
    results.push({
      id: `hist-${role}-${results.length}-${Date.now().toString(36)}`,
      role,
      content: parsed.cleanText || trimmed,
      cards: parsed.cards.length > 0 ? parsed.cards : undefined,
      attachments: hasAtts ? attachments : undefined,
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
          const atts = extractMediaAttachments(inner, serverUrl, sessionId);
          pushMsg(roleRaw, text, inner.createdAt ?? inner.timestamp ?? obj.timestamp, i, atts);
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
              const msgs = extractHistoryMessagesFromSnapshot(item, config.serverUrl, cleanId);
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
    return extractHistoryMessagesFromSnapshot(res, config.serverUrl, cleanId);
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

function extractBase64Payload(att: ChatAttachment): string {
  if (att.base64Data) return att.base64Data;
  if (att.dataUrl && att.dataUrl.startsWith('data:')) {
    const idx = att.dataUrl.indexOf(',');
    return idx >= 0 ? att.dataUrl.slice(idx + 1) : att.dataUrl;
  }
  return '';
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const str = String(reader.result || '');
      const comma = str.indexOf(',');
      resolve(comma >= 0 ? str.slice(comma + 1) : str);
    };
    reader.onerror = () => reject(new Error(`读取文件「${file.name}」失败`));
    reader.readAsDataURL(file);
  });
}

async function resolveAttachmentBase64(att: ChatAttachment): Promise<string> {
  const existing = extractBase64Payload(att);
  if (existing) return existing;
  if (att.rawFile) {
    return fileToBase64(att.rawFile);
  }
  if (att.dataUrl && att.dataUrl.startsWith('blob:')) {
    const res = await fetch(att.dataUrl);
    const blob = await res.blob();
    return fileToBase64(new File([blob], att.name || 'attachment.bin', { type: att.mimeType }));
  }
  return '';
}

function estimateAttachmentBytes(att: ChatAttachment): number {
  if (typeof att.sizeBytes === 'number' && att.sizeBytes > 0) return att.sizeBytes;
  if (att.rawFile) return att.rawFile.size;
  const b64 = extractBase64Payload(att);
  if (b64) return Math.round((b64.length * 3) / 4);
  return 0;
}

interface UploadResult {
  receiptId?: string;
  filePath?: string;
  url?: string;
  diagnostic?: string;
  fatal?: boolean;
}

function findUploadResultInPayload(node: unknown, depth = 0): UploadResult | null {
  if (!node || typeof node !== 'object' || depth > 5) return null;
  const obj = node as Record<string, unknown>;

  const receiptId =
    (typeof obj.receiptId === 'string' && obj.receiptId) ||
    (typeof obj.attachmentId === 'string' && obj.attachmentId) ||
    (typeof obj.fileId === 'string' && obj.fileId) ||
    (typeof obj.receipt === 'string' && obj.receipt) ||
    (typeof obj.id === 'string' && obj.id && !obj.sessionId ? obj.id : undefined) ||
    undefined;

  const filePath =
    (typeof obj.filePath === 'string' && obj.filePath) ||
    (typeof obj.savedPath === 'string' && obj.savedPath) ||
    (typeof obj.path === 'string' && obj.path) ||
    undefined;

  const url =
    (typeof obj.downloadUrl === 'string' && obj.downloadUrl) ||
    (typeof obj.fileUrl === 'string' && obj.fileUrl) ||
    (typeof obj.url === 'string' && obj.url) ||
    (typeof obj.uri === 'string' && obj.uri) ||
    undefined;

  if (receiptId || filePath || url) {
    return { receiptId, filePath, url };
  }

  for (const nestedKey of ['payload', 'result', 'value', 'data', 'receipt', 'file', 'attachment']) {
    if (obj[nestedKey] && typeof obj[nestedKey] === 'object') {
      const found = findUploadResultInPayload(obj[nestedKey], depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Streams a raw File/Blob/FormData via XMLHttpRequest with real-time upload progress,
 * exact Content-Length, and dynamic timeout (no base64 memory bloat).
 */
function xhrPostBinary(
  url: string,
  body: Blob | FormData,
  contentType: string | null,
  timeoutMs: number,
  signal?: AbortSignal,
  onProgress?: (loaded: number, total: number) => void
): Promise<{ status: number; ok: boolean; text: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    xhr.timeout = timeoutMs;
    if (contentType) {
      xhr.setRequestHeader('Content-Type', contentType);
    }

    const onAbort = () => {
      xhr.abort();
      const abortErr = new Error('已取消上传');
      abortErr.name = 'AbortError';
      reject(abortErr);
    };
    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    const cleanup = () => {
      if (signal) signal.removeEventListener('abort', onAbort);
    };

    if (onProgress && xhr.upload) {
      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable && ev.total > 0) {
          onProgress(ev.loaded, ev.total);
        }
      };
    }

    xhr.onload = () => {
      cleanup();
      resolve({
        status: xhr.status,
        ok: xhr.status >= 200 && xhr.status < 300,
        text: typeof xhr.responseText === 'string' ? xhr.responseText : '',
      });
    };

    xhr.ontimeout = () => {
      cleanup();
      reject(new Error(`上传超时（${Math.round(timeoutMs / 1000)}s）`));
    };

    xhr.onerror = () => {
      cleanup();
      reject(new Error('NETWORK_OR_CORS_ERROR'));
    };

    xhr.send(body);
  });
}

const HTTP_413_HINT =
  'HTTP 413 文件体积超出服务端/反代限制（若云端使用 Nginx 反代，默认 client_max_body_size 仅 1MB，请在 Nginx 配置中添加 client_max_body_size 100m; 并 reload）';

/**
 * Uploads any image or arbitrary binary file (PDF, Word, Excel, PPT, ZIP, audio, video, etc.)
 * using the exact official DeepSeek Harness raw-byte route:
 *   POST /api/session/uploadFileBinary?sessionId=<id>&name=<leafName>
 *   Content-Type: application/octet-stream
 *   <raw file bytes>
 * Streams native File objects directly on Web (zero base64 overhead, live progress, 60-180s timeout).
 */
async function uploadAttachmentToDsh(
  config: ConnectionConfig,
  sessionId: string,
  att: ChatAttachment,
  signal?: AbortSignal,
  onProgress?: (loaded: number, total: number) => void
): Promise<UploadResult> {
  const base = config.serverUrl.trim().replace(/\/+$/, '');
  const hasPayload = Boolean(att.rawFile || att.base64Data || att.dataUrl);
  if (!base || !hasPayload) return { diagnostic: '附件数据为空', fatal: true };

  const mimeType = att.mimeType || inferMimeTypeFromName(att.name || 'attachment.bin');
  const filename = (att.name || 'attachment.bin').replace(/^.*[\\/]/, '');
  const byteSize = estimateAttachmentBytes(att);
  // Dynamic timeout: 60s baseline + ~2s per 100KB, capped at 180s
  const uploadTimeoutMs = Math.min(
    180_000,
    Math.max(60_000, 45_000 + Math.ceil(byteSize / 102_400) * 2000)
  );

  // Official DSH (@deepseek-ai/dsh-client-file-upload) uses `sessionId` and `name`
  const officialQuery = new URLSearchParams({
    sessionId,
    name: filename,
  }).toString();

  const cachedPrefix = unaryPrefixCache.get(base);
  const prefixes = cachedPrefix
    ? [cachedPrefix, cachedPrefix === '/api' ? '/api/remote' : '/api']
    : ['/api', '/api/remote'];

  const nativeAvailable = isNativeDshSocketAvailable();
  let cachedBase64: string | null = null;
  const getBase64 = async (): Promise<string> => {
    if (cachedBase64 === null) {
      cachedBase64 = await resolveAttachmentBase64(att);
    }
    return cachedBase64;
  };

  let cachedBlob: Blob | null = att.rawFile || null;
  const getRawBlob = async (): Promise<Blob> => {
    if (cachedBlob) return cachedBlob;
    const b64 = await getBase64();
    const bytes = base64ToUint8Array(b64);
    cachedBlob = new Blob([bytes as unknown as BlobPart], { type: mimeType });
    return cachedBlob;
  };

  // Official DSH uploadFileBinary strictly expects raw binary with Content-Type: application/octet-stream
  const modes: Array<'raw' | 'multipart'> = ['raw', 'multipart'];
  let lastDiag = '';

  for (const prefix of prefixes) {
    const urlWithQuery = `${base}${prefix}/session/uploadFileBinary?${officialQuery}`;
    let routeNotFound = false;

    for (const mode of modes) {
      if (signal?.aborted) {
        const abortErr = new Error('已取消上传');
        abortErr.name = 'AbortError';
        throw abortErr;
      }

      try {
        // 1. Native Android APK path via OkHttp (with 60-180s write/read timeout)
        if (nativeAvailable) {
          const base64Data = await getBase64();
          if (!base64Data) return { diagnostic: '无法读取附件二进制数据', fatal: true };
          const nativeRes = await uploadBinaryNativeIfAvailable({
            url: urlWithQuery,
            base64Data,
            mimeType: mode === 'raw' ? 'application/octet-stream' : mimeType,
            filename,
            sessionId,
            mode,
            timeoutMs: uploadTimeoutMs,
          });

          if (nativeRes) {
            if (nativeRes.ok && nativeRes.body) {
              try {
                const parsed = JSON.parse(nativeRes.body);
                const found = findUploadResultInPayload(parsed);
                if (found) {
                  unaryPrefixCache.set(base, prefix);
                  return found;
                }
              } catch {
                // ignore non-json
              }
            }
            const snippet = nativeRes.body ? ` ${nativeRes.body.slice(0, 140)}` : '';
            lastDiag = `${prefix}/session/uploadFileBinary (${mode}) -> HTTP ${nativeRes.status}${snippet}`;
            if (nativeRes.status === 404 || nativeRes.status === 405) {
              routeNotFound = true;
              break;
            }
            if (nativeRes.status === 413) {
              return { diagnostic: HTTP_413_HINT, fatal: true };
            }
            if (nativeRes.status === 401 || nativeRes.status === 403) {
              return { diagnostic: `HTTP ${nativeRes.status} 上传被服务端拒绝${snippet}`, fatal: true };
            }
            continue;
          }
        }

        // 2. Standard Web/PWA path via XMLHttpRequest streaming raw File/Blob directly
        const blob = await getRawBlob();
        let res: { status: number; ok: boolean; text: string };
        if (mode === 'raw') {
          res = await xhrPostBinary(
            urlWithQuery,
            blob,
            'application/octet-stream',
            uploadTimeoutMs,
            signal,
            onProgress
          );
        } else {
          const form = new FormData();
          form.append('sessionId', sessionId);
          form.append('name', filename);
          form.append('file', blob, filename);
          res = await xhrPostBinary(urlWithQuery, form, null, uploadTimeoutMs, signal, onProgress);
        }

        if (res.ok) {
          try {
            const parsed = JSON.parse(res.text);
            const found = findUploadResultInPayload(parsed);
            if (found) {
              unaryPrefixCache.set(base, prefix);
              return found;
            }
          } catch {
            // ignore
          }
        }
        const snippet = res.text ? ` ${res.text.slice(0, 140)}` : '';
        lastDiag = `${prefix}/session/uploadFileBinary (${mode}) -> HTTP ${res.status}${snippet}`;
        if (res.status === 404 || res.status === 405) {
          routeNotFound = true;
          break;
        }
        if (res.status === 413) {
          return { diagnostic: HTTP_413_HINT, fatal: true };
        }
        if (res.status === 401 || res.status === 403) {
          return { diagnostic: `HTTP ${res.status} 上传被服务端拒绝${snippet}`, fatal: true };
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError' && signal?.aborted) throw err;
        const rawErrMsg = err instanceof Error ? err.message : '网络异常';
        if (rawErrMsg === 'NETWORK_OR_CORS_ERROR') {
          const msg =
            byteSize > 1_000_000
              ? '上传被中断或触发反代体积限制（浏览器下 Nginx 默认 1MB 限制返回的 413 无 CORS 头也会表现为网络错误，请检查 Nginx client_max_body_size 或改用 Android APK 直连）'
              : '网络中断或跨域被拦截（请检查 Cloudflare Tunnel 与源站状态）';
          lastDiag = `${prefix}/session/uploadFileBinary (${mode}) -> ${msg}`;
          if (byteSize > 1_000_000) {
            return { diagnostic: lastDiag, fatal: true };
          }
        } else {
          lastDiag = `${prefix}/session/uploadFileBinary (${mode}) -> ${rawErrMsg}`;
          if (byteSize > 1_500_000 && lastDiag.includes('超时')) {
            return { diagnostic: lastDiag, fatal: true };
          }
        }
      }
    }

    if (!routeNotFound) {
      break;
    }
  }

  // Fallback: try unary JSON uploadFile RPC ONLY for small files (<= 2 MB)
  if (byteSize <= 2 * 1024 * 1024) {
    const base64Data = await getBase64();
    if (base64Data) {
      const unaryPayloads: Array<Record<string, unknown>> = [
        { sessionId, name: filename, mediaType: mimeType, data: base64Data },
        { sessionId, filename, mimeType, dataBase64: base64Data },
      ];
      for (const req of unaryPayloads) {
        try {
          const unaryRes = await callDshHttpUnary(
            config,
            'session/uploadFile',
            { request: req },
            signal,
            25000
          );
          const found = findUploadResultInPayload(unaryRes);
          if (found) return found;
        } catch (err) {
          const msg = err instanceof Error ? err.message : '';
          if (msg.includes('413')) {
            return { diagnostic: HTTP_413_HINT, fatal: true };
          }
          if (msg.includes('404') || msg.includes('405') || msg.includes('超时')) {
            break;
          }
        }
      }
    }
  }

  return { diagnostic: lastDiag || '二进制上传接口不可用' };
}

interface UploadedAttachmentEntry {
  receiptId?: string;
  filePath?: string;
  url?: string;
  att: ChatAttachment;
}

interface PromptPayloadCandidate {
  content: Record<string, unknown>[];
  submittedAttachments?: Record<string, unknown>[];
}

function buildMultimodalContentCandidates(
  prompt: string,
  attachments?: ChatAttachment[],
  uploadedEntries?: UploadedAttachmentEntry[]
): PromptPayloadCandidate[] {
  const baseText = buildTextWithFileAttachments(prompt, attachments);
  const mediaAttachments = (attachments || []).filter(
    (att) => !att.textContent && Boolean(att.rawFile || att.base64Data || att.dataUrl)
  );

  if (mediaAttachments.length === 0) {
    return [{ content: [{ type: 'text', text: baseText }] }];
  }

  // Append server-side file path / URL notes when upload returned a path or download URL
  const pathNotes = (uploadedEntries || [])
    .filter((e) => e.filePath || e.url)
    .map(
      (e) =>
        `[已上传附件: ${e.att.name} (${e.att.mimeType}, ${e.att.size})${
          e.filePath ? ` · 云端路径: ${e.filePath}` : ''
        }${e.url ? ` · 链接: ${e.url}` : ''}]`
    );
  const combinedText = pathNotes.length > 0 ? `${baseText}\n\n${pathNotes.join('\n')}` : baseText;

  const candidates: PromptPayloadCandidate[] = [];
  const receiptEntries = (uploadedEntries || []).filter((e) => Boolean(e.receiptId));
  const allAreImages = mediaAttachments.every((a) => a.mimeType.startsWith('image/'));

  // #1 Official DeepSeek Harness format: staged receiptId via POST /api/session/uploadFileBinary
  // Works for BOTH images and arbitrary files (PDF, Word, Excel, PPT, ZIP, audio, video, etc.)
  if (receiptEntries.length === mediaAttachments.length) {
    const fileParts = receiptEntries.map((r) => ({ type: 'file', receiptId: r.receiptId }));
    candidates.push(
      { content: [...fileParts, { type: 'text', text: combinedText }] },
      { content: [{ type: 'text', text: combinedText }, ...fileParts] },
      { content: [{ type: 'text', text: combinedText }], submittedAttachments: fileParts }
    );
  } else if (pathNotes.length === mediaAttachments.length) {
    candidates.push({ content: [{ type: 'text', text: combinedText }] });
  }

  // #2 Official DeepSeek Harness inline image parts (`mediaType` + `data` + `name`)
  if (allAreImages) {
    const officialInlineImages = mediaAttachments.map((att) => ({
      type: 'image',
      mediaType: att.mimeType,
      data: extractBase64Payload(att),
      name: att.name,
    }));
    candidates.push(
      { content: [{ type: 'text', text: combinedText }, ...officialInlineImages] },
      { content: [{ type: 'text', text: combinedText }], submittedAttachments: officialInlineImages },
      {
        content: [
          { type: 'text', text: combinedText },
          ...mediaAttachments.map((att) => ({
            type: 'image',
            mediaType: att.mimeType,
            data: extractBase64Payload(att),
          })),
        ],
      },
      {
        content: [
          { type: 'text', text: combinedText },
          ...mediaAttachments.map((att) => ({
            type: 'image',
            mimeType: att.mimeType,
            data: extractBase64Payload(att),
          })),
        ],
      },
      {
        content: [
          { type: 'text', text: combinedText },
          ...mediaAttachments.map((att) => {
            const b64 = extractBase64Payload(att);
            return {
              type: 'image_url',
              image_url: {
                url:
                  att.dataUrl && att.dataUrl.startsWith('data:')
                    ? att.dataUrl
                    : b64
                      ? `data:${att.mimeType};base64,${b64}`
                      : '',
              },
            };
          }),
        ],
      }
    );
  } else if (receiptEntries.length < mediaAttachments.length) {
    // Non-image binary files when uploadFileBinary was unavailable: try structured file parts
    candidates.push(
      {
        content: [
          { type: 'text', text: combinedText },
          ...mediaAttachments.map((att) =>
            att.mimeType.startsWith('image/')
              ? {
                  type: 'image',
                  mediaType: att.mimeType,
                  data: extractBase64Payload(att),
                  name: att.name,
                }
              : {
                  type: 'file',
                  name: att.name,
                  filename: att.name,
                  mediaType: att.mimeType,
                  data: extractBase64Payload(att),
                }
          ),
        ],
      },
      {
        content: [
          { type: 'text', text: combinedText },
          ...mediaAttachments.map((att) =>
            att.mimeType.startsWith('image/')
              ? {
                  type: 'image',
                  mimeType: att.mimeType,
                  data: extractBase64Payload(att),
                }
              : {
                  type: 'file',
                  filename: att.name,
                  mimeType: att.mimeType,
                  data: extractBase64Payload(att),
                }
          ),
        ],
      }
    );
  }

  return candidates;
}

/**
 * Full DeepSeek Harness Typert Gateway conversation turn:
 * 1. Unary HTTP POST `session/create` to obtain/reuse `sessionId`
 * 2. Upload any images or arbitrary files BEFORE opening WS follow
 * 3. Stream WS `/api/remote.mux` `session/follow` (`assistantStream: true`) to subscribe to live chunks & media
 * 4. Unary HTTP POST `session/prompt` (with automatic multimodal & arbitrary-file adaptation)
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
    let wsOpened = false;
    let diagnosingError = false;
    let accumulated = '';
    let accumulatedThinking = '';
    const toolStepsMap = new Map<string, AgentToolStep>();
    const receivedAttachments: ChatAttachment[] = [];
    const receivedAttKeys = new Set<string>();
    const startedAt = performance.now();
    let ws: DshWebSocketLike | null = null;
    let mux: SingleTurnMuxHelper | null = null;
    let followStreamId: string | null = null;
    let sawPostPromptEvent = false;
    const recentRawFrames: string[] = [];

    const appendReceivedAttachments = (atts?: ChatAttachment[]) => {
      if (!atts || atts.length === 0) return false;
      let added = false;
      for (const att of atts) {
        const key = `${att.receiptId || ''}|${att.url || ''}|${att.filePath || ''}|${att.name}|${att.dataUrl?.slice(0, 48) || ''}`;
        if (!receivedAttKeys.has(key)) {
          receivedAttKeys.add(key);
          receivedAttachments.push(att);
          added = true;
        }
      }
      return added;
    };

    const emitUpdate = (done: boolean) => {
      const { cleanText, cards, syncPayloads } = extractRelayCards(accumulated);
      const steps = Array.from(toolStepsMap.values()).map((s) =>
        done && s.status === 'running' ? { ...s, status: 'done' as const } : s
      );
      onChunk({
        text: done
          ? cleanText || accumulated || (receivedAttachments.length > 0 ? '已为你发送以下文件：' : '（Agent 已完成本轮回复）')
          : cleanText,
        cards,
        syncPayloads: syncPayloads.length > 0 ? syncPayloads : undefined,
        attachments: receivedAttachments.length > 0 ? [...receivedAttachments] : undefined,
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

    let connectTimer = 0;

    const mediaAttachments = (options?.attachments || []).filter(
      (att) => !att.textContent && Boolean(att.rawFile || att.base64Data || att.dataUrl)
    );
    const hasMedia = mediaAttachments.length > 0;
    const allImages = hasMedia && mediaAttachments.every((a) => a.mimeType.startsWith('image/'));
    let lastUploadDiagnostic = '';
    let idleTimer = window.setTimeout(() => {}, 0);
    let currentIdleMs = hasMedia ? 120000 : 60000;

    const resetIdleTimer = (ms = hasMedia ? 120000 : 60000) => {
      currentIdleMs = ms;
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => {
        if (accumulated || receivedAttachments.length > 0) {
          emitUpdate(true);
          succeed();
        } else {
          const sample =
            recentRawFrames.length > 0
              ? ` 期间收到原始帧样本：${recentRawFrames.join(' | ')}`
              : '';
          const uploadHint = lastUploadDiagnostic ? `（附件状态：${lastUploadDiagnostic}）` : '';
          fail(
            new Error(
              `已提交消息到 DeepSeek Harness，但等待流式回复超时（${Math.round(currentIdleMs / 1000)}s）。${uploadHint}${sample}`
            )
          );
        }
      }, ms);
    };

    const startTurn = async () => {
      try {
        // Step 1: Ensure sessionId via HTTP POST unary carrier BEFORE opening WS
        const hasExplicitOverride = options?.sessionIdOverride !== undefined;
        let sessionId = hasExplicitOverride
          ? options?.sessionIdOverride?.trim() || ''
          : config.sessionId?.trim() || sessionCache.get(cacheKey) || loadStoredSession(cacheKey) || '';

        if (!sessionId) {
          const createRequests: Array<Record<string, unknown>> = [
            { cwd: '/root/.dsh/im' },
            { workspaceId: config.workspace.trim() || undefined },
          ];
          let createRes: unknown = null;
          let lastErr = '';
          for (const request of createRequests) {
            try {
              createRes = await callDshHttpUnary(config, 'session/create', { request }, signal, 20000);
              if (findSessionIdInPayload(createRes)) break;
            } catch (createErr) {
              lastErr = createErr instanceof Error ? createErr.message : String(createErr);
              if (lastErr.includes('unexpected "request"')) {
                try {
                  createRes = await callDshHttpUnary(config, 'session/create', request, signal, 20000);
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

        // Step 2: Upload binary/image/arbitrary attachments BEFORE opening WS follow
        // so Cloudflare Tunnel doesn't idle/drop the WebSocket while media is uploading
        const uploadedEntries: UploadedAttachmentEntry[] = [];
        let effectiveAttachments = options?.attachments;
        if (hasMedia) {
          const mediaLabel = allImages ? '图片' : '文件';
          toolStepsMap.set('relay-upload', {
            id: 'relay-upload',
            name: `上传${mediaLabel} (${mediaAttachments.length})`,
            status: 'running',
            detail: mediaAttachments.map((a) => `${a.name} · ${a.size}`).join(', '),
          });
          emitUpdate(false);

          for (let i = 0; i < mediaAttachments.length; i++) {
            const att = mediaAttachments[i];
            let lastEmit = 0;
            const res = await uploadAttachmentToDsh(config, sessionId, att, signal, (loaded, total) => {
              const now = performance.now();
              if (now - lastEmit < 180 && loaded < total) return;
              lastEmit = now;
              const pct = Math.min(100, Math.round((loaded / total) * 100));
              toolStepsMap.set('relay-upload', {
                id: 'relay-upload',
                name: `正在上传${mediaLabel} ${pct}%`,
                status: 'running',
                detail: `${att.name} (${formatFileBytes(loaded)} / ${formatFileBytes(total)})`,
              });
              emitUpdate(false);
            });

            if (res.receiptId || res.filePath || res.url) {
              uploadedEntries.push({
                receiptId: res.receiptId,
                filePath: res.filePath,
                url: res.url,
                att,
              });
            } else {
              lastUploadDiagnostic = res.diagnostic || '上传失败';
              const isImage = att.mimeType.startsWith('image/');
              const approxSize = estimateAttachmentBytes(att);
              // Fail fast on fatal errors (e.g. HTTP 413 / 403 / timeout) OR for non-image binary files / large images (>2MB)
              // instead of silently attempting doomed inline JSON base64 submission
              if (res.fatal || !isImage || approxSize > 2 * 1024 * 1024) {
                toolStepsMap.set('relay-upload', {
                  id: 'relay-upload',
                  name: `${mediaLabel}上传失败`,
                  status: 'error',
                  detail: `${att.name} · ${att.size}`,
                  output: lastUploadDiagnostic,
                });
                emitUpdate(false);
                throw new Error(`上传附件「${att.name}」(${att.size}) 失败：${lastUploadDiagnostic}`);
              }
            }
          }

          const allUploaded = uploadedEntries.length === mediaAttachments.length;
          // Only materialize inline base64 when small images fell back to inline submission
          if (!allUploaded && effectiveAttachments) {
            effectiveAttachments = await Promise.all(
              effectiveAttachments.map(async (att) => {
                if (att.textContent || att.base64Data) return att;
                const b64 = await resolveAttachmentBase64(att);
                return b64 ? { ...att, base64Data: b64 } : att;
              })
            );
          }

          toolStepsMap.set('relay-upload', {
            id: 'relay-upload',
            name: allUploaded ? `${mediaLabel}上传完成` : `切换内联${mediaLabel}直传`,
            status: 'done',
            output: allUploaded
              ? `已上传 ${uploadedEntries.length} 个附件至云端，正在交给 Agent 处理`
              : lastUploadDiagnostic || '已切换为消息内联传输',
          });
          emitUpdate(false);
        }

        if (signal?.aborted) {
          const abortErr = new Error('已手动停止生成');
          abortErr.name = 'AbortError';
          throw abortErr;
        }

        // Step 3: Open fresh WS connection and subscribe to `session/follow`
        connectTimer = window.setTimeout(() => {
          fail(
            new Error(
              `连接 ${wsUrl} 超时（15s），请确认 Cloudflare Tunnel 域名可达且 WebSocket 转发正常。`
            )
          );
        }, 15000);

        try {
          ws = createDshWebSocket(wsUrl);
        } catch (err) {
          fail(new Error(`WebSocket 地址无效：${err instanceof Error ? err.message : wsUrl}`));
          return;
        }

        ws.onopen = async () => {
          wsOpened = true;
          window.clearTimeout(connectTimer);
          resetIdleTimer(hasMedia ? 120000 : 60000);
          if (!ws) return;
          mux = new SingleTurnMuxHelper(ws);

          try {
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
                resetIdleTimer(hasMedia ? 120000 : 60000);
                try {
                  const rawPreview = JSON.stringify(item).slice(0, 320);
                  if (rawPreview) {
                    recentRawFrames.push(rawPreview);
                    if (recentRawFrames.length > 3) recentRawFrames.shift();
                  }
                } catch {
                  // ignore serialization error
                }
                const events = extractFollowEvents(item, config.serverUrl, sessionId);
                for (const info of events) {
                  if (info.isSnapshot) continue;
                  if (!sawPostPromptEvent) continue;

                  if (info.error) {
                    fail(new Error(`Agent 执行出错：${info.error}`));
                    return;
                  }
                  if (info.attachments && appendReceivedAttachments(info.attachments)) {
                    emitUpdate(false);
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
                  if (
                    info.done ||
                    (info.idleSignal && (accumulated.length > 0 || receivedAttachments.length > 0))
                  ) {
                    emitUpdate(true);
                    succeed();
                    return;
                  }
                }
              },
              onEnd: () => {
                if (!settled && (accumulated || receivedAttachments.length > 0)) {
                  emitUpdate(true);
                  succeed();
                }
              },
              onError: (errMsg) => {
                if (!settled && !accumulated && receivedAttachments.length === 0) {
                  fail(new Error(`订阅会话流 (session/follow) 失败：${errMsg}`));
                }
              },
            });

            // Step 4: Submit prompt via HTTP POST unary carrier
            const requestId = mintStreamId();
            const clientTimeZone = getClientTimeZone();
            sawPostPromptEvent = true;

            const contentCandidates = buildMultimodalContentCandidates(
              prompt,
              effectiveAttachments,
              uploadedEntries
            );
            let promptRes: unknown;
            let lastPromptError: Error | null = null;

            for (let idx = 0; idx < contentCandidates.length; idx++) {
              const candidate = contentCandidates[idx];
              const reqBody: Record<string, unknown> = {
                requestId: idx === 0 ? requestId : mintStreamId(),
                sessionId,
                mode: 'queue',
                content: candidate.content,
                clientTimeZone,
                ...(candidate.submittedAttachments
                  ? { submittedAttachments: candidate.submittedAttachments }
                  : {}),
              };

              try {
                promptRes = await callDshHttpUnary(
                  config,
                  promptEndpoint,
                  { request: reqBody },
                  signal,
                  hasMedia ? 45000 : 25000
                );
                lastPromptError = null;
                break;
              } catch (promptErr) {
                if ((promptErr as Error).name === 'AbortError') throw promptErr;
                const msg = promptErr instanceof Error ? promptErr.message : String(promptErr);
                lastPromptError = new Error(msg);

                // Do NOT waste time retrying inline payloads on network timeout or 413
                if (msg.includes('超时') || msg.includes('413') || msg.includes('524') || msg.includes('504')) {
                  break;
                }

                const isBoundaryError =
                  msg.includes('boundary validation') ||
                  msg.includes('invalid_value') ||
                  msg.includes('invalid_union') ||
                  msg.includes('invalid_type') ||
                  msg.includes('unrecognized_keys') ||
                  msg.toLowerCase().includes('content') ||
                  msg.toLowerCase().includes('submittedattachments') ||
                  msg.toLowerCase().includes('unsupported');

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
                    signal,
                    hasMedia ? 45000 : 25000
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
                    signal,
                    25000
                  );
                  lastPromptError = null;
                  break;
                }

                break;
              }
            }

            if (lastPromptError) {
              const uploadHint = lastUploadDiagnostic ? `（上传详情：${lastUploadDiagnostic}）` : '';
              throw new Error(`提交消息 (${promptEndpoint}) 失败：${lastPromptError.message}${uploadHint}`);
            }

            // Fresh inference window after prompt is confirmed accepted by server
            resetIdleTimer(hasMedia ? 120000 : 60000);

            // If the unary prompt response itself already contains reply text or media, render it immediately
            if (promptRes && typeof promptRes === 'object') {
              const maybeText =
                extractTextParts((promptRes as Record<string, unknown>).content) ||
                (typeof (promptRes as Record<string, unknown>).reply === 'string'
                  ? String((promptRes as Record<string, unknown>).reply)
                  : '');
              const maybeAtts = extractMediaAttachments(promptRes, config.serverUrl, sessionId);
              if (maybeAtts.length > 0) appendReceivedAttachments(maybeAtts);
              if ((maybeText || receivedAttachments.length > 0) && !accumulated) {
                if (maybeText) accumulated = maybeText;
                emitUpdate(true);
                succeed();
              }
            }
          } catch (err) {
            fail(err instanceof Error ? err : new Error(String(err)));
          }
        };

        ws.onerror = () => {
          if (settled) return;
          if (!wsOpened) {
            diagnosingError = true;
            window.clearTimeout(connectTimer);
            window.clearTimeout(idleTimer);
            void diagnoseWsHandshakeFailure(config.serverUrl, wsUrl).then((detail) => {
              fail(new Error(detail));
            });
          }
        };

        ws.onclose = (ev) => {
          if (!settled && !diagnosingError) {
            if (accumulated || receivedAttachments.length > 0) {
              emitUpdate(true);
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
      } catch (err) {
        fail(err instanceof Error ? err : new Error(String(err)));
      }
    };

    void startTurn();
  });
}
