package com.relay.agent;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Bundle;
import android.util.TypedValue;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

public class CrashReportActivity extends Activity {
    public static final String EXTRA_REPORT = "relay_crash_report";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        final String report = getIntent() != null && getIntent().getStringExtra(EXTRA_REPORT) != null
            ? getIntent().getStringExtra(EXTRA_REPORT)
            : "未捕获到具体堆栈信息";

        int pad = dp(16);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.parseColor("#F6F7F9"));
        root.setPadding(pad, dp(48), pad, dp(24));

        TextView title = new TextView(this);
        title.setText("Relay 启动异常日志");
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setTextColor(Color.parseColor("#111318"));
        root.addView(title);

        TextView hint = new TextView(this);
        hint.setText("请点击下方按钮复制报错日志并发送排查：");
        hint.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        hint.setTextColor(Color.parseColor("#525866"));
        LinearLayout.LayoutParams hintLp = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        hintLp.topMargin = dp(6);
        hintLp.bottomMargin = dp(12);
        root.addView(hint, hintLp);

        Button copyBtn = new Button(this);
        copyBtn.setText("一键复制报错日志");
        copyBtn.setTextColor(Color.WHITE);
        copyBtn.setBackgroundColor(Color.parseColor("#111318"));
        copyBtn.setOnClickListener(v -> {
            try {
                ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                if (cm != null) {
                    cm.setPrimaryClip(ClipData.newPlainText("Relay Crash Log", report));
                    Toast.makeText(this, "已复制报错日志", Toast.LENGTH_SHORT).show();
                }
            } catch (Throwable ignored) {
                // ignore
            }
        });
        LinearLayout.LayoutParams btnLp = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        btnLp.bottomMargin = dp(12);
        root.addView(copyBtn, btnLp);

        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(Color.WHITE);
        scroll.setPadding(dp(12), dp(12), dp(12), dp(12));

        TextView logView = new TextView(this);
        logView.setText(report);
        logView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        logView.setTypeface(Typeface.MONOSPACE);
        logView.setTextColor(Color.parseColor("#1F2937"));
        logView.setTextIsSelectable(true);
        scroll.addView(logView);

        LinearLayout.LayoutParams scrollLp = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            0,
            1f
        );
        root.addView(scroll, scrollLp);

        setContentView(root);
    }

    private int dp(int value) {
        return Math.round(TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            value,
            getResources().getDisplayMetrics()
        ));
    }
}
