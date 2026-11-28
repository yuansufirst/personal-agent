import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { setNativeWindowBackground } from './nativeSocket';

export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}

export async function syncNativeStatusBar(darkMode: boolean): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  const color = darkMode ? '#0E1014' : '#F6F7F9';
  try {
    await setNativeWindowBackground(color, darkMode);
  } catch {
    // Ignore if native window bridge is unavailable
  }
}

export function registerAndroidBackHandler(onBack: () => boolean): () => void {
  if (!Capacitor.isNativePlatform()) {
    return () => undefined;
  }

  let removed = false;
  let removeHandle: (() => Promise<void>) | null = null;

  void CapacitorApp.addListener('backButton', () => {
    const handled = onBack();
    if (!handled) {
      void CapacitorApp.minimizeApp();
    }
  }).then((handle) => {
    if (removed) {
      void handle.remove();
    } else {
      removeHandle = () => handle.remove();
    }
  }).catch(() => undefined);

  return () => {
    removed = true;
    if (removeHandle) {
      void removeHandle();
    }
  };
}
