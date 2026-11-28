package com.relay.agent;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(DshSocketPlugin.class);
        registerPlugin(NativeSpeechPlugin.class);
        registerPlugin(DeviceBridgePlugin.class);
        super.onCreate(savedInstanceState);

        applySafeEdgeToEdgeInsets();
    }

    @SuppressWarnings("deprecation")
    private void applySafeEdgeToEdgeInsets() {
        try {
            Window window = getWindow();
            if (window == null) return;

            WindowCompat.setDecorFitsSystemWindows(window, false);

            int initialBg = Color.parseColor("#F6F7F9");
            if (Build.VERSION.SDK_INT < 35) {
                window.setStatusBarColor(initialBg);
                window.setNavigationBarColor(initialBg);
            }

            View decorView = window.getDecorView();
            if (decorView != null) {
                WindowInsetsControllerCompat controller =
                    WindowCompat.getInsetsController(window, decorView);
                if (controller != null) {
                    controller.setAppearanceLightStatusBars(true);
                    controller.setAppearanceLightNavigationBars(true);
                }
            }

            View contentView = findViewById(android.R.id.content);
            if (contentView != null) {
                contentView.setBackgroundColor(initialBg);
                ViewCompat.setOnApplyWindowInsetsListener(contentView, (view, windowInsets) -> {
                    try {
                        Insets bars = windowInsets.getInsets(
                            WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
                        );
                        Insets ime = windowInsets.getInsets(WindowInsetsCompat.Type.ime());
                        int bottomPadding = Math.max(bars.bottom, ime.bottom);
                        view.setPadding(bars.left, bars.top, bars.right, bottomPadding);
                    } catch (Throwable ignored) {
                        // Never crash on OEM-specific inset structures
                    }
                    return WindowInsetsCompat.CONSUMED;
                });
                ViewCompat.requestApplyInsets(contentView);
            }
        } catch (Throwable ignored) {
            // Keep app launch resilient across HyperOS / Android 14-15 builds
        }
    }
}
