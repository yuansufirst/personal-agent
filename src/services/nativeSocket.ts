import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

interface DshSocketPlugin {
  connect(options: { id: string; url: string; origin?: string }): Promise<void>;
  send(options: { id: string; data: string }): Promise<void>;
  close(options: { id: string; code?: number; reason?: string }): Promise<void>;
  addListener(
    eventName: 'wsOpen',
    listenerFunc: (event: { id: string }) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'wsMessage',
    listenerFunc: (event: { id: string; data: string }) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'wsError',
    listenerFunc: (event: { id: string; message: string }) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'wsClose',
    listenerFunc: (event: { id: string; code: number; reason: string }) => void
  ): Promise<PluginListenerHandle>;
}

const DshSocket = registerPlugin<DshSocketPlugin>('DshSocket');

export interface DshWebSocketLike {
  readonly readyState: number;
  onopen: ((ev: Event) => unknown) | null;
  onmessage: ((ev: MessageEvent) => unknown) | null;
  onerror: ((ev: Event) => unknown) | null;
  onclose: ((ev: CloseEvent) => unknown) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

const WS_CONNECTING = 0;
const WS_OPEN = 1;
const WS_CLOSING = 2;
const WS_CLOSED = 3;

let socketSeq = 0;

function deriveSameOrigin(wsUrl: string): string | undefined {
  try {
    const parsed = new URL(wsUrl);
    const proto = parsed.protocol === 'wss:' ? 'https:' : 'http:';
    return `${proto}//${parsed.host}`;
  } catch {
    return undefined;
  }
}

class NativeCapacitorWebSocket implements DshWebSocketLike {
  private readonly id: string;
  private state: number = WS_CONNECTING;
  private listeners: PluginListenerHandle[] = [];
  private disposed = false;

  onopen: ((ev: Event) => unknown) | null = null;
  onmessage: ((ev: MessageEvent) => unknown) | null = null;
  onerror: ((ev: Event) => unknown) | null = null;
  onclose: ((ev: CloseEvent) => unknown) | null = null;

  constructor(url: string) {
    this.id = `dsh-ws-${Date.now()}-${++socketSeq}`;
    void this.init(url);
  }

  get readyState(): number {
    return this.state;
  }

  private async init(url: string): Promise<void> {
    try {
      const hOpen = await DshSocket.addListener('wsOpen', (ev) => {
        if (ev.id !== this.id || this.disposed) return;
        this.state = WS_OPEN;
        this.onopen?.(new Event('open'));
      });
      const hMsg = await DshSocket.addListener('wsMessage', (ev) => {
        if (ev.id !== this.id || this.disposed) return;
        this.onmessage?.(new MessageEvent('message', { data: ev.data }));
      });
      const hErr = await DshSocket.addListener('wsError', (ev) => {
        if (ev.id !== this.id || this.disposed) return;
        this.onerror?.(new Event('error'));
        if (this.state !== WS_CLOSED) {
          this.state = WS_CLOSED;
          this.cleanup();
          this.onclose?.(
            new CloseEvent('close', { code: 1006, reason: ev.message || 'native websocket error' })
          );
        }
      });
      const hClose = await DshSocket.addListener('wsClose', (ev) => {
        if (ev.id !== this.id || this.disposed) return;
        this.state = WS_CLOSED;
        this.cleanup();
        this.onclose?.(
          new CloseEvent('close', { code: ev.code ?? 1000, reason: ev.reason || '' })
        );
      });

      this.listeners = [hOpen, hMsg, hErr, hClose];

      if (this.disposed) {
        this.cleanup();
        return;
      }

      await DshSocket.connect({
        id: this.id,
        url,
        origin: deriveSameOrigin(url),
      });
    } catch (err) {
      this.state = WS_CLOSED;
      this.cleanup();
      this.onerror?.(new Event('error'));
      this.onclose?.(
        new CloseEvent('close', {
          code: 1006,
          reason: err instanceof Error ? err.message : 'failed to open native websocket',
        })
      );
    }
  }

  send(data: string): void {
    if (this.state !== WS_OPEN) return;
    void DshSocket.send({ id: this.id, data }).catch(() => {
      // Errors arrive through wsError/wsClose
    });
  }

  close(code = 1000, reason = ''): void {
    if (this.state === WS_CLOSED || this.state === WS_CLOSING) return;
    this.state = WS_CLOSING;
    this.disposed = true;
    this.cleanup();
    void DshSocket.close({ id: this.id, code, reason }).catch(() => {
      // Ignore close errors
    });
    this.state = WS_CLOSED;
  }

  private cleanup(): void {
    const handles = this.listeners;
    this.listeners = [];
    for (const h of handles) {
      void h.remove();
    }
  }
}

/**
 * Creates a WebSocket for DeepSeek Harness `/api/remote.mux`.
 * - In the Android APK, uses the native OkHttp `DshSocket` plugin so Tailscale
 *   WebSocket upgrades carry a matching same-origin header and zero `Sec-Fetch-Site: cross-site` 403s.
 * - In Web/PWA environments, uses the standard browser `WebSocket`.
 */
export function createDshWebSocket(wsUrl: string): DshWebSocketLike {
  if (Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('DshSocket')) {
    return new NativeCapacitorWebSocket(wsUrl);
  }
  return new WebSocket(wsUrl);
}
