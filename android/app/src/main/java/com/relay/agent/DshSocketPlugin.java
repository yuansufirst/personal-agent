package com.relay.agent;

import android.graphics.Color;
import android.os.Build;
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
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.HttpUrl;
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
        ensureClients();
    }

    private synchronized void ensureClients() {
        if (wsClient == null) {
            try {
                wsClient = new OkHttpClient.Builder()
                    .connectTimeout(15, TimeUnit.SECONDS)
                    .readTimeout(0, TimeUnit.MILLISECONDS)
                    .writeTimeout(45, TimeUnit.SECONDS)
                    .pingInterval(25, TimeUnit.SECONDS)
                    .retryOnConnectionFailure(true)
                    .build();
            } catch (Throwable ignored) {
                // will retry lazily on first network call
            }
        }
        if (httpClient == null) {
            try {
                httpClient = new OkHttpClient.Builder()
                    .connectTimeout(15, TimeUnit.SECONDS)
                    .readTimeout(35, TimeUnit.SECONDS)
                    .writeTimeout(35, TimeUnit.SECONDS)
                    .callTimeout(45, TimeUnit.SECONDS)
                    .retryOnConnectionFailure(true)
                    .build();
            } catch (Throwable ignored) {
                // will retry lazily on first network call
            }
        }
    }

    @Nullable
    private static HttpUrl parseHttpUrl(@Nullable String rawUrl) {
        if (rawUrl == null) return null;
        String trimmed = rawUrl.trim();
        if (trimmed.isEmpty()) return null;
        return HttpUrl.parse(trimmed);
    }

    @Nullable
    private static String normalizeWsUrl(@Nullable String rawUrl) {
        if (rawUrl == null) return null;
        String trimmed = rawUrl.trim();
        if (trimmed.isEmpty()) return null;
        String lower = trimmed.toLowerCase(Locale.ROOT);
        String httpCandidate;
        if (lower.startsWith("wss://")) {
            httpCandidate = "https://" + trimmed.substring(6);
        } else if (lower.startsWith("ws://")) {
            httpCandidate = "http://" + trimmed.substring(5);
        } else if (lower.startsWith("https://") || lower.startsWith("http://")) {
            httpCandidate = trimmed;
        } else {
            return null;
        }
        if (HttpUrl.parse(httpCandidate) == null) {
            return null;
        }
        return trimmed;
    }

    @PluginMethod
    public void connect(PluginCall call) {
        try {
            String id = call.getString("id");
            String rawUrl = call.getString("url");
            String origin = call.getString("origin");

            if (id == null || id.isEmpty() || rawUrl == null || rawUrl.isEmpty()) {
                call.reject("Missing required id or url");
                return;
            }

            String validUrl = normalizeWsUrl(rawUrl);
            if (validUrl == null) {
                call.reject("Invalid WebSocket URL: " + rawUrl);
                return;
            }

            Request.Builder reqBuilder = new Request.Builder().url(validUrl);
            if (origin != null && !origin.isEmpty()) {
                reqBuilder.header("Origin", origin);
            }

            ensureClients();
            if (wsClient == null) {
                call.reject("Network client unavailable");
                return;
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
        } catch (Throwable t) {
            call.reject(t.getMessage() != null ? t.getMessage() : "WebSocket connect error");
        }
    }

    @PluginMethod
    public void send(PluginCall call) {
        try {
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
        } catch (Throwable t) {
            call.reject(t.getMessage() != null ? t.getMessage() : "WebSocket send error");
        }
    }

    @PluginMethod
    public void close(PluginCall call) {
        try {
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
        } catch (Throwable t) {
            call.resolve();
        }
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
        try {
            String rawUrl = call.getString("url");
            String base64Data = call.getString("base64Data");
            String mimeType = call.getString("mimeType", "application/octet-stream");
            String filename = call.getString("filename", "upload.bin");
            String sessionId = call.getString("sessionId", "");
            String mode = call.getString("mode", "raw"); // "raw" or "multipart"
            String origin = call.getString("origin");
            Integer timeoutMsObj = call.getInt("timeoutMs", 180000);
            int timeoutMs = timeoutMsObj != null ? Math.max(15000, Math.min(timeoutMsObj, 300000)) : 180000;

            if (rawUrl == null || rawUrl.isEmpty() || base64Data == null || base64Data.isEmpty()) {
                call.reject("Missing url or base64Data");
                return;
            }

            HttpUrl parsedUrl = parseHttpUrl(rawUrl);
            if (parsedUrl == null) {
                call.reject("Invalid upload URL (must start with http:// or https://): " + rawUrl);
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

            MediaType mediaType = MediaType.parse(mimeType != null ? mimeType : "application/octet-stream");
            RequestBody body;
            if ("multipart".equals(mode)) {
                MultipartBody.Builder mb = new MultipartBody.Builder().setType(MultipartBody.FORM);
                if (sessionId != null && !sessionId.isEmpty()) {
                    mb.addFormDataPart("sessionId", sessionId);
                }
                mb.addFormDataPart("name", safeFilename);
                mb.addFormDataPart("filename", safeFilename);
                mb.addFormDataPart("mimeType", mimeType != null ? mimeType : "application/octet-stream");
                mb.addFormDataPart(
                    "file",
                    asciiFilename,
                    RequestBody.create(bytes, mediaType)
                );
                body = mb.build();
            } else {
                MediaType rawType = MediaType.parse("application/octet-stream");
                body = RequestBody.create(bytes, rawType);
            }

            Request.Builder reqBuilder = new Request.Builder()
                .url(parsedUrl)
                .post(body);
            if (origin != null && !origin.isEmpty()) {
                reqBuilder.header("Origin", origin);
            }

            ensureClients();
            if (httpClient == null) {
                call.reject("HTTP client unavailable");
                return;
            }
            OkHttpClient uploadClient = httpClient.newBuilder()
                .writeTimeout(timeoutMs, TimeUnit.MILLISECONDS)
                .readTimeout(timeoutMs, TimeUnit.MILLISECONDS)
                .callTimeout(timeoutMs + 15000L, TimeUnit.MILLISECONDS)
                .build();

            uploadClient.newCall(reqBuilder.build()).enqueue(new Callback() {
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
        } catch (Throwable t) {
            call.reject(t.getMessage() != null ? t.getMessage() : "Upload error");
        }
    }

    /**
     * Executes JSON/text HTTP requests via OkHttp with real timeouts and same-origin headers,
     * bypassing Android WebView CORS/Sec-Fetch-Site and CapacitorHttp AbortSignal quirks.
     */
    @PluginMethod
    public void httpRequest(PluginCall call) {
        try {
            String rawUrl = call.getString("url");
            String method = call.getString("method", "POST");
            String bodyStr = call.getString("body", "");
            String contentType = call.getString("contentType", "application/json; charset=utf-8");
            String origin = call.getString("origin");
            Integer timeoutMsObj = call.getInt("timeoutMs", 30000);
            int timeoutMs = timeoutMsObj != null ? Math.max(5000, Math.min(timeoutMsObj, 180000)) : 30000;
            JSObject headersObj = call.getObject("headers");

            if (rawUrl == null || rawUrl.isEmpty()) {
                call.reject("Missing url");
                return;
            }

            HttpUrl parsedUrl = parseHttpUrl(rawUrl);
            if (parsedUrl == null) {
                call.reject("Invalid HTTP URL (must start with http:// or https://): " + rawUrl);
                return;
            }

            Request.Builder reqBuilder = new Request.Builder().url(parsedUrl);
            if (origin != null && !origin.isEmpty()) {
                reqBuilder.header("Origin", origin);
            }
            if (headersObj != null) {
                java.util.Iterator<String> keys = headersObj.keys();
                while (keys.hasNext()) {
                    String k = keys.next();
                    String v = headersObj.optString(k, null);
                    if (k != null && v != null && !k.isEmpty()) {
                        reqBuilder.header(k, v);
                    }
                }
            }

            String upperMethod = (method != null ? method : "POST").toUpperCase(Locale.ROOT);
            if ("GET".equals(upperMethod) || "HEAD".equals(upperMethod)) {
                reqBuilder.method(upperMethod, null);
            } else {
                MediaType mt = MediaType.parse(contentType != null ? contentType : "application/json; charset=utf-8");
                RequestBody reqBody = RequestBody.create(
                    (bodyStr != null ? bodyStr : "").getBytes(StandardCharsets.UTF_8),
                    mt
                );
                reqBuilder.method(upperMethod, reqBody);
            }

            ensureClients();
            if (httpClient == null) {
                call.reject("HTTP client unavailable");
                return;
            }
            OkHttpClient callClient = httpClient.newBuilder()
                .readTimeout(timeoutMs, TimeUnit.MILLISECONDS)
                .writeTimeout(timeoutMs, TimeUnit.MILLISECONDS)
                .callTimeout(timeoutMs + 10000L, TimeUnit.MILLISECONDS)
                .build();

            callClient.newCall(reqBuilder.build()).enqueue(new Callback() {
                @Override
                public void onFailure(@NonNull Call httpCall, @NonNull IOException e) {
                    call.reject(e.getMessage() != null ? e.getMessage() : "HTTP network error");
                }

                @Override
                public void onResponse(@NonNull Call httpCall, @NonNull Response response) throws IOException {
                    try (Response res = response) {
                        String text = res.body() != null ? res.body().string() : "";
                        JSObject out = new JSObject();
                        out.put("status", res.code());
                        out.put("ok", res.isSuccessful());
                        out.put("body", text);
                        out.put("contentType", res.header("Content-Type", ""));
                        call.resolve(out);
                    }
                }
            });
        } catch (Throwable t) {
            call.reject(t.getMessage() != null ? t.getMessage() : "HTTP request error");
        }
    }

    /**
     * Downloads any remote image or binary file natively via OkHttp (with same-origin header)
     * so cloud-hosted files bypass Android WebView Sec-Fetch-Site / CORS blocks.
     */
    @PluginMethod
    public void downloadBinary(PluginCall call) {
        try {
            String rawUrl = call.getString("url");
            String origin = call.getString("origin");
            Integer timeoutMsObj = call.getInt("timeoutMs", 45000);
            int timeoutMs = timeoutMsObj != null ? Math.max(5000, Math.min(timeoutMsObj, 180000)) : 45000;

            if (rawUrl == null || rawUrl.isEmpty()) {
                call.reject("Missing url");
                return;
            }

            HttpUrl parsedUrl = parseHttpUrl(rawUrl);
            if (parsedUrl == null) {
                call.reject("Invalid download URL (must start with http:// or https://): " + rawUrl);
                return;
            }

            Request.Builder reqBuilder = new Request.Builder().url(parsedUrl).get();
            if (origin != null && !origin.isEmpty()) {
                reqBuilder.header("Origin", origin);
            }

            ensureClients();
            if (httpClient == null) {
                call.reject("HTTP client unavailable");
                return;
            }
            OkHttpClient callClient = httpClient.newBuilder()
                .readTimeout(timeoutMs, TimeUnit.MILLISECONDS)
                .callTimeout(timeoutMs + 10000L, TimeUnit.MILLISECONDS)
                .build();

            callClient.newCall(reqBuilder.build()).enqueue(new Callback() {
                @Override
                public void onFailure(@NonNull Call httpCall, @NonNull IOException e) {
                    call.reject(e.getMessage() != null ? e.getMessage() : "Download network error");
                }

                @Override
                public void onResponse(@NonNull Call httpCall, @NonNull Response response) throws IOException {
                    try (Response res = response) {
                        byte[] rawBytes = res.body() != null ? res.body().bytes() : new byte[0];
                        // Cap single in-memory bridge transfer to 24 MB to protect WebView IPC
                        if (rawBytes.length > 24 * 1024 * 1024) {
                            call.reject("文件超过 24 MB，请通过浏览器直接下载");
                            return;
                        }
                        String mime = res.header("Content-Type", "application/octet-stream");
                        if (mime != null && mime.contains(";")) {
                            mime = mime.substring(0, mime.indexOf(';')).trim();
                        }
                        String disp = res.header("Content-Disposition", "");
                        String parsedName = "";
                        if (disp != null && !disp.isEmpty()) {
                            int fnIdx = disp.indexOf("filename=");
                            if (fnIdx >= 0) {
                                parsedName = disp.substring(fnIdx + 9).replace("\"", "").trim();
                                int semi = parsedName.indexOf(';');
                                if (semi >= 0) parsedName = parsedName.substring(0, semi).trim();
                            }
                        }

                        JSObject out = new JSObject();
                        out.put("status", res.code());
                        out.put("ok", res.isSuccessful());
                        out.put("mimeType", mime != null ? mime : "application/octet-stream");
                        out.put("filename", parsedName);
                        out.put("size", rawBytes.length);
                        out.put("base64Data", res.isSuccessful() ? Base64.encodeToString(rawBytes, Base64.NO_WRAP) : "");
                        call.resolve(out);
                    }
                }
            });
        } catch (Throwable t) {
            call.reject(t.getMessage() != null ? t.getMessage() : "Download error");
        }
    }

    /**
     * Keeps the Android root inset background and system bar icon luminance in sync
     * with light/dark mode on Android 10–16 edge-to-edge windows.
     */
    @PluginMethod
    @SuppressWarnings("deprecation")
    public void setWindowBackground(PluginCall call) {
        try {
            String colorHex = call.getString("color", "#F6F7F9");
            boolean dark = Boolean.TRUE.equals(call.getBoolean("dark", false));
            if (getActivity() == null) {
                call.resolve();
                return;
            }
            getActivity().runOnUiThread(() -> {
                try {
                    int parsed = Color.parseColor(colorHex != null ? colorHex : "#F6F7F9");
                    View contentView = getActivity().findViewById(android.R.id.content);
                    if (contentView != null) {
                        contentView.setBackgroundColor(parsed);
                    }
                    Window window = getActivity().getWindow();
                    if (window != null) {
                        if (Build.VERSION.SDK_INT < 35) {
                            window.setStatusBarColor(parsed);
                            window.setNavigationBarColor(parsed);
                        }
                        View decorView = window.getDecorView();
                        if (decorView != null) {
                            WindowInsetsControllerCompat controller =
                                WindowCompat.getInsetsController(window, decorView);
                            if (controller != null) {
                                controller.setAppearanceLightStatusBars(!dark);
                                controller.setAppearanceLightNavigationBars(!dark);
                            }
                        }
                    }
                } catch (Throwable ignored) {
                    // ignore invalid color or unsupported API
                }
                call.resolve();
            });
        } catch (Throwable ignored) {
            call.resolve();
        }
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
