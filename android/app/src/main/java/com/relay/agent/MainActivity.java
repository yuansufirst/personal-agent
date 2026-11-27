package com.relay.agent;

import android.graphics.Color;
import android.os.Bundle;
import android.view.View;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(DshSocketPlugin.class);
        registerPlugin(NativeSpeechPlugin.class);
        registerPlugin(DeviceBridgePlugin.class);
        super.onCreate(savedInstanceState);

        // Ensure Android 15+ forced edge-to-edge never overlaps top status bar or bottom navigation bar
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        View contentView = findViewById(android.R.id.content);
        if (contentView != null) {
            contentView.setBackgroundColor(Color.parseColor("#14171D"));
            ViewCompat.setOnApplyWindowInsetsListener(contentView, (view, windowInsets) -> {
                Insets bars = windowInsets.getInsets(
                    WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
                );
                Insets ime = windowInsets.getInsets(WindowInsetsCompat.Type.ime());
                int bottomPadding = Math.max(bars.bottom, ime.bottom);
                view.setPadding(bars.left, bars.top, bars.right, bottomPadding);
                return WindowInsetsCompat.CONSUMED;
            });
            ViewCompat.requestApplyInsets(contentView);
        }
    }
}
