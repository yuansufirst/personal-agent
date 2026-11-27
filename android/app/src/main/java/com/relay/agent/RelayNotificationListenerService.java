package com.relay.agent;

import android.app.Notification;
import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.provider.Settings;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import android.text.TextUtils;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Passive Android NotificationListenerService (inspired by Today AI)
 * that captures recent third-party app notifications into a local ring buffer
 * so the user can review or share them with their self-hosted cloud Agent on demand.
 */
public class RelayNotificationListenerService extends NotificationListenerService {
    private static final String PREFS_NAME = "relay_device_bridge_prefs";
    private static final String KEY_NOTIFICATIONS = "captured_notifications_v1";
    private static final int MAX_ITEMS = 50;

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        if (sbn == null) return;
        String pkg = sbn.getPackageName();
        if (pkg == null || pkg.isEmpty() || pkg.equals(getPackageName())) return;
        if (sbn.isOngoing()) return;

        Notification notification = sbn.getNotification();
        if (notification == null) return;

        // Ignore silent group summary shells
        if ((notification.flags & Notification.FLAG_GROUP_SUMMARY) != 0) return;

        Bundle extras = notification.extras;
        if (extras == null) return;

        String title = charSeqToString(extras.getCharSequence(Notification.EXTRA_TITLE));
        String bigText = charSeqToString(extras.getCharSequence(Notification.EXTRA_BIG_TEXT));
        String text = charSeqToString(extras.getCharSequence(Notification.EXTRA_TEXT));
        String subText = charSeqToString(extras.getCharSequence(Notification.EXTRA_SUB_TEXT));

        String body = !bigText.isEmpty() ? bigText : text;
        if (title.isEmpty() && body.isEmpty()) return;

        String appName = resolveAppName(this, pkg);
        long postTime = sbn.getPostTime() > 0 ? sbn.getPostTime() : System.currentTimeMillis();

        saveNotification(this, pkg, appName, title, body, subText, postTime, notification.category);
    }

    private static String charSeqToString(CharSequence cs) {
        return cs != null ? cs.toString().trim() : "";
    }

    private static String resolveAppName(Context context, String packageName) {
        try {
            PackageManager pm = context.getPackageManager();
            ApplicationInfo ai = pm.getApplicationInfo(packageName, 0);
            CharSequence label = pm.getApplicationLabel(ai);
            if (label != null && label.length() > 0) {
                return label.toString();
            }
        } catch (Exception ignored) {
            // fallback to package name
        }
        return packageName;
    }

    private static synchronized void saveNotification(
        Context context,
        String packageName,
        String appName,
        String title,
        String text,
        String subText,
        long timestamp,
        String category
    ) {
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String raw = prefs.getString(KEY_NOTIFICATIONS, "[]");
            JSONArray existing = new JSONArray(raw);

            // Deduplicate rapid identical bursts from the same app within 15 seconds
            if (existing.length() > 0) {
                JSONObject first = existing.optJSONObject(0);
                if (first != null
                    && packageName.equals(first.optString("packageName"))
                    && title.equals(first.optString("title"))
                    && text.equals(first.optString("text"))
                    && Math.abs(timestamp - first.optLong("timestamp", 0)) < 15_000L) {
                    return;
                }
            }

            JSONObject entry = new JSONObject();
            entry.put("id", packageName + "_" + timestamp);
            entry.put("packageName", packageName);
            entry.put("appName", appName);
            entry.put("title", title.length() > 160 ? title.substring(0, 160) : title);
            entry.put("text", text.length() > 480 ? text.substring(0, 480) : text);
            entry.put("subText", subText);
            entry.put("timestamp", timestamp);
            entry.put("category", category != null ? category : "");

            JSONArray next = new JSONArray();
            next.put(entry);
            int limit = Math.min(existing.length(), MAX_ITEMS - 1);
            for (int i = 0; i < limit; i++) {
                next.put(existing.get(i));
            }

            prefs.edit().putString(KEY_NOTIFICATIONS, next.toString()).apply();
        } catch (Exception ignored) {
            // ignore storage errors
        }
    }

    public static synchronized JSONArray getCachedNotifications(Context context, int limit) {
        JSONArray out = new JSONArray();
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String raw = prefs.getString(KEY_NOTIFICATIONS, "[]");
            JSONArray existing = new JSONArray(raw);
            int count = Math.min(existing.length(), Math.max(1, Math.min(limit, MAX_ITEMS)));
            for (int i = 0; i < count; i++) {
                out.put(existing.get(i));
            }
        } catch (Exception ignored) {
            // ignore
        }
        return out;
    }

    public static synchronized void clearCache(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putString(KEY_NOTIFICATIONS, "[]").apply();
    }

    public static boolean isEnabled(Context context) {
        try {
            String flat = Settings.Secure.getString(
                context.getContentResolver(),
                "enabled_notification_listeners"
            );
            if (TextUtils.isEmpty(flat)) return false;
            ComponentName self = new ComponentName(context, RelayNotificationListenerService.class);
            String target = self.flattenToString();
            String shortTarget = self.flattenToShortString();
            String[] names = flat.split(":");
            for (String name : names) {
                if (target.equals(name) || shortTarget.equals(name)) {
                    return true;
                }
            }
        } catch (Exception ignored) {
            // ignore
        }
        return false;
    }
}
