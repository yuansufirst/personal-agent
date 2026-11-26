/**
 * 手机端录音 + 服务器转写。
 *
 * 为什么不走系统 SpeechRecognizer：部分国产 ROM（小米 HyperOS 等）即使已授予
 * RECORD_AUDIO，语音识别服务仍会回 ERROR_INSUFFICIENT_PERMISSIONS(9)，
 * 表现为「点麦克风没反应/提示缺少麦克风权限」。
 * 这里改成自己用 getUserMedia 录音，前端降到 16kHz PCM，POST 给服务器的
 * /api/transcribe（SenseVoice），绕开系统语音服务。
 */

const TARGET_SAMPLE_RATE = 16000;
const MAX_RECORD_MS = 60_000;

export interface CapturedPcm {
  pcm: Int16Array;
  sampleRate: number;
  durationMs: number;
}

export interface VoiceCaptureHandle {
  stop: () => Promise<CapturedPcm>;
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

/**
 * 开始录音。返回的 stop() 会停下麦克风并给出 16k 单声道 PCM。
 */
export async function startPcmCapture(onAutoStop?: () => void): Promise<VoiceCaptureHandle> {
  const AudioCtor = getAudioContextCtor();
  if (!AudioCtor) throw new Error('当前环境不支持录音（缺少 AudioContext）');
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('当前环境不支持麦克风录音');
  }

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
    try {
      teardown();
      onAutoStop?.();
    } catch {
      // ignore
    }
  }, MAX_RECORD_MS);

  return {
    stop: async () => {
      window.clearTimeout(hardStop);
      const inputRate = context.sampleRate || 48000;
      teardown();
      const raw = total > 0 ? concatFloat32(chunks, total) : new Float32Array(0);
      const resampled = resampleTo16k(raw, inputRate);
      return {
        pcm: floatToPcm16(resampled),
        sampleRate: TARGET_SAMPLE_RATE,
        durationMs: Math.round((raw.length / inputRate) * 1000),
      };
    },
  };
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

/** 把录音发给服务器转写，返回识别文本。 */
export async function transcribePcm(
  serverUrl: string,
  captured: CapturedPcm,
  signal?: AbortSignal
): Promise<string> {
  const base = (serverUrl || '').trim().replace(/\/+$/, '');
  if (!base) throw new Error('未配置服务器地址，无法上传语音');
  if (captured.pcm.length === 0) throw new Error('没有录到声音，请重试');

  const res = await fetch(`${base}/api/transcribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      audio: pcmToBase64(captured.pcm),
      sampleRate: captured.sampleRate,
      language: 'zh',
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
