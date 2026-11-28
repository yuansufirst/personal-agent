package com.relay.agent;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.location.Address;
import android.location.Geocoder;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.AlarmClock;
import android.provider.CalendarContract;
import android.provider.DocumentsContract;
import android.provider.MediaStore;
import android.provider.Settings;
import android.provider.Telephony;
import android.util.Base64;

import androidx.activity.result.ActivityResult;
import androidx.annotation.NonNull;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Native Android Device Bridge Plugin for Relay.
 * Exposes clipboard, device status/time, calendar read/write, system alarms & timers,
 * SMS inbox read, third-party notification listener buffer, geolocation + reverse geocoding,
 * and SAF scoped-storage filesystem access.
 */
@CapacitorPlugin(
    name = "DeviceBridge",
    permissions = {
        @Permission(
            alias = "calendar",
            strings = {
                Manifest.permission.READ_CALENDAR,
                Manifest.permission.WRITE_CALENDAR
            }
        ),
        @Permission(
            alias = "sms",
            strings = {
                Manifest.permission.READ_SMS
            }
        ),
        @Permission(
            alias = "location",
            strings = {
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION
            }
        )
    }
)
public class DeviceBridgePlugin extends Plugin {
    private static final String PREFS_NAME = "relay_device_bridge_prefs";
    private static final String KEY_FOLDER_URI = "saf_folder_uri_v1";

    private final ExecutorService ioExecutor = Executors.newCachedThreadPool();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    // -------------------------------------------------------------------------
    // 1. Permissions & Overview
    // -------------------------------------------------------------------------

    @PluginMethod
    public void getPermissionStatus(PluginCall call) {
        JSObject status = new JSObject();
        status.put("calendar", getPermissionState("calendar") == PermissionState.GRANTED);
        status.put("sms", getPermissionState("sms") == PermissionState.GRANTED);
        status.put("location", getPermissionState("location") == PermissionState.GRANTED);
        status.put("notifications", RelayNotificationListenerService.isEnabled(getContext()));
        status.put("clipboard", true);
        status.put("alarm", true);
        status.put("time", true);

        String savedFolder = getSavedFolderUri();
        status.put("files", savedFolder != null && !savedFolder.isEmpty());
        status.put("folderLabel", savedFolder != null ? decodeFolderLabel(savedFolder) : "");
        call.resolve(status);
    }

    @PluginMethod
    public void requestCapabilityPermission(PluginCall call) {
        String capability = call.getString("capability", "");
        if ("notifications".equals(capability)) {
            openNotificationSettingsInternal(call);
            return;
        }
        if ("files".equals(capability)) {
            pickFolder(call);
            return;
        }
        if ("calendar".equals(capability) || "sms".equals(capability) || "location".equals(capability)) {
            if (getPermissionState(capability) == PermissionState.GRANTED) {
                JSObject out = new JSObject();
                out.put("granted", true);
                out.put("capability", capability);
                call.resolve(out);
                return;
            }
            requestPermissionForAlias(capability, call, "onCapabilityPermissionResult");
            return;
        }
        JSObject out = new JSObject();
        out.put("granted", true);
        out.put("capability", capability);
        call.resolve(out);
    }

    @PermissionCallback
    private void onCapabilityPermissionResult(PluginCall call) {
        String capability = call.getString("capability", "");
        boolean granted = false;
        if ("calendar".equals(capability) || "sms".equals(capability) || "location".equals(capability)) {
            granted = getPermissionState(capability) == PermissionState.GRANTED;
        }
        JSObject out = new JSObject();
        out.put("granted", granted);
        out.put("capability", capability);
        call.resolve(out);
    }

    // -------------------------------------------------------------------------
    // 2. Time & Device Status
    // -------------------------------------------------------------------------

