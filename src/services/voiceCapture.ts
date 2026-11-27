/**
 * 语音输入：自己录音（原生 AudioRecord 优先，网页 getUserMedia 兜底），
 * 把 16kHz 单声道 PCM 发给服务器的 /api/transcribe（SenseVoice）转文字。
 *
 * 为什么不走系统 SpeechRecognizer：部分国产 ROM（小米 HyperOS 等）即使已授予
 * RECORD_AUDIO，语音识别服务仍会回 ERROR_INSUFFICIENT_PERMISSIONS(9)，
 * 表现为「点麦克风没反应/提示缺少麦克风权限」。
 */
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { NativeSpeech } from './speechPlugin';

const TARGET_SAMPLE_RATE = 16000;
const MAX_RECORD_MS = 60_000;
const MIN_SPEECH_MS = 300;

export interface CapturedAudio {
  base64: string;
  format: 'pcm16' | 'aac';
  sampleRate: number;
  durationMs: number;
  bytes: number;
}

export interface VoiceSessionHandle {
  stop: () => void;
}

export interface VoiceInputCallbacks {
  onTranscript: (transcript: string) => void;
  onStateChange: (listening: boolean) => void;
  onError: (message: string) => void;
  onBusyChange?: (busy: boolean) => void;
}

interface CaptureSource {
  stop: () => Promise<CapturedAudio>;
}

type AudioContextCtor = new (options?: AudioContextOptions) => AudioContext;

function getAudioContextCtor(): AudioContextCtor | null {
  const win = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return win.AudioContext || win.webkitAudioContext || null;
}


/** 线性插值重采样到 16k，够语音识别用了。 */
function resampleTo16k(input: Float32Array, inputRate: number): Float32Array {
  if (inputRate === TARGET_SAMPLE_RATE) return input;
  const ratio = inputRate / TARGET_SAMPLE_RATE;
  const outLength = Math.max(1, Math.floor(input.length / ratio));
  const output = new Float32Array(outLength);
  for (let i = 0; i < outLength; i += 1) {
    const pos = i * ratio;
    const base = Math.floor(pos);
    const frac = pos - base;
    const a = input[base] ?? 0;
    const b = input[base + 1] ?? a;
    output[i] = a + (b - a) * frac;
  }
  return output;
}

function floatToPcm16(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, input[i]));
    output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output;
}

function concatFloat32(chunks: Float32Array[], total: number): Float32Array {
  const merged = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

/** Int16 PCM → base64（分块，避免大数组爆栈）。 */
export function pcmToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(slice));
  }
  return btoa(binary);
}

/** 原生录音（APK 内 AudioRecord，权限拿到了就一定能录）。 */
async function startNativeCapture(onAutoStop: () => void): Promise<CaptureSource | null> {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('NativeSpeech')) return null;
  const handles: PluginListenerHandle[] = [];
  try {
    handles.push(
      await NativeSpeech.addListener('recordAutoStop', () => {
        onAutoStop();
      })
    );
    await NativeSpeech.startRecording();
  } catch {
    for (const handle of handles) void handle.remove();
    return null;
  }
  return {
    stop: async () => {
      for (const handle of handles) void handle.remove();
      const res = await NativeSpeech.stopRecording();
      const base64 = res.audio || '';
      return {
        base64,
        format: (res.format === 'pcm16' ? 'pcm16' : 'aac'),
        sampleRate: res.sampleRate || TARGET_SAMPLE_RATE,
        durationMs: res.durationMs || 0,
        bytes: Math.floor((base64.length * 3) / 4),
      };
    },
  };
}

