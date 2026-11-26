import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { startPcmCapture, transcribePcm } from './voiceCapture';

interface NativeSpeechPlugin {
  start(options?: { language?: string }): Promise<{ mode?: string; transcript?: string }>;
  startDialog(options?: { language?: string }): Promise<{ mode?: string; transcript?: string }>;
  stop(): Promise<void>;
  addListener(
    eventName: 'speechResult',
    listenerFunc: (event: { transcript: string; isFinal: boolean }) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'speechState',
    listenerFunc: (event: { listening: boolean }) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'speechError',
    listenerFunc: (event: { message: string; code?: number; fallbackAvailable?: boolean }) => void
  ): Promise<PluginListenerHandle>;
}

const NativeSpeech = registerPlugin<NativeSpeechPlugin>('NativeSpeech');

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  0: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike {
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
}

export interface SpeechSessionHandle {
  stop: () => void;
}

export interface StartVoiceOptions {
  /** 服务器地址，配了就走「自己录音 + 服务器 SenseVoice 转写」这条路 */
  serverUrl?: string;
}

export async function startVoiceRecognition(
  callbacks: {
    onTranscript: (transcript: string, isFinal: boolean) => void;
    onStateChange: (listening: boolean) => void;
    onError: (message: string) => void;
  },
  options?: StartVoiceOptions
): Promise<SpeechSessionHandle | null> {
  // 0) 首选：自己录音 + 上传服务器转写。
  // 部分国产 ROM 的系统语音服务即使授权了也会回「缺少麦克风权限」，
  // 自己录音不依赖它，权限拿得到就能用。
  if (options?.serverUrl) {
    const serverUrl = options.serverUrl;
    let captureHandle: Awaited<ReturnType<typeof startPcmCapture>> | null = null;
    try {
      captureHandle = await startPcmCapture(() => callbacks.onStateChange(false));
    } catch {
      captureHandle = null;
    }
    if (captureHandle) {
      const capture = captureHandle;
      callbacks.onStateChange(true);
      return {
        stop: () => {
          callbacks.onStateChange(false);
          void (async () => {
            try {
              const recorded = await capture.stop();
              if (recorded.durationMs < 300 || recorded.pcm.length === 0) {
                callbacks.onError('说话时间太短，再按一次试试');
                return;
              }
              const controller = new AbortController();
              const timer = window.setTimeout(() => controller.abort(), 60_000);
              try {
                const text = await transcribePcm(serverUrl, recorded, controller.signal);
                callbacks.onTranscript(text, true);
              } finally {
                window.clearTimeout(timer);
              }
            } catch (err) {
              callbacks.onError(err instanceof Error ? err.message : '语音转写失败，请重试');
            }
          })();
        },
      };
    }
  }

  // Prefer native Android SpeechRecognizer / RecognizerIntent inside the APK
  if (Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('NativeSpeech')) {
    const handles: PluginListenerHandle[] = [];
    let fallbackTriggered = false;
    const cleanup = () => {
      for (const h of handles) {
        void h.remove();
      }
      handles.length = 0;
    };

    try {
      const hRes = await NativeSpeech.addListener('speechResult', (ev) => {
        if (ev.transcript) {
          callbacks.onTranscript(ev.transcript, Boolean(ev.isFinal));
        }
        if (ev.isFinal) {
          callbacks.onStateChange(false);
          cleanup();
        }
      });
      const hState = await NativeSpeech.addListener('speechState', (ev) => {
        callbacks.onStateChange(Boolean(ev.listening));
      });
      const hErr = await NativeSpeech.addListener('speechError', (ev) => {
        if (ev.fallbackAvailable && !fallbackTriggered) {
          fallbackTriggered = true;
          void NativeSpeech.startDialog({ language: 'zh-CN' })
            .then(() => {
              callbacks.onStateChange(false);
              cleanup();
            })
            .catch((dialogErr) => {
              callbacks.onStateChange(false);
              cleanup();
              callbacks.onError(
                dialogErr instanceof Error ? dialogErr.message : ev.message || '语音识别失败，请重试'
              );
            });
          return;
        }
        callbacks.onStateChange(false);
        callbacks.onError(ev.message || '语音识别失败，请重试');
        cleanup();
      });
      handles.push(hRes, hState, hErr);

      callbacks.onStateChange(true);
      const startRes = await NativeSpeech.start({ language: 'zh-CN' });
      if (startRes?.mode === 'activity') {
        callbacks.onStateChange(false);
        cleanup();
      }

      return {
        stop: () => {
          void NativeSpeech.stop().catch(() => undefined);
          callbacks.onStateChange(false);
          cleanup();
        },
      };
    } catch (err) {
      callbacks.onStateChange(false);
      cleanup();
      callbacks.onError(
        err instanceof Error
          ? err.message
          : '系统语音识别暂不可用，可直接使用手机输入法自带语音输入'
      );
      return null;
    }
  }

  // Fallback to browser Web Speech API on desktop/mobile web
  const win = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  const SpeechRec = win.SpeechRecognition || win.webkitSpeechRecognition;

  if (!SpeechRec) {
    callbacks.onError('当前环境暂不支持语音转文字，可直接使用系统键盘语音输入');
    return null;
  }

  try {
    const rec = new SpeechRec();
    rec.lang = 'zh-CN';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript;
      if (transcript) {
        callbacks.onTranscript(transcript, true);
      }
    };
    rec.onerror = (ev) => {
      callbacks.onStateChange(false);
      const code = ev?.error || '';
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        callbacks.onError('未获取麦克风权限或系统语音服务被拦截');
      } else {
        callbacks.onError('未检测到语音输入，请靠近麦克风重试');
      }
    };
    rec.onend = () => {
      callbacks.onStateChange(false);
    };
    callbacks.onStateChange(true);
    rec.start();
    return {
      stop: () => {
        try {
          rec.stop();
        } catch {
          // ignore
        }
        callbacks.onStateChange(false);
      },
    };
  } catch {
    callbacks.onStateChange(false);
    callbacks.onError('启动语音输入失败，请检查麦克风权限');
    return null;
  }
}
