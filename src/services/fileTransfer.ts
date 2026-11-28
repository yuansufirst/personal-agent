import type { ChatAttachment } from '../types/relay';
import { downloadBinaryNativeIfAvailable } from './nativeSocket';
import { saveBinaryFileToDevice } from './deviceBridge';

export type FileCategory =
  | 'image'
  | 'pdf'
  | 'word'
  | 'excel'
  | 'ppt'
  | 'archive'
  | 'audio'
  | 'video'
  | 'code'
  | 'text'
  | 'binary';

export interface FileTypeMeta {
  category: FileCategory;
  badge: string;
  accentClass: string;
  tintVar: string;
}

export const TEXT_FILE_EXT_REGEX =
  /\.(txt|md|markdown|json|jsonl|csv|tsv|log|yaml|yml|toml|xml|html|htm|css|scss|less|js|mjs|cjs|ts|tsx|jsx|py|pyi|sh|bash|zsh|ps1|bat|go|rs|java|kt|swift|c|cc|cpp|h|hpp|cs|php|rb|lua|r|m|dart|sql|ini|conf|cfg|env|tex|bib|ipynb|srt|vtt|svg|gradle|cmake|properties|dockerfile|gitignore)$/i;

const EXT_TO_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  heic: 'image/heic',
  avif: 'image/avif',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip',
  rar: 'application/vnd.rar',
  '7z': 'application/x-7z-compressed',
  tar: 'application/x-tar',
  gz: 'application/gzip',
  tgz: 'application/gzip',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  aac: 'audio/aac',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  txt: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
  csv: 'text/csv',
  html: 'text/html',
  xml: 'application/xml',
  yaml: 'text/yaml',
  yml: 'text/yaml',
  epub: 'application/epub+zip',
  apk: 'application/vnd.android.package-archive',
};