/** 网页录音（PWA / 浏览器 / 原生不可用时的兜底）。 */
async function startWebCapture(onAutoStop: () => void): Promise<CaptureSource | null> {
  const AudioCtor = getAudioContextCtor();
  if (!AudioCtor) return null;
  if (!navigator.mediaDevices?.getUserMedia) return null;

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: false,
  });

  const context = new AudioCtor();
  void context.resume().catch(() => undefined);
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  let total = 0;
  let closed = false;

  processor.onaudioprocess = (event) => {
    if (closed) return;
    const channel = event.inputBuffer.getChannelData(0);
    const copy = new Float32Array(channel.length);
    copy.set(channel);
    chunks.push(copy);
    total += copy.length;
  };

  source.connect(processor);
  processor.connect(context.destination);

  const teardown = () => {
    if (closed) return;
    closed = true;
    processor.onaudioprocess = null;
    try {
      processor.disconnect();
    } catch {
      // ignore
    }
    try {
      source.disconnect();
    } catch {
      // ignore
    }
    for (const track of stream.getTracks()) track.stop();
    void context.close().catch(() => undefined);
  };

  const hardStop = window.setTimeout(() => {
    teardown();
    onAutoStop();
  }, MAX_RECORD_MS);

  return {
    stop: async () => {
      window.clearTimeout(hardStop);
      const inputRate = context.sampleRate || 48000;
      teardown();
      const raw = total > 0 ? concatFloat32(chunks, total) : new Float32Array(0);
      const resampled = resampleTo16k(raw, inputRate);
      const pcm = floatToPcm16(resampled);
      const base64 = pcmToBase64(pcm);
      return {
        base64,
        format: 'pcm16',
        sampleRate: TARGET_SAMPLE_RATE,
        durationMs: Math.round((raw.length / inputRate) * 1000),
        bytes: pcm.byteLength,
      };
    },
  };
}

/** 把录音发给服务器转写，返回识别文本。 */
export async function transcribePcm(
  serverUrl: string,
  captured: CapturedAudio,
  signal?: AbortSignal
): Promise<string> {
  const base = (serverUrl || '').trim().replace(/\/+$/, '');
  if (!base) throw new Error('未配置服务器地址，无法上传语音');
  if (!captured.base64) throw new Error('没有录到声音，请重试');

  const res = await fetch(`${base}/api/transcribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      audio: captured.base64,
      format: captured.format,
      sampleRate: captured.sampleRate,
      language: 'zh',
      clientTs: Date.now(),
    }),
  });

  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    // keep null
  }
  const data = (payload ?? {}) as { ok?: boolean; text?: string; error?: string };
  if (!res.ok || data.ok !== true) {
    throw new Error(data.error || `语音转写失败（HTTP ${res.status}）`);
  }
  const text = (data.text || '').trim();
  if (!text) throw new Error('没听清，再说一次试试');
  return text;
}

/** 录音开始前先把 TCP/TLS 通道焐热，省得开口后才建连（中继链路建连很慢）。 */
function warmUpTranscribe(serverUrl: string): void {
  const base = (serverUrl || '').trim().replace(/\/+$/, '');
  if (!base) return;
  try {
    void fetch(`${base}/api/transcribe`, { method: 'GET', cache: 'no-store' }).catch(() => undefined);
  } catch {
    // ignore
  }
}

/**
 * 启动「本地录音 + 服务器转写」的语音输入。
 * 返回 null 表示这台设备录不了音（没权限 / 不支持），调用方可以退回系统识别。
 */
export async function startServerVoiceInput(
  serverUrl: string,
  callbacks: VoiceInputCallbacks
): Promise<VoiceSessionHandle | null> {
  let autoStopRef: (() => void) | null = null;
  const triggerAutoStop = () => autoStopRef?.();

  warmUpTranscribe(serverUrl);

  let source: CaptureSource | null = null;
  try {
    source = await startNativeCapture(triggerAutoStop);
  } catch {
    source = null;
  }
  if (!source) {
    try {
      source = await startWebCapture(triggerAutoStop);
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : '麦克风启动失败');
    }
  }
  if (!source) return null;

  const capture = source;
  let finishing = false;

  const finish = async () => {
    if (finishing) return;
    finishing = true;
    callbacks.onStateChange(false);
    callbacks.onBusyChange?.(true);
    let recorded: CapturedAudio | null = null;
    try {
      recorded = await capture.stop();
      if (recorded.durationMs < MIN_SPEECH_MS || recorded.bytes === 0) {
        callbacks.onError('说话时间太短，再按一次试试');
        return;
      }
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 60_000);
      try {
        const text = await transcribePcm(serverUrl, recorded, controller.signal);
        callbacks.onTranscript(text);
      } finally {
        window.clearTimeout(timer);
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : '语音转写失败，请重试';
      const detail = recorded
        ? `（${(recorded.durationMs / 1000).toFixed(1)}s / ${Math.round(recorded.bytes / 1024)}KB）`
        : '';
      callbacks.onError(`语音失败：${reason}${detail}`);
    } finally {
      callbacks.onBusyChange?.(false);
    }
  };

  autoStopRef = () => {
    void finish();
  };
  callbacks.onStateChange(true);

  return {
    stop: () => {
      void finish();
    },
  };
}
