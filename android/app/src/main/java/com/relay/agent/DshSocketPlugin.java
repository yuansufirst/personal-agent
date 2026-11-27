package com.relay.agent;

import android.graphics.Color;
import android.util.Base64;
import android.view.View;
import android.view.Window;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.MediaType;
import okhttp3.MultipartBody;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;

/**
 * Native OkHttp WebSocket & binary upload bridge for DeepSeek Harness.
 * Bypasses Android WebView's cross-origin / Sec-Fetch-Site: cross-site restrictions
 * and works seamlessly over Cloudflare Tunnel HTTPS/WSS or Tailscale networks.
 */
@CapacitorPlugin(name = "DshSocket")
public class DshSocketPlugin extends Plugin {
    private OkHttpClient wsClient;
    private OkHttpClient httpClient;
    private final Map<String, WebSocket> sockets = new ConcurrentHashMap<>();

    @Override
    public void load() {
        super.load();
        wsClient = new OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .writeTimeout(45, TimeUnit.SECONDS)
            .pingInterval(25, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .build();
        httpClient = new OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(35, TimeUnit.SECONDS)
            .writeTimeout(35, TimeUnit.SECONDS)
            .callTimeout(45, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .build();
    }

    @PluginMethod
    public void connect(PluginCall call) {
        String id = call.getString("id");
        String url = call.getString("url");
        String origin = call.getString("origin");

        if (id == null || id.isEmpty() || url == null || url.isEmpty()) {
            call.reject("Missing required id or url");
            return;
        }

        Request.Builder reqBuilder = new Request.Builder().url(url);
        if (origin != null && !origin.isEmpty()) {
            reqBuilder.header("Origin", origin);
        }

        WebSocket ws = wsClient.newWebSocket(reqBuilder.build(), new WebSocketListener() {
            @Override
            public void onOpen(@NonNull WebSocket webSocket, @NonNull Response response) {
                JSObject payload = new JSObject();
                payload.put("id", id);
                notifyListeners("wsOpen", payload);
            }

            @Override
            public void onMessage(@NonNull WebSocket webSocket, @NonNull String text) {
                JSObject payload = new JSObject();
                payload.put("id", id);
                payload.put("data", text);
                notifyListeners("wsMessage", payload);
            }

            @Override
            public void onClosing(@NonNull WebSocket webSocket, int code, @NonNull String reason) {
                webSocket.close(code, reason);
            }

            @Override
            public void onClosed(@NonNull WebSocket webSocket, int code, @NonNull String reason) {
                sockets.remove(id);
                JSObject payload = new JSObject();
                payload.put("id", id);
                payload.put("code", code);
                payload.put("reason", reason);
                notifyListeners("wsClose", payload);
            }

            @Override
            public void onFailure(@NonNull WebSocket webSocket, @NonNull Throwable t, @Nullable Response response) {
                sockets.remove(id);
                String msg = t.getMessage() != null ? t.getMessage() : t.getClass().getSimpleName();
                if (response != null) {
                    msg = "HTTP " + response.code() + " " + response.message() + " (" + msg + ")";
                }
                JSObject payload = new JSObject();
                payload.put("id", id);
                payload.put("message", msg);
                notifyListeners("wsError", payload);
            }
        });

        sockets.put(id, ws);
        call.resolve();
    }

    @PluginMethod
    public void send(PluginCall call) {
        String id = call.getString("id");
        String data = call.getString("data");
        if (id == null || data == null) {
            call.reject("Missing id or data");
            return;
        }
        WebSocket ws = sockets.get(id);
        if (ws == null) {
            call.reject("Socket not found");
            return;
        }
        boolean ok = ws.send(data);
        if (ok) {
            call.resolve();
        } else {
            call.reject("Failed to enqueue WebSocket frame");
        }
    }

    @PluginMethod
    public void close(PluginCall call) {
        String id = call.getString("id");
        Integer code = call.getInt("code", 1000);
        String reason = call.getString("reason", "");
        if (id != null) {
            WebSocket ws = sockets.remove(id);
            if (ws != null) {
                ws.close(code != null ? code : 1000, reason != null ? reason : "");
            }
        }
        call.resolve();
    }

    private static String toAsciiHeaderFilename(String rawName) {
        String safe = (rawName == null || rawName.isEmpty()) ? "upload.jpg" : rawName;
        StringBuilder ascii = new StringBuilder();
        for (int i = 0; i < safe.length(); i++) {
            char c = safe.charAt(i);
            if (c >= 0x20 && c <= 0x7E && c != '"' && c != '\\') {
                ascii.append(c);
            } else if (c == '.') {
                ascii.append('.');
            } else {
                ascii.append('_');
            }
        }
        String res = ascii.toString().replaceAll("_+", "_").trim();
        return res.isEmpty() ? "upload.jpg" : res;
    }

    /**
     * Uploads raw binary or multipart file bytes natively via OkHttp so images/files
     * bypass WebView CORS and CapacitorHttp Blob serialization quirks.
     */
    @PluginMethod
    public void uploadBinary(PluginCall call) {
        String url = call.getString("url");
        String base64Data = call.getString("base64Data");
        String mimeType = call.getString("mimeType", "application/octet-stream");
        String filename = call.getString("filename", "upload.bin");
        String sessionId = call.getString("sessionId", "");
        String mode = call.getString("mode", "raw"); // "raw" or "multipart"
        String origin = call.getString("origin");

        if (url == null || url.isEmpty() || base64Data == null || base64Data.isEmpty()) {
            call.reject("Missing url or base64Data");
            return;
        }

        byte[] bytes;
        try {
            bytes = Base64.decode(base64Data, Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            call.reject("Invalid base64Data: " + e.getMessage());
            return;
        }

        String safeFilename = (filename != null && !filename.isEmpty()) ? filename : "upload.bin";
        String asciiFilename = toAsciiHeaderFilename(safeFilename);
        String encodedFilename;
        try {
            encodedFilename = URLEncoder.encode(safeFilename, StandardCharsets.UTF_8.name()).replace("+", "%20");
        } catch (Exception e) {
            encodedFilename = asciiFilename;
        }

        MediaType mediaType = MediaType.parse(mimeType != null ? mimeType : "application/octet-stream");
        RequestBody body;
        if ("multipart".equals(mode)) {
            MultipartBody.Builder mb = new MultipartBody.Builder().setType(MultipartBody.FORM);
            if (sessionId != null && !sessionId.isEmpty()) {
                mb.addFormDataPart("sessionId", sessionId);
            }
            mb.addFormDataPart("filename", safeFilename);
            mb.addFormDataPart("mimeType", mimeType != null ? mimeType : "application/octet-stream");
            mb.addFormDataPart(
                "file",
                asciiFilename,
                RequestBody.create(bytes, mediaType)
            );
            body = mb.build();
        } else {
            body = RequestBody.create(bytes, mediaType);
        }

        Request.Builder reqBuilder = new Request.Builder()
            .url(url)
            .post(body);
        if (origin != null && !origin.isEmpty()) {
            reqBuilder.header("Origin", origin);
        }
        if ("raw".equals(mode)) {
            reqBuilder.header("X-File-Name", encodedFilename);
            reqBuilder.header(
                "Content-Disposition",
                "attachment; filename=\"" + asciiFilename + "\"; filename*=UTF-8''" + encodedFilename
            );
            if (sessionId != null && !sessionId.isEmpty()) {
                reqBuilder.header("X-Session-Id", sessionId);
            }
        }

        httpClient.newCall(reqBuilder.build()).enqueue(new Callback() {
            @Override
            public void onFailure(@NonNull Call httpCall, @NonNull IOException e) {
                call.reject(e.getMessage() != null ? e.getMessage() : "Upload network error");
            }

            @Override
            public void onResponse(@NonNull Call httpCall, @NonNull Response response) throws IOException {
                try (Response res = response) {
                    String text = res.body() != null ? res.body().string() : "";
                    JSObject out = new JSObject();
                    out.put("status", res.code());
                    out.put("ok", res.isSuccessful());
                    out.put("body", text);
                    call.resolve(out);
                }
            }
        });
    }

    /**
     * Keeps the Android root inset background and system bar icon luminance in sync
     * with light/dark mode on Android 10–15 edge-to-edge windows.
     */
    @PluginMethod
    public void setWindowBackground(PluginCall call) {
        String colorHex = call.getString("color", "#F8F7F4");
        boolean dark = Boolean.TRUE.equals(call.getBoolean("dark", false));
        if (getActivity() == null) {
            call.resolve();
            return;
        }
        getActivity().runOnUiThread(() -> {
            try {
                int parsed = Color.parseColor(colorHex != null ? colorHex : "#F8F7F4");
                View contentView = getActivity().findViewById(android.R.id.content);
                if (contentView != null) {
                    contentView.setBackgroundColor(parsed);
                }
                Window window = getActivity().getWindow();
                if (window != null) {
                    window.setStatusBarColor(parsed);
                    window.setNavigationBarColor(parsed);
                    WindowInsetsControllerCompat controller =
                        WindowCompat.getInsetsController(window, window.getDecorView());
                    if (controller != null) {
                        controller.setAppearanceLightStatusBars(!dark);
                        controller.setAppearanceLightNavigationBars(!dark);
                    }
                }
            } catch (Exception ignored) {
                // ignore invalid color or unsupported API
            }
            call.resolve();
        });
    }

    @Override
    protected void handleOnDestroy() {
        for (WebSocket ws : sockets.values()) {
            try {
                ws.close(1000, "activity-destroyed");
            } catch (Exception ignored) {
                // ignore
            }
        }
        sockets.clear();
        super.handleOnDestroy();
    }
}