    @PluginMethod
    public void getDeviceStatus(PluginCall call) {
        Context ctx = getContext();
        Date now = new Date();
        TimeZone tz = TimeZone.getDefault();
        SimpleDateFormat isoFmt = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssZ", Locale.US);
        SimpleDateFormat readableFmt = new SimpleDateFormat("yyyy-MM-dd HH:mm EEEE", Locale.CHINA);

        int batteryPct = -1;
        boolean charging = false;
        try {
            IntentFilter filter = new IntentFilter(Intent.ACTION_BATTERY_CHANGED);
            Intent batteryIntent = ctx.registerReceiver(null, filter);
            if (batteryIntent != null) {
                int level = batteryIntent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
                int scale = batteryIntent.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
                if (level >= 0 && scale > 0) {
                    batteryPct = Math.round((level * 100f) / scale);
                }
                int status = batteryIntent.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
                charging = status == BatteryManager.BATTERY_STATUS_CHARGING
                    || status == BatteryManager.BATTERY_STATUS_FULL;
            }
        } catch (Exception ignored) {
            // ignore
        }

        String networkType = "未知";
        boolean vpnActive = false;
        try {
            ConnectivityManager cm = (ConnectivityManager) ctx.getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm != null) {
                Network activeNet = cm.getActiveNetwork();
                if (activeNet != null) {
                    NetworkCapabilities caps = cm.getNetworkCapabilities(activeNet);
                    if (caps != null) {
                        vpnActive = caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN);
                        if (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) {
                            networkType = "Wi-Fi";
                        } else if (caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) {
                            networkType = "移动网络";
                        } else if (caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) {
                            networkType = "以太网";
                        }
                    }
                }
            }
        } catch (Exception ignored) {
            // ignore
        }

        JSObject out = new JSObject();
        out.put("timestampMs", now.getTime());
        out.put("isoTime", isoFmt.format(now));
        out.put("readableTime", readableFmt.format(now));
        out.put("timeZone", tz.getID());
        out.put("batteryPercent", batteryPct);
        out.put("charging", charging);
        out.put("networkType", networkType);
        out.put("vpnActive", vpnActive);
        out.put("deviceModel", Build.MANUFACTURER + " " + Build.MODEL);
        out.put("androidVersion", "Android " + Build.VERSION.RELEASE);
        call.resolve(out);
    }

    // -------------------------------------------------------------------------
    // 3. Clipboard Read / Write
    // -------------------------------------------------------------------------

    @PluginMethod
    public void readClipboard(PluginCall call) {
        mainHandler.post(() -> {
            try {
                ClipboardManager cm = (ClipboardManager) getContext().getSystemService(Context.CLIPBOARD_SERVICE);
                String text = "";
                String label = "";
                if (cm != null && cm.hasPrimaryClip()) {
                    ClipData clip = cm.getPrimaryClip();
                    if (clip != null && clip.getItemCount() > 0) {
                        CharSequence cs = clip.getItemAt(0).coerceToText(getContext());
                        if (cs != null) text = cs.toString();
                        if (clip.getDescription() != null && clip.getDescription().getLabel() != null) {
                            label = clip.getDescription().getLabel().toString();
                        }
                    }
                }
                JSObject out = new JSObject();
                out.put("text", text);
                out.put("hasText", !text.isEmpty());
                out.put("label", label);
                call.resolve(out);
            } catch (Exception e) {
                call.reject("读取剪贴板失败：" + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void writeClipboard(PluginCall call) {
        String text = call.getString("text", "");
        String label = call.getString("label", "Relay");
        mainHandler.post(() -> {
            try {
                ClipboardManager cm = (ClipboardManager) getContext().getSystemService(Context.CLIPBOARD_SERVICE);
                if (cm == null) {
                    call.reject("无法访问系统剪贴板");
                    return;
                }
                ClipData clip = ClipData.newPlainText(label != null ? label : "Relay", text != null ? text : "");
                cm.setPrimaryClip(clip);
                JSObject out = new JSObject();
                out.put("ok", true);
                call.resolve(out);
            } catch (Exception e) {
                call.reject("写入剪贴板失败：" + e.getMessage());
            }
        });
    }

    // -------------------------------------------------------------------------
    // 4. Calendar Read / Write
    // -------------------------------------------------------------------------

    @PluginMethod
    public void getCalendarEvents(PluginCall call) {
        if (getPermissionState("calendar") != PermissionState.GRANTED) {
            requestPermissionForAlias("calendar", call, "calendarReadPermissionCallback");
            return;
        }
        readCalendarEventsInternal(call);
    }

    @PermissionCallback
    private void calendarReadPermissionCallback(PluginCall call) {
        if (getPermissionState("calendar") == PermissionState.GRANTED) {
            readCalendarEventsInternal(call);
        } else {
            call.reject("未授予日历权限，请在系统设置中允许 Relay 访问日历");
        }
    }

    private void readCalendarEventsInternal(PluginCall call) {
        int daysAhead = call.getInt("daysAhead", 7);
        int limit = call.getInt("limit", 30);
        ioExecutor.execute(() -> {
            JSArray items = new JSArray();
            long now = System.currentTimeMillis();
            // Start from beginning of today so earlier today's events are visible too
            Calendar startCal = Calendar.getInstance();
            startCal.set(Calendar.HOUR_OF_DAY, 0);
            startCal.set(Calendar.MINUTE, 0);
            startCal.set(Calendar.SECOND, 0);
            long startMs = startCal.getTimeInMillis();
            long endMs = now + (long) Math.max(1, Math.min(daysAhead, 60)) * 24L * 3600L * 1000L;

            String[] projection = new String[] {
                CalendarContract.Instances.EVENT_ID,
                CalendarContract.Instances.TITLE,
                CalendarContract.Instances.DESCRIPTION,
                CalendarContract.Instances.EVENT_LOCATION,
                CalendarContract.Instances.BEGIN,
                CalendarContract.Instances.END,
                CalendarContract.Instances.ALL_DAY,
                CalendarContract.Instances.CALENDAR_DISPLAY_NAME
            };

            try (Cursor cursor = CalendarContract.Instances.query(
                getContext().getContentResolver(),
                projection,
                startMs,
                endMs
            )) {
                List<JSObject> list = new ArrayList<>();
                if (cursor != null) {
                    while (cursor.moveToNext()) {
                        JSObject obj = new JSObject();
                        obj.put("id", String.valueOf(cursor.getLong(0)));
                        obj.put("title", safeStr(cursor.getString(1)));
                        obj.put("description", safeStr(cursor.getString(2)));
                        obj.put("location", safeStr(cursor.getString(3)));
                        obj.put("startMs", cursor.getLong(4));
                        obj.put("endMs", cursor.getLong(5));
                        obj.put("allDay", cursor.getInt(6) == 1);
                        obj.put("calendarName", safeStr(cursor.getString(7)));
                        list.add(obj);
                    }
                }
                Collections.sort(list, (a, b) -> Long.compare(a.optLong("startMs", 0L), b.optLong("startMs", 0L)));
                int maxCount = Math.min(list.size(), Math.max(1, limit));
                for (int i = 0; i < maxCount; i++) {
                    items.put(list.get(i));
                }
                JSObject out = new JSObject();
                out.put("events", items);
                out.put("count", items.length());
                call.resolve(out);
            } catch (Exception e) {
                call.reject("读取系统日历失败：" + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void createCalendarEvent(PluginCall call) {
        if (getPermissionState("calendar") != PermissionState.GRANTED) {
            requestPermissionForAlias("calendar", call, "calendarWritePermissionCallback");
            return;
        }
        writeCalendarEventInternal(call);
    }

    @PermissionCallback
    private void calendarWritePermissionCallback(PluginCall call) {
        if (getPermissionState("calendar") == PermissionState.GRANTED) {
            writeCalendarEventInternal(call);
        } else {
            call.reject("未授予日历写入权限");
        }
    }

    private void writeCalendarEventInternal(PluginCall call) {
        String title = call.getString("title", "Relay 日程");
        long rawStartMs = call.getData().optLong("startMs", 0L);
        long rawEndMs = call.getData().optLong("endMs", 0L);
        String location = call.getString("location", "");
        String description = call.getString("description", "");
        boolean allDay = Boolean.TRUE.equals(call.getBoolean("allDay", false));
        int reminderMinutes = call.getInt("reminderMinutes", 15);

        long start = rawStartMs > 0L ? rawStartMs : (System.currentTimeMillis() + 3600_000L);
        long end = rawEndMs > start ? rawEndMs : (start + 3600_000L);

        ioExecutor.execute(() -> {
            try {
                long calendarId = findPrimaryWritableCalendarId(getContext().getContentResolver());
                if (calendarId > 0) {
                    ContentValues values = new ContentValues();
                    values.put(CalendarContract.Events.CALENDAR_ID, calendarId);
                    values.put(CalendarContract.Events.TITLE, title);
                    values.put(CalendarContract.Events.DTSTART, start);
                    values.put(CalendarContract.Events.DTEND, end);
                    values.put(CalendarContract.Events.EVENT_TIMEZONE, TimeZone.getDefault().getID());
                    values.put(CalendarContract.Events.ALL_DAY, allDay ? 1 : 0);
                    if (location != null && !location.isEmpty()) {
                        values.put(CalendarContract.Events.EVENT_LOCATION, location);
                    }
                    if (description != null && !description.isEmpty()) {
                        values.put(CalendarContract.Events.DESCRIPTION, description);
                    }

                    Uri inserted = getContext().getContentResolver().insert(CalendarContract.Events.CONTENT_URI, values);
                    if (inserted != null) {
                        long eventId = Long.parseLong(inserted.getLastPathSegment());
                        if (reminderMinutes >= 0) {
                            try {
                                ContentValues rem = new ContentValues();
                                rem.put(CalendarContract.Reminders.EVENT_ID, eventId);
                                rem.put(CalendarContract.Reminders.MINUTES, reminderMinutes);
                                rem.put(CalendarContract.Reminders.METHOD, CalendarContract.Reminders.METHOD_ALERT);
                                getContext().getContentResolver().insert(CalendarContract.Reminders.CONTENT_URI, rem);
                            } catch (Exception ignored) {
                                // reminder optional
                            }
                        }
                        JSObject out = new JSObject();
                        out.put("ok", true);
                        out.put("mode", "direct");
                        out.put("eventId", String.valueOf(eventId));
                        call.resolve(out);
                        return;
                    }
                }

                // Fallback to system calendar intent if no local writable account is configured
                mainHandler.post(() -> {
                    Intent intent = new Intent(Intent.ACTION_INSERT)
                        .setData(CalendarContract.Events.CONTENT_URI)
                        .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, start)
                        .putExtra(CalendarContract.EXTRA_EVENT_END_TIME, end)
                        .putExtra(CalendarContract.Events.TITLE, title)
                        .putExtra(CalendarContract.Events.DESCRIPTION, description)
                        .putExtra(CalendarContract.Events.EVENT_LOCATION, location)
                        .putExtra(CalendarContract.EXTRA_EVENT_ALL_DAY, allDay);
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    getContext().startActivity(intent);
                    JSObject out = new JSObject();
                    out.put("ok", true);
                    out.put("mode", "intent");
                    call.resolve(out);
                });
            } catch (Exception e) {
                call.reject("写入系统日历失败：" + e.getMessage());
            }
        });
    }

    private long findPrimaryWritableCalendarId(ContentResolver resolver) {
        String[] proj = new String[] {
            CalendarContract.Calendars._ID,
            CalendarContract.Calendars.IS_PRIMARY,
            CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL,
            CalendarContract.Calendars.VISIBLE
        };
        long fallbackId = -1L;
        try (Cursor c = resolver.query(CalendarContract.Calendars.CONTENT_URI, proj, null, null, null)) {
            if (c != null) {
                while (c.moveToNext()) {
                    long id = c.getLong(0);
                    int isPrimary = c.getInt(1);
                    int access = c.getInt(2);
                    int visible = c.getInt(3);
                    if (access >= CalendarContract.Calendars.CAL_ACCESS_CONTRIBUTOR) {
                        if (isPrimary == 1 && visible == 1) {
                            return id;
                        }
                        if (fallbackId < 0) {
                            fallbackId = id;
                        }
                    }
                }
            }
        } catch (Exception ignored) {
            // ignore
        }
        return fallbackId;
    }

    // -------------------------------------------------------------------------
    // 5. System Alarm & Timer
    // -------------------------------------------------------------------------

    @PluginMethod
    public void setAlarm(PluginCall call) {
        Integer hour = call.getInt("hour");
        Integer minute = call.getInt("minute");
        String message = call.getString("message", "Relay 提醒");
        boolean skipUi = Boolean.TRUE.equals(call.getBoolean("skipUi", true));
        JSArray daysArr = call.getArray("days");

        if (hour == null || minute == null || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
            call.reject("闹钟时间无效（小时 0-23，分钟 0-59）");
            return;
        }

        mainHandler.post(() -> {
            try {
                Intent intent = new Intent(AlarmClock.ACTION_SET_ALARM);
                intent.putExtra(AlarmClock.EXTRA_HOUR, hour);
                intent.putExtra(AlarmClock.EXTRA_MINUTES, minute);
                intent.putExtra(AlarmClock.EXTRA_MESSAGE, message != null ? message : "Relay 提醒");
                intent.putExtra(AlarmClock.EXTRA_SKIP_UI, skipUi);

                if (daysArr != null && daysArr.length() > 0) {
                    ArrayList<Integer> days = new ArrayList<>();
                    for (int i = 0; i < daysArr.length(); i++) {
                        int d = daysArr.optInt(i, -1);
                        if (d >= Calendar.SUNDAY && d <= Calendar.SATURDAY) {
                            days.add(d);
                        }
                    }
                    if (!days.isEmpty()) {
                        intent.putExtra(AlarmClock.EXTRA_DAYS, days);
                    }
                }

                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
                JSObject out = new JSObject();
                out.put("ok", true);
                out.put("hour", hour);
                out.put("minute", minute);
                call.resolve(out);
            } catch (Exception e) {
                call.reject("调用系统闹钟失败：" + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void setTimer(PluginCall call) {
        Integer seconds = call.getInt("seconds");
        String message = call.getString("message", "Relay 倒计时");
        boolean skipUi = Boolean.TRUE.equals(call.getBoolean("skipUi", true));

        if (seconds == null || seconds <= 0) {
            call.reject("倒计时秒数必须大于 0");
            return;
        }

        mainHandler.post(() -> {
            try {
                Intent intent = new Intent(AlarmClock.ACTION_SET_TIMER);
                intent.putExtra(AlarmClock.EXTRA_LENGTH, seconds);
                intent.putExtra(AlarmClock.EXTRA_MESSAGE, message != null ? message : "Relay 倒计时");
                intent.putExtra(AlarmClock.EXTRA_SKIP_UI, skipUi);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
                JSObject out = new JSObject();
                out.put("ok", true);
                out.put("seconds", seconds);
                call.resolve(out);
            } catch (Exception e) {
                call.reject("启动系统倒计时失败：" + e.getMessage());
            }
        });
    }

    // -------------------------------------------------------------------------
    // 6. SMS Inbox Read
    // -------------------------------------------------------------------------

    @PluginMethod
    public void getRecentSms(PluginCall call) {
        if (getPermissionState("sms") != PermissionState.GRANTED) {
            requestPermissionForAlias("sms", call, "smsPermissionCallback");
            return;
        }
        readRecentSmsInternal(call);
    }

    @PermissionCallback
    private void smsPermissionCallback(PluginCall call) {
        if (getPermissionState("sms") == PermissionState.GRANTED) {
            readRecentSmsInternal(call);
        } else {
            call.reject("未授予读取短信权限，请在系统设置中允许 Relay 访问短信");
        }
    }

    private void readRecentSmsInternal(PluginCall call) {
        int limit = call.getInt("limit", 15);
        String keyword = call.getString("keyword", "");
        String cleanKeyword = keyword != null ? keyword.trim().toLowerCase(Locale.ROOT) : "";

        ioExecutor.execute(() -> {
            JSArray items = new JSArray();
            String[] projection = new String[] {
                Telephony.Sms._ID,
                Telephony.Sms.ADDRESS,
                Telephony.Sms.BODY,
                Telephony.Sms.DATE,
                Telephony.Sms.READ
            };

            try (Cursor cursor = getContext().getContentResolver().query(
                Telephony.Sms.Inbox.CONTENT_URI,
                projection,
                null,
                null,
                Telephony.Sms.DEFAULT_SORT_ORDER
            )) {
                int maxCount = Math.max(1, Math.min(limit, 50));
                if (cursor != null) {
                    while (cursor.moveToNext() && items.length() < maxCount) {
                        String address = safeStr(cursor.getString(1));
                        String body = safeStr(cursor.getString(2));
                        if (!cleanKeyword.isEmpty()
                            && !address.toLowerCase(Locale.ROOT).contains(cleanKeyword)
                            && !body.toLowerCase(Locale.ROOT).contains(cleanKeyword)) {
                            continue;
                        }
                        JSObject obj = new JSObject();
                        obj.put("id", safeStr(cursor.getString(0)));
                        obj.put("address", address);
                        obj.put("body", body.length() > 500 ? body.substring(0, 500) : body);
                        obj.put("timestamp", cursor.getLong(3));
                        obj.put("read", cursor.getInt(4) == 1);
                        obj.put("tag", classifySmsTag(body));
                        items.put(obj);
                    }
                }
                JSObject out = new JSObject();
                out.put("messages", items);
                out.put("count", items.length());
                call.resolve(out);
            } catch (Exception e) {
                call.reject("读取短信失败：" + e.getMessage());
            }
        });
    }

    private String classifySmsTag(String body) {
        if (body.contains("验证码") || body.contains("校验码") || body.contains("动态码") || body.contains("OTP")) {
            return "验证码";
        }
        if (body.contains("快递") || body.contains("取件码") || body.contains("菜鸟") || body.contains("丰巢") || body.contains("顺丰")) {
            return "快递";
        }
        if (body.contains("航班") || body.contains("列车") || body.contains("高铁") || body.contains("检票口") || body.contains("值机")) {
            return "出行";
        }
        if (body.contains("消费") || body.contains("入账") || body.contains("还款") || body.contains("账单") || body.contains("余额")) {
            return "账单";
        }
        return "短信";
    }

    // -------------------------------------------------------------------------
    // 7. System Notifications (Today-style NotificationListenerService)
    // -------------------------------------------------------------------------

    @PluginMethod
    public void getNotifications(PluginCall call) {
        int limit = call.getInt("limit", 25);
        boolean enabled = RelayNotificationListenerService.isEnabled(getContext());
        JSONArray cached = RelayNotificationListenerService.getCachedNotifications(getContext(), limit);
        JSArray arr = new JSArray();
        for (int i = 0; i < cached.length(); i++) {
            JSONObject obj = cached.optJSONObject(i);
            if (obj != null) {
                arr.put(obj);
            }
        }
        JSObject out = new JSObject();
        out.put("enabled", enabled);
        out.put("notifications", arr);
        out.put("count", arr.length());
        call.resolve(out);
    }

    @PluginMethod
    public void clearNotifications(PluginCall call) {
        RelayNotificationListenerService.clearCache(getContext());
        JSObject out = new JSObject();
        out.put("ok", true);
        call.resolve(out);
    }

    @PluginMethod
    public void openNotificationAccessSettings(PluginCall call) {
        openNotificationSettingsInternal(call);
    }

    private void openNotificationSettingsInternal(PluginCall call) {
        mainHandler.post(() -> {
            try {
                Intent intent = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
                JSObject out = new JSObject();
                out.put("opened", true);
                call.resolve(out);
            } catch (Exception e) {
                call.reject("无法打开通知使用权设置页：" + e.getMessage());
            }
        });
    }

    // -------------------------------------------------------------------------
    // 8. Geolocation + Reverse Geocoding
    // -------------------------------------------------------------------------

    @PluginMethod
    public void getLocation(PluginCall call) {
        if (getPermissionState("location") != PermissionState.GRANTED) {
            requestPermissionForAlias("location", call, "locationPermissionCallback");
            return;
        }
        fetchLocationInternal(call);
    }

    @PermissionCallback
    private void locationPermissionCallback(PluginCall call) {
        if (getPermissionState("location") == PermissionState.GRANTED) {
            fetchLocationInternal(call);
        } else {
            call.reject("未授予定位权限，请在系统设置中允许 Relay 访问位置信息");
        }
    }

    @SuppressLint("MissingPermission")
    private void fetchLocationInternal(PluginCall call) {
        mainHandler.post(() -> {
            try {
                LocationManager lm = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
                if (lm == null) {
                    call.reject("设备不支持定位服务");
                    return;
                }

                Location best = getBestLastKnownLocation(lm);
                long now = System.currentTimeMillis();
                if (best != null && (now - best.getTime()) < 5 * 60 * 1000L) {
                    resolveLocationWithGeocode(call, best);
                    return;
                }

                String provider = lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
                    ? LocationManager.NETWORK_PROVIDER
                    : (lm.isProviderEnabled(LocationManager.GPS_PROVIDER) ? LocationManager.GPS_PROVIDER : null);

                if (provider == null) {
                    if (best != null) {
                        resolveLocationWithGeocode(call, best);
                    } else {
                        call.reject("请先开启手机定位开关（GPS/位置服务）");
                    }
                    return;
                }

                final boolean[] completed = new boolean[] { false };
                LocationListener listener = new LocationListener() {
                    @Override
                    public void onLocationChanged(@NonNull Location location) {
                        if (completed[0]) return;
                        completed[0] = true;
                        lm.removeUpdates(this);
                        resolveLocationWithGeocode(call, location);
                    }

                    @Override
                    public void onStatusChanged(String p, int s, Bundle extras) {}

                    @Override
                    public void onProviderEnabled(@NonNull String p) {}

                    @Override
                    public void onProviderDisabled(@NonNull String p) {}
                };

                lm.requestLocationUpdates(provider, 0L, 0f, listener, Looper.getMainLooper());
                mainHandler.postDelayed(() -> {
                    if (completed[0]) return;
                    completed[0] = true;
                    lm.removeUpdates(listener);
                    if (best != null) {
                        resolveLocationWithGeocode(call, best);
                    } else {
                        call.reject("定位超时，请移步信号较好区域或确认定位已开启");
                    }
                }, 6000L);
            } catch (Exception e) {
                call.reject("获取位置失败：" + e.getMessage());
            }
        });
    }

    @SuppressLint("MissingPermission")
    private Location getBestLastKnownLocation(LocationManager lm) {
        Location best = null;
        List<String> providers = lm.getProviders(true);
        for (String p : providers) {
            try {
                Location l = lm.getLastKnownLocation(p);
                if (l == null) continue;
                if (best == null || l.getTime() > best.getTime()) {
                    best = l;
                }
            } catch (Exception ignored) {
                // ignore
            }
        }
        return best;
    }

    @SuppressWarnings("deprecation")
    private void resolveLocationWithGeocode(PluginCall call, Location location) {
        ioExecutor.execute(() -> {
            String addressText = "";
            String city = "";
            String district = "";
            try {
                if (Geocoder.isPresent()) {
                    Geocoder geocoder = new Geocoder(getContext(), Locale.CHINA);
                    List<Address> addresses = geocoder.getFromLocation(
                        location.getLatitude(),
                        location.getLongitude(),
                        1
                    );
                    if (addresses != null && !addresses.isEmpty()) {
                        Address addr = addresses.get(0);
                        city = safeStr(addr.getLocality());
                        district = safeStr(addr.getSubLocality());
                        if (addr.getAddressLine(0) != null) {
                            addressText = addr.getAddressLine(0);
                        } else {
                            addressText = (safeStr(addr.getAdminArea()) + city + district + safeStr(addr.getFeatureName())).trim();
                        }
                    }
                }
            } catch (Exception ignored) {
                // Geocoder is optional (some domestic ROMs lack GMS Geocoder backend)
            }

            JSObject out = new JSObject();
            out.put("latitude", location.getLatitude());
            out.put("longitude", location.getLongitude());
            out.put("accuracy", location.getAccuracy());
            out.put("timestamp", location.getTime());
            out.put("provider", safeStr(location.getProvider()));
            out.put("address", addressText);
            out.put("city", city);
            out.put("district", district);
            call.resolve(out);
        });
    }

    // -------------------------------------------------------------------------
    // 9. Android Scoped Storage Filesystem (SAF Document Tree)
    // -------------------------------------------------------------------------

    @PluginMethod
    public void pickFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(
            Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
                | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION
        );
        startActivityForResult(call, intent, "handlePickFolderResult");
    }

    @ActivityCallback
    private void handlePickFolderResult(PluginCall call, ActivityResult result) {
        if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
            Uri treeUri = result.getData().getData();
            if (treeUri != null) {
                try {
                    int flags = result.getData().getFlags()
                        & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                    if (flags == 0) {
                        flags = Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
                    }
                    getContext().getContentResolver().takePersistableUriPermission(treeUri, flags);
                } catch (Exception ignored) {
                    // persist best-effort
                }
                SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
                prefs.edit().putString(KEY_FOLDER_URI, treeUri.toString()).apply();

                JSObject out = new JSObject();
                out.put("granted", true);
                out.put("uri", treeUri.toString());
                out.put("folderLabel", decodeFolderLabel(treeUri.toString()));
                call.resolve(out);
                return;
            }
        }
        JSObject out = new JSObject();
        out.put("granted", false);
        call.resolve(out);
    }

    @PluginMethod
    public void listFolderFiles(PluginCall call) {
        String saved = getSavedFolderUri();
        if (saved == null || saved.isEmpty()) {
            call.reject("尚未授权本地目录，请先点击选择手机文件夹");
            return;
        }
        int limit = call.getInt("limit", 40);

        ioExecutor.execute(() -> {
            try {
                Uri treeUri = Uri.parse(saved);
                String docId = DocumentsContract.getTreeDocumentId(treeUri);
                Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, docId);

                String[] proj = new String[] {
                    DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                    DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                    DocumentsContract.Document.COLUMN_MIME_TYPE,
                    DocumentsContract.Document.COLUMN_SIZE,
                    DocumentsContract.Document.COLUMN_LAST_MODIFIED
                };

                List<JSObject> list = new ArrayList<>();
                try (Cursor cursor = getContext().getContentResolver().query(childrenUri, proj, null, null, null)) {
                    if (cursor != null) {
                        while (cursor.moveToNext()) {
                            String childDocId = cursor.getString(0);
                            String name = safeStr(cursor.getString(1));
                            String mime = safeStr(cursor.getString(2));
                            long size = cursor.isNull(3) ? 0L : cursor.getLong(3);
                            long modified = cursor.isNull(4) ? 0L : cursor.getLong(4);
                            Uri fileUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, childDocId);

                            JSObject item = new JSObject();
                            item.put("documentId", childDocId);
                            item.put("name", name);
                            item.put("mimeType", mime);
                            item.put("size", size);
                            item.put("lastModified", modified);
                            item.put("isDirectory", DocumentsContract.Document.MIME_TYPE_DIR.equals(mime));
                            item.put("uri", fileUri.toString());
                            list.add(item);
                        }
                    }
                }

                Collections.sort(list, (a, b) -> Long.compare(b.optLong("lastModified", 0L), a.optLong("lastModified", 0L)));
                JSArray arr = new JSArray();
                int count = Math.min(list.size(), Math.max(1, limit));
                for (int i = 0; i < count; i++) {
                    arr.put(list.get(i));
                }

                JSObject out = new JSObject();
                out.put("folderLabel", decodeFolderLabel(saved));
                out.put("files", arr);
                out.put("count", arr.length());
                call.resolve(out);
            } catch (Exception e) {
                call.reject("读取手机目录失败（可能需要重新授权文件夹）：" + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void readDocumentFile(PluginCall call) {
        String uriStr = call.getString("uri");
        int maxBytes = call.getInt("maxBytes", 65536);
        if (uriStr == null || uriStr.isEmpty()) {
            call.reject("缺少文件 URI");
            return;
        }
        ioExecutor.execute(() -> {
            try {
                Uri uri = Uri.parse(uriStr);
                int cap = Math.max(1024, Math.min(maxBytes, 262144));
                ByteArrayOutputStream bos = new ByteArrayOutputStream();
                byte[] buf = new byte[4096];
                int total = 0;
                boolean truncated = false;
                try (InputStream is = getContext().getContentResolver().openInputStream(uri)) {
                    if (is == null) {
                        call.reject("无法打开该文件");
                        return;
                    }
                    int n;
                    while ((n = is.read(buf)) > 0) {
                        if (total + n > cap) {
                            bos.write(buf, 0, cap - total);
                            truncated = true;
                            break;
                        }
                        bos.write(buf, 0, n);
                        total += n;
                    }
                }
                String content = new String(bos.toByteArray(), StandardCharsets.UTF_8);
                JSObject out = new JSObject();
                out.put("content", content);
                out.put("bytesRead", bos.size());
                out.put("truncated", truncated);
                call.resolve(out);
            } catch (Exception e) {
                call.reject("读取本地文件失败：" + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void writeDocumentFile(PluginCall call) {
        String saved = getSavedFolderUri();
        String filename = call.getString("filename", "relay-note.md");
        String content = call.getString("content", "");
        String mimeType = call.getString("mimeType", "text/markdown");

        if (saved == null || saved.isEmpty()) {
            call.reject("尚未授权手机目录，请先在「空间 → 手机接入」选择可写入的文件夹");
            return;
        }

        ioExecutor.execute(() -> {
            try {
                Uri treeUri = Uri.parse(saved);
                String parentDocId = DocumentsContract.getTreeDocumentId(treeUri);
                Uri parentUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, parentDocId);
                Uri createdUri = DocumentsContract.createDocument(
                    getContext().getContentResolver(),
                    parentUri,
                    mimeType != null ? mimeType : "text/plain",
                    filename != null ? filename : "relay-note.md"
                );
                if (createdUri == null) {
                    call.reject("在授权目录中创建文件失败");
                    return;
                }
                try (OutputStream os = getContext().getContentResolver().openOutputStream(createdUri, "wt")) {
                    if (os != null) {
                        os.write((content != null ? content : "").getBytes(StandardCharsets.UTF_8));
                        os.flush();
                    }
                }
                JSObject out = new JSObject();
                out.put("ok", true);
                out.put("uri", createdUri.toString());
                out.put("filename", filename);
                call.resolve(out);
            } catch (Exception e) {
                call.reject("写入本地文件失败：" + e.getMessage());
            }
        });
    }

    /**
     * Saves any received image or arbitrary binary file directly into Android Pictures/Relay
     * or Downloads/Relay via MediaStore (Android 10+) without requiring pre-selected SAF folder.
     */
    @PluginMethod
    public void saveBinaryFile(PluginCall call) {
        String filename = call.getString("filename", "relay-file.bin");
        String base64Data = call.getString("base64Data");
        String mimeType = call.getString("mimeType", "application/octet-stream");

        if (base64Data == null || base64Data.isEmpty()) {
            call.reject("文件内容为空");
            return;
        }

        String safeName = (filename != null && !filename.trim().isEmpty())
            ? filename.trim().replaceAll("[\\\\/:*?\"<>|]", "_")
            : "relay-file.bin";
        String safeMime = (mimeType != null && !mimeType.trim().isEmpty())
            ? mimeType.trim()
            : "application/octet-stream";

        ioExecutor.execute(() -> {
            try {
                byte[] bytes = Base64.decode(base64Data, Base64.DEFAULT);
                boolean isImage = safeMime.startsWith("image/");

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentResolver resolver = getContext().getContentResolver();
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.MediaColumns.DISPLAY_NAME, safeName);
                    values.put(MediaStore.MediaColumns.MIME_TYPE, safeMime);
                    String relDir = isImage
                        ? Environment.DIRECTORY_PICTURES + "/Relay"
                        : Environment.DIRECTORY_DOWNLOADS + "/Relay";
                    values.put(MediaStore.MediaColumns.RELATIVE_PATH, relDir);
                    values.put(MediaStore.MediaColumns.IS_PENDING, 1);

                    Uri collection = isImage
                        ? MediaStore.Images.Media.EXTERNAL_CONTENT_URI
                        : MediaStore.Downloads.EXTERNAL_CONTENT_URI;
                    Uri itemUri = resolver.insert(collection, values);
                    if (itemUri == null) {
                        call.reject("系统媒体库创建文件失败");
                        return;
                    }
                    try (OutputStream os = resolver.openOutputStream(itemUri)) {
                        if (os == null) {
                            call.reject("无法写入目标文件");
                            return;
                        }
                        os.write(bytes);
                        os.flush();
                    }
                    ContentValues doneValues = new ContentValues();
                    doneValues.put(MediaStore.MediaColumns.IS_PENDING, 0);
                    resolver.update(itemUri, doneValues, null, null);

                    JSObject out = new JSObject();
                    out.put("ok", true);
                    out.put("uri", itemUri.toString());
                    out.put("filename", safeName);
                    out.put("location", isImage ? "相册 / Pictures/Relay" : "下载 / Downloads/Relay");
                    call.resolve(out);
                    return;
                }

                // Fallback for Android 9 and below: app-scoped external Downloads/Relay
                File baseDir = getContext().getExternalFilesDir(
                    isImage ? Environment.DIRECTORY_PICTURES : Environment.DIRECTORY_DOWNLOADS
                );
                if (baseDir == null) {
                    baseDir = getContext().getFilesDir();
                }
                File targetDir = new File(baseDir, "Relay");
                if (!targetDir.exists()) {
                    targetDir.mkdirs();
                }
                File outFile = new File(targetDir, safeName);
                try (FileOutputStream fos = new FileOutputStream(outFile)) {
                    fos.write(bytes);
                    fos.flush();
                }

                JSObject out = new JSObject();
                out.put("ok", true);
                out.put("uri", Uri.fromFile(outFile).toString());
                out.put("filename", safeName);
                out.put("location", outFile.getAbsolutePath());
                call.resolve(out);
            } catch (Exception e) {
                call.reject("保存文件到手机失败：" + e.getMessage());
            }
        });
    }

    private String getSavedFolderUri() {
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        return prefs.getString(KEY_FOLDER_URI, null);
    }

    private String decodeFolderLabel(String uriString) {
        try {
            String decoded = Uri.decode(uriString);
            int idx = decoded.lastIndexOf(':');
            if (idx >= 0 && idx + 1 < decoded.length()) {
                return decoded.substring(idx + 1);
            }
            int slash = decoded.lastIndexOf('/');
            if (slash >= 0 && slash + 1 < decoded.length()) {
                return decoded.substring(slash + 1);
            }
            return decoded;
        } catch (Exception e) {
            return "已授权目录";
        }
    }

    private static String safeStr(String s) {
        return s != null ? s : "";
    }

    @Override
    protected void handleOnDestroy() {
        ioExecutor.shutdownNow();
        super.handleOnDestroy();
    }
}
