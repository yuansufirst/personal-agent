package com.relay.agent;

import android.app.Application;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.os.Build;
import android.os.Process;
import android.webkit.WebView;

import java.io.PrintWriter;
import java.io.StringWriter;

public class RelayApplication extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
        if (isCrashProcess()) {
            return;
        }

        final Thread.UncaughtExceptionHandler previous = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((thread, throwable) -> {
            try {
                String report = buildCrashReport(thread, throwable);
                Intent intent = new Intent(getApplicationContext(), CrashReportActivity.class);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
                intent.putExtra(CrashReportActivity.EXTRA_REPORT, report);
                startActivity(intent);
            } catch (Throwable ignored) {
                if (previous != null) {
                    previous.uncaughtException(thread, throwable);
                    return;
                }
            }
            Process.killProcess(Process.myPid());
            System.exit(10);
        });
    }

    private boolean isCrashProcess() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                String proc = Application.getProcessName();
                return proc != null && proc.endsWith(":crash");
            }
        } catch (Throwable ignored) {
            // ignore
        }
        return false;
    }

    private String buildCrashReport(Thread thread, Throwable throwable) {
        StringBuilder sb = new StringBuilder();
        sb.append("Relay Crash Report\n");
        sb.append("Device: ").append(Build.MANUFACTURER).append(" ").append(Build.MODEL).append("\n");
        sb.append("Android: ").append(Build.VERSION.RELEASE)
            .append(" (API ").append(Build.VERSION.SDK_INT).append(")\n");
        sb.append("Display: ").append(Build.DISPLAY).append("\n");
        sb.append("ABI: ").append(Build.SUPPORTED_ABIS != null && Build.SUPPORTED_ABIS.length > 0 ? Build.SUPPORTED_ABIS[0] : "unknown").append("\n");
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                PackageInfo wv = WebView.getCurrentWebViewPackage();
                if (wv != null) {
                    sb.append("WebView: ").append(wv.packageName).append(" ").append(wv.versionName).append("\n");
                } else {
                    sb.append("WebView: null\n");
                }
            }
        } catch (Throwable t) {
            sb.append("WebView: error (").append(t.getMessage()).append(")\n");
        }
        sb.append("Thread: ").append(thread != null ? thread.getName() : "unknown").append("\n\n");

        StringWriter sw = new StringWriter();
        PrintWriter pw = new PrintWriter(sw);
        if (throwable != null) {
            throwable.printStackTrace(pw);
        }
        pw.flush();
        sb.append(sw.toString());
        return sb.toString();
    }
}
