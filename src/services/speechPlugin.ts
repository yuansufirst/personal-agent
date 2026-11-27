import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export interface SpeechResultEvent {
  transcript: string;
  isFinal: boolean;
}

export interface SpeechStateEvent {
  listening: boolean;
}

export interface SpeechErrorEvent {
  message: string;
  code?: number;
  fallbackAvailable?: boolean;
}

export interface RecordLevelEvent {
  level: number;
}

export interface RecordAutoStopEvent {
  durationMs?: number;
}

export interface RecordedAudioEvent {
  audio: string;
  format?: string;
  sampleRate?: number;
  durationMs: number;
}

export interface NativeSpeechPlugin {
  start(options?: { language?: string }): Promise<{ mode?: string; transcript?: string }>;
  startDialog(options?: { language?: string }): Promise<{ mode?: string; transcript?: string }>;
  stop(): Promise<void>;
  startRecording(): Promise<{ started?: boolean; sampleRate?: number }>;
  stopRecording(): Promise<RecordedAudioEvent>;
  addListener(
    eventName: 'speechResult',
    listenerFunc: (event: SpeechResultEvent) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'speechState',
    listenerFunc: (event: SpeechStateEvent) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'speechError',
    listenerFunc: (event: SpeechErrorEvent) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'recordLevel',
    listenerFunc: (event: RecordLevelEvent) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'recordAutoStop',
    listenerFunc: (event: RecordAutoStopEvent) => void
  ): Promise<PluginListenerHandle>;
}

/** 原生语音插件（录音 + 系统识别），只在 APK 里可用。 */
export const NativeSpeech = registerPlugin<NativeSpeechPlugin>('NativeSpeech');