const DOWNLOADABLE_URL_EXT_REGEX =
  /\.(png|jpe?g|webp|gif|bmp|svg|pdf|docx?|xlsx?|pptx?|zip|rar|7z|tar|gz|tgz|mp3|wav|m4a|ogg|flac|mp4|webm|mov|csv|json|md|txt|epub|apk|ipynb|py|ts|js|tex|bib)(?:[?#].*)?$/i;

export function formatFileBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '未知大小';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function inferMimeTypeFromName(filename: string, fallback = 'application/octet-stream'): string {
  const clean = filename.split('?')[0].split('#')[0];
  const dot = clean.lastIndexOf('.');
  if (dot >= 0) {
    const ext = clean.slice(dot + 1).toLowerCase();
    if (EXT_TO_MIME[ext]) return EXT_TO_MIME[ext];
  }
  return fallback;
}

export function isImageAttachment(att: Pick<ChatAttachment, 'name' | 'mimeType' | 'dataUrl' | 'url'>): boolean {
  if (att.mimeType && att.mimeType.startsWith('image/')) return true;
  if (att.dataUrl && att.dataUrl.startsWith('data:image/')) return true;
  const target = att.name || att.url || '';
  return /\.(png|jpe?g|webp|gif|bmp|svg|heic|avif)(?:[?#].*)?$/i.test(target);
}

export function isAudioAttachment(att: Pick<ChatAttachment, 'name' | 'mimeType'>): boolean {
  if (att.mimeType && att.mimeType.startsWith('audio/')) return true;
  return /\.(mp3|wav|m4a|ogg|flac|aac)$/i.test(att.name || '');
}

export function isVideoAttachment(att: Pick<ChatAttachment, 'name' | 'mimeType'>): boolean {
  if (att.mimeType && att.mimeType.startsWith('video/')) return true;
  return /\.(mp4|webm|mov|mkv)$/i.test(att.name || '');
}

export function isLikelyDownloadableLink(href: string): boolean {
  if (!href) return false;
  if (href.startsWith('data:')) return true;
  if (DOWNLOADABLE_URL_EXT_REGEX.test(href)) return true;
  return /\/(?:download|downloadFile|files?|attachments?|media|assets)\b|receiptId=|fileId=/i.test(href);
}

export function getFileTypeMeta(filename: string, mimeType = ''): FileTypeMeta {
  const lower = (filename || '').toLowerCase();
  const mime = (mimeType || '').toLowerCase();

  if (mime.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|svg|heic|avif)$/.test(lower)) {
    return { category: 'image', badge: 'IMG', accentClass: 'text-sky-300', tintVar: 'var(--tint-cyan)' };
  }
  if (mime === 'application/pdf' || lower.endsWith('.pdf')) {
    return { category: 'pdf', badge: 'PDF', accentClass: 'text-rose-300', tintVar: 'var(--tint-rose)' };
  }
  if (mime.includes('word') || /\.(docx?|rtf|odt)$/.test(lower)) {
    return { category: 'word', badge: 'WORD', accentClass: 'text-blue-300', tintVar: 'var(--tint-blue)' };
  }
  if (mime.includes('sheet') || mime.includes('excel') || /\.(xlsx?|csv|tsv|ods)$/.test(lower)) {
    return { category: 'excel', badge: 'TABLE', accentClass: 'text-emerald-300', tintVar: 'var(--tint-emerald)' };
  }
  if (mime.includes('presentation') || mime.includes('powerpoint') || /\.(pptx?|key)$/.test(lower)) {
    return { category: 'ppt', badge: 'PPT', accentClass: 'text-amber-300', tintVar: 'var(--tint-amber)' };
  }
  if (
    mime.includes('zip') ||
    mime.includes('rar') ||
    mime.includes('tar') ||
    mime.includes('gzip') ||
    mime.includes('7z') ||
    /\.(zip|rar|7z|tar|gz|tgz|bz2|xz)$/.test(lower)
  ) {
    return { category: 'archive', badge: 'ZIP', accentClass: 'text-violet-300', tintVar: 'var(--tint-violet)' };
  }
  if (mime.startsWith('audio/') || /\.(mp3|wav|m4a|ogg|flac|aac)$/.test(lower)) {
    return { category: 'audio', badge: 'AUDIO', accentClass: 'text-teal-300', tintVar: 'var(--tint-teal)' };
  }
  if (mime.startsWith('video/') || /\.(mp4|webm|mov|mkv|avi)$/.test(lower)) {
    return { category: 'video', badge: 'VIDEO', accentClass: 'text-indigo-300', tintVar: 'var(--tint-blue)' };
  }
  if (/\.(py|ts|tsx|js|jsx|go|rs|java|kt|c|cpp|h|sh|sql|json|yaml|yml|xml|html|css|ipynb|tex|bib)$/.test(lower)) {
    const ext = lower.split('.').pop()?.toUpperCase().slice(0, 5) || 'CODE';
    return { category: 'code', badge: ext, accentClass: 'text-cyan-300', tintVar: 'var(--tint-cyan)' };
  }
  if (mime.startsWith('text/') || /\.(txt|md|markdown|log|ini|conf)$/.test(lower)) {
    return { category: 'text', badge: 'TEXT', accentClass: 'text-zinc-200', tintVar: 'var(--tint-emerald)' };
  }
  const ext = lower.includes('.') ? lower.split('.').pop()?.toUpperCase().slice(0, 5) : 'FILE';
  return { category: 'binary', badge: ext || 'FILE', accentClass: 'text-zinc-200', tintVar: 'var(--tint-violet)' };
}

/**
 * Resolves relative paths returned by a cloud Agent (e.g. `/api/files/out.png`) against serverUrl.
 */
export function resolveCloudFileUrl(rawUrl: string | undefined, serverUrl?: string): string {
  const clean = (rawUrl || '').trim();
  if (!clean) return '';
  if (/^(https?:|data:|blob:)/i.test(clean)) return clean;
  const base = (serverUrl || '').trim().replace(/\/+$/, '');
  if (!base) return clean;
  if (clean.startsWith('//')) return `https:${clean}`;
  if (clean.startsWith('/')) return `${base}${clean}`;
  return `${base}/${clean}`;
}

/**
 * Builds candidate download URLs for cloud-hosted files (direct URL, DSH receiptId, or workspace path).
 */
export function buildCloudDownloadCandidates(
  serverUrl: string | undefined,
  opts: {
    url?: string;
    receiptId?: string;
    sessionId?: string;
    filePath?: string;
    filename?: string;
  }
): string[] {
  const out: string[] = [];
  const pushUnique = (u: string) => {
    if (u && !out.includes(u)) out.push(u);
  };

  if (opts.url) {
    pushUnique(resolveCloudFileUrl(opts.url, serverUrl));
  }

  const base = (serverUrl || '').trim().replace(/\/+$/, '');
  if (!base) return out;

  if (opts.receiptId) {
    const rid = encodeURIComponent(opts.receiptId);
    const sid = opts.sessionId ? `&sessionId=${encodeURIComponent(opts.sessionId)}` : '';
    pushUnique(`${base}/api/attachments/${rid}`);
    pushUnique(`${base}/api/attachment/${rid}`);
    pushUnique(`${base}/api/session/attachment?attachmentId=${rid}${sid}`);
    pushUnique(`${base}/api/session/downloadFileBinary?receiptId=${rid}${sid}`);
    pushUnique(`${base}/api/session/downloadFile?receiptId=${rid}${sid}`);
    pushUnique(`${base}/api/remote/session/downloadFileBinary?receiptId=${rid}${sid}`);
    pushUnique(`${base}/api/remote/session/downloadFile?receiptId=${rid}${sid}`);
    pushUnique(`${base}/api/files/${rid}`);
  }

  if (opts.filePath) {
    const fp = encodeURIComponent(opts.filePath);
    const sid = opts.sessionId ? `&sessionId=${encodeURIComponent(opts.sessionId)}` : '';
    pushUnique(`${base}/api/session/downloadFileBinary?path=${fp}${sid}`);
    pushUnique(`${base}/api/files/download?path=${fp}`);
  }

  return out;
}

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function extractRawBase64(dataUrlOrB64?: string): string {
  if (!dataUrlOrB64) return '';
  const idx = dataUrlOrB64.indexOf(',');
  return idx >= 0 ? dataUrlOrB64.slice(idx + 1) : dataUrlOrB64;
}

export interface FetchedCloudBinary {
  dataUrl: string;
  base64Data: string;
  mimeType: string;
  filename: string;
  size: number;
}

function extractBinaryFromRpcJson(
  parsed: unknown,
  fallbackName: string,
  fallbackMime: string
): FetchedCloudBinary | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const unwrap = (node: unknown, depth = 0): Record<string, unknown> | null => {
    if (!node || typeof node !== 'object' || depth > 4) return null;
    const obj = node as Record<string, unknown>;
    if (obj.ok === false || obj.error) return null;
    if (obj.payload && typeof obj.payload === 'object') return unwrap(obj.payload, depth + 1);
    if (obj.value && typeof obj.value === 'object') return unwrap(obj.value, depth + 1);
    if (obj.result && typeof obj.result === 'object') return unwrap(obj.result, depth + 1);
    if (obj.data && typeof obj.data === 'object' && !Array.isArray(obj.data)) {
      return unwrap(obj.data, depth + 1);
    }
    return obj;
  };
  const inner = unwrap(parsed);
  if (!inner) return null;

  const b64 =
    (typeof inner.base64 === 'string' && inner.base64) ||
    (typeof inner.base64Data === 'string' && inner.base64Data) ||
    (typeof inner.data === 'string' && inner.data) ||
    (typeof inner.bytesBase64 === 'string' && inner.bytesBase64) ||
    '';

  if (b64 && b64.length > 8) {
    const cleanB64 = extractRawBase64(b64).replace(/\s+/g, '');
    const mimeType =
      (typeof inner.mimeType === 'string' && inner.mimeType) ||
      (typeof inner.mediaType === 'string' && inner.mediaType) ||
      fallbackMime;
    return {
      base64Data: cleanB64,
      dataUrl: `data:${mimeType};base64,${cleanB64}`,
      mimeType,
      filename: fallbackName,
      size: Math.round((cleanB64.length * 3) / 4),
    };
  }

  if (typeof inner.content === 'string' && inner.content.length > 0) {
    const bytes = new TextEncoder().encode(inner.content);
    const cleanB64 = uint8ArrayToBase64(bytes);
    const mimeType = inferMimeTypeFromName(fallbackName, 'text/plain');
    return {
      base64Data: cleanB64,
      dataUrl: `data:${mimeType};base64,${cleanB64}`,
      mimeType,
      filename: fallbackName,
      size: bytes.length,
    };
  }

  return null;
}

/**
 * Downloads an image or binary file from the cloud server using Android native OkHttp first
 * (to bypass WebView Sec-Fetch-Site / CORS 403), then standard fetch(), then DSH workspaceFiles RPC.
 */
export async function fetchCloudBinary(
  serverUrl: string | undefined,
  opts: {
    url?: string;
    receiptId?: string;
    sessionId?: string;
    filePath?: string;
    filename?: string;
    mimeType?: string;
  }
): Promise<FetchedCloudBinary> {
  const candidates = buildCloudDownloadCandidates(serverUrl, opts);
  const base = (serverUrl || '').trim().replace(/\/+$/, '');
  if (candidates.length === 0 && !(base && opts.filePath)) {
    throw new Error('该文件缺少可下载的云端链接、路径或凭证 ID');
  }

  let lastErr = '下载失败';

  for (const url of candidates) {
    try {
      const nativeRes = await downloadBinaryNativeIfAvailable({ url, timeoutMs: 45000 });
      if (nativeRes) {
        if (nativeRes.ok && nativeRes.base64Data) {
          const filename = nativeRes.filename || opts.filename || guessNameFromUrl(url);
          const mimeType =
            nativeRes.mimeType && nativeRes.mimeType !== 'application/octet-stream'
              ? nativeRes.mimeType
              : opts.mimeType || inferMimeTypeFromName(filename);
          return {
            base64Data: nativeRes.base64Data,
            dataUrl: `data:${mimeType};base64,${nativeRes.base64Data}`,
            mimeType,
            filename,
            size: nativeRes.size,
          };
        }
        lastErr = `HTTP ${nativeRes.status}`;
        continue;
      }

      const res = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(35000),
      });
      if (!res.ok) {
        lastErr = `HTTP ${res.status}`;
        continue;
      }

      const headerMime = (res.headers.get('content-type') || '').split(';')[0].trim();
      const buf = await res.arrayBuffer();
      const bytes = new Uint8Array(buf);
      // Guard against SPA HTML error pages returned with 200 OK
      if (headerMime === 'text/html' && !/\.html?$/i.test(opts.filename || url)) {
        lastErr = '目标链接返回网页而非文件';
        continue;
      }
      const base64Data = uint8ArrayToBase64(bytes);
      const filename = parseFilenameFromDisposition(res.headers.get('content-disposition')) || opts.filename || guessNameFromUrl(url);
      const mimeType =
        headerMime && headerMime !== 'application/octet-stream'
          ? headerMime
          : opts.mimeType || inferMimeTypeFromName(filename);

      return {
        base64Data,
        dataUrl: `data:${mimeType};base64,${base64Data}`,
        mimeType,
        filename,
        size: bytes.length,
      };
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
  }

  // Fallback for DeepSeek Harness workspaceFiles RPC (`workspaceFiles/readBytes` / `workspaceFiles/read`)
  if (base && opts.filePath) {
    const filename = opts.filename || opts.filePath.split('/').pop() || `relay-file-${Date.now()}`;
    const mimeType = opts.mimeType || inferMimeTypeFromName(filename);
    const rpcEndpoints = ['workspaceFiles/readBytes', 'workspaceFiles/read'];
    for (const ep of rpcEndpoints) {
      for (const prefix of ['/api', '/api/remote']) {
        try {
          const res = await fetch(`${base}${prefix}/${ep}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'client-request',
              rpcId: `dl-${Date.now()}`,
              method: ep,
              payload: {
                args: {
                  request: {
                    sessionId: opts.sessionId || undefined,
                    path: opts.filePath,
                  },
                },
              },
            }),
            signal: AbortSignal.timeout(25000),
          });
          if (!res.ok) continue;
          const ct = (res.headers.get('content-type') || '').toLowerCase();
          if (ct.includes('application/json')) {
            const parsed = await res.json();
            const extracted = extractBinaryFromRpcJson(parsed, filename, mimeType);
            if (extracted) return extracted;
          } else if (ct.includes('application/octet-stream') || ct.startsWith('image/') || ct.startsWith('audio/') || ct.startsWith('video/') || ct.includes('pdf')) {
            const bytes = new Uint8Array(await res.arrayBuffer());
            if (bytes.length > 0) {
              const b64 = uint8ArrayToBase64(bytes);
              const outMime = ct.split(';')[0].trim() === 'application/octet-stream' ? mimeType : ct.split(';')[0].trim();
              return {
                base64Data: b64,
                dataUrl: `data:${outMime};base64,${b64}`,
                mimeType: outMime,
                filename,
                size: bytes.length,
              };
            }
          }
        } catch (err) {
          lastErr = err instanceof Error ? err.message : String(err);
        }
      }
    }
  }

  throw new Error(`无法从云端拉取文件（${lastErr}）`);
}

function guessNameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const seg = parsed.pathname.split('/').filter(Boolean).pop();
    if (seg && seg.includes('.')) return decodeURIComponent(seg);
  } catch {
    // ignore
  }
  return `relay-file-${Date.now()}`;
}

function parseFilenameFromDisposition(header: string | null): string {
  if (!header) return '';
  const utf8Match = /filename\*=UTF-8''([^;\n]+)/i.exec(header);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1].trim());
    } catch {
      return utf8Match[1].trim();
    }
  }
  const plainMatch = /filename="?([^";\n]+)"?/i.exec(header);
  return plainMatch?.[1]?.trim() || '';
}

/**
 * Saves any attachment (local base64/dataUrl/textContent OR remote cloud url/receiptId)
 * directly to Android Gallery/Downloads via native MediaStore, or browser download on Web.
 */
export async function saveAttachmentToLocalDevice(
  att: {
    name: string;
    mimeType?: string;
    dataUrl?: string;
    base64Data?: string;
    rawFile?: File;
    textContent?: string;
    url?: string;
    receiptId?: string;
    sessionId?: string;
    filePath?: string;
  },
  serverUrl?: string
): Promise<{ filename: string; location: string }> {
  const isBlobDataUrl = Boolean(att.dataUrl && att.dataUrl.startsWith('blob:'));
  let base64Data = att.base64Data || (isBlobDataUrl ? '' : extractRawBase64(att.dataUrl));
  let mimeType = att.mimeType || inferMimeTypeFromName(att.name);
  let filename = att.name || 'relay-file';

  if (!base64Data && att.rawFile) {
    const bytes = new Uint8Array(await att.rawFile.arrayBuffer());
    const nativeSaved = await saveBinaryFileToDevice({
      filename,
      base64Data: uint8ArrayToBase64(bytes),
      mimeType,
    });
    if (nativeSaved?.ok) {
      return {
        filename: nativeSaved.filename || filename,
        location: nativeSaved.location || '手机本地存储',
      };
    }
    const blobUrl = URL.createObjectURL(att.rawFile);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 2500);
    return { filename, location: '浏览器下载目录' };
  }

  if (!base64Data && (isBlobDataUrl || (att.url && att.url.startsWith('blob:')))) {
    const blobHref = isBlobDataUrl ? att.dataUrl! : att.url!;
    const res = await fetch(blobHref);
    const bytes = new Uint8Array(await res.arrayBuffer());
    base64Data = uint8ArrayToBase64(bytes);
  }

  if (!base64Data && att.textContent !== undefined) {
    const encoded = new TextEncoder().encode(att.textContent);
    base64Data = uint8ArrayToBase64(encoded);
    if (!mimeType || mimeType === 'application/octet-stream') {
      mimeType = inferMimeTypeFromName(filename, 'text/plain');
    }
  }

  if (!base64Data && (att.url || att.receiptId || att.filePath)) {
    const fetched = await fetchCloudBinary(serverUrl, {
      url: att.url,
      receiptId: att.receiptId,
      sessionId: att.sessionId,
      filePath: att.filePath,
      filename,
      mimeType,
    });
    base64Data = fetched.base64Data;
    mimeType = fetched.mimeType || mimeType;
    filename = fetched.filename || filename;
  }

  if (!base64Data) {
    throw new Error('该文件暂无可下载的二进制或文本内容');
  }

  // 1. Native Android APK: save directly to Pictures/Relay or Downloads/Relay
  const nativeSaved = await saveBinaryFileToDevice({
    filename,
    base64Data,
    mimeType,
  });
  if (nativeSaved?.ok) {
    return {
      filename: nativeSaved.filename || filename,
      location: nativeSaved.location || '手机本地存储',
    };
  }

  // 2. Web / PWA fallback: Blob download
  const bytes = base64ToUint8Array(base64Data);
  const blob = new Blob([bytes as unknown as BlobPart], { type: mimeType });
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 2500);

  return { filename, location: '浏览器下载目录' };
}
