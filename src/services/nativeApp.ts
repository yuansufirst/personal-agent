import { Capacitor, registerPlugin } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';

interface DshWindowBridge {
  setWindowBackground(options: { color: string; dark: boolean }): Promise<void>;
}

const DshWindow = registerPlugin<DshWindowBridge>('DshSocket');

export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}

export async function syncNativeStatusBar(darkMode: boolean): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  const color = darkMode ? '#14171D' : '#F2F0EB';
  try {
    await StatusBar.setOverlaysWebView({ overlay: false });
    await StatusBar.setBackgroundColor({ color });
    await StatusBar.setStyle({
      style: darkMode ? Style.Dark : Style.Light,
    });
  } catch {
    // Ignore on platforms where StatusBar plugin is unavailable
  }
  try {
    if (Capacitor.isPluginAvailable('DshSocket')) {
      await DshWindow.setWindowBackground({ color, dark: darkMode });
    }
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
  });

  return () => {
    removed = true;
    if (removeHandle) {
      void removeHandle();
    }
  };
}
