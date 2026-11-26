import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';

export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}

export async function syncNativeStatusBar(darkMode: boolean): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await StatusBar.setOverlaysWebView({ overlay: false });
    await StatusBar.setBackgroundColor({
      color: darkMode ? '#0E0F12' : '#F8F7F4',
    });
    await StatusBar.setStyle({
      style: darkMode ? Style.Dark : Style.Light,
    });
  } catch {
    // Ignore on platforms where StatusBar plugin is unavailable
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
  });

  return () => {
    removed = true;
    if (removeHandle) {
      void removeHandle();
    }
  };
}
