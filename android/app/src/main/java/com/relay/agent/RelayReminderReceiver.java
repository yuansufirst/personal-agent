package com.relay.agent;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

/**
 * BroadcastReceiver for scheduled Android status-bar notifications triggered by AlarmManager,
 * plus shared notification channel & immediate posting helpers.
 */
public class RelayReminderReceiver extends BroadcastReceiver {
    public static final String ACTION_REMINDER_NOTIFY = "com.relay.agent.ACTION_REMINDER_NOTIFY";
    public static final String CHANNEL_REMINDERS = "relay_reminders";
    public static final String CHANNEL_UPDATES = "relay_updates";

    public static final String EXTRA_NOTIF_ID = "notifId";
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_BODY = "body";
    public static final String EXTRA_CHANNEL = "channelId";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (context == null || intent == null) return;
        try {
            int notifId = intent.getIntExtra(EXTRA_NOTIF_ID, (int) (System.currentTimeMillis() & 0x7fffffff));
            String title = intent.getStringExtra(EXTRA_TITLE);
            String body = intent.getStringExtra(EXTRA_BODY);
            String channelId = intent.getStringExtra(EXTRA_CHANNEL);
            showNotification(
                context,
                notifId,
                (title != null && !title.trim().isEmpty()) ? title.trim() : "Relay 提醒",
                body != null ? body.trim() : "",
                channelId != null ? channelId : CHANNEL_REMINDERS
            );
        } catch (Throwable ignored) {
            // Never crash receiver on OEM ROMs
        }
    }

    public static void ensureChannels(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || context == null) return;
        try {
            NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;

            NotificationChannel reminders = new NotificationChannel(
                CHANNEL_REMINDERS,
                "Relay 提醒与日程",
                NotificationManager.IMPORTANCE_HIGH
            );
            reminders.setDescription("日程到期提醒、待办提醒与云端助理重要推送");
            reminders.enableVibration(true);
            nm.createNotificationChannel(reminders);

            NotificationChannel updates = new NotificationChannel(
                CHANNEL_UPDATES,
                "Relay 助理动态",
                NotificationManager.IMPORTANCE_DEFAULT
            );
            updates.setDescription("云端助理同步与简报动态通知");
            nm.createNotificationChannel(updates);
        } catch (Throwable ignored) {
            // ignore
        }
    }

    public static boolean canPostNotifications(Context context) {
        if (context == null) return false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED;
        }
        return NotificationManagerCompat.from(context).areNotificationsEnabled();
    }

    public static boolean showNotification(
        Context context,
        int notifId,
        String title,
        String body,
        String channelId
    ) {
        if (context == null) return false;
        try {
            if (!canPostNotifications(context)) {
                return false;
            }
            ensureChannels(context);
            String resolvedChannel =
                (CHANNEL_UPDATES.equals(channelId) || "updates".equals(channelId))
                    ? CHANNEL_UPDATES
                    : CHANNEL_REMINDERS;

            Intent launchIntent = new Intent(context, MainActivity.class);
            launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            int piFlags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                piFlags |= PendingIntent.FLAG_IMMUTABLE;
            }
            PendingIntent contentPi = PendingIntent.getActivity(context, notifId, launchIntent, piFlags);

            int smallIcon = context.getApplicationInfo().icon;
            if (smallIcon == 0) {
                smallIcon = android.R.drawable.ic_popup_reminder;
            }

            NotificationCompat.Builder builder = new NotificationCompat.Builder(context, resolvedChannel)
                .setSmallIcon(smallIcon)
                .setContentTitle(title != null && !title.isEmpty() ? title : "Relay 提醒")
                .setContentText(body != null ? body : "")
                .setAutoCancel(true)
                .setContentIntent(contentPi)
                .setPriority(
                    CHANNEL_REMINDERS.equals(resolvedChannel)
                        ? NotificationCompat.PRIORITY_HIGH
                        : NotificationCompat.PRIORITY_DEFAULT
                )
                .setCategory(NotificationCompat.CATEGORY_REMINDER)
                .setDefaults(NotificationCompat.DEFAULT_ALL);

            if (body != null && body.length() > 36) {
                builder.setStyle(new NotificationCompat.BigTextStyle().bigText(body));
            }

            NotificationManagerCompat.from(context).notify(notifId, builder.build());
            return true;
        } catch (Throwable ignored) {
            return false;
        }
    }
}
