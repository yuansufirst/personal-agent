package com.relay.agent;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;

/**
 * Native OkHttp WebSocket bridge for DeepSeek Harness (/api/remote.mux).
 * Bypasses Android WebView's cross-origin / Sec-Fetch-Site: cross-site restrictions
 * while routing seamlessly through Android's Tailscale VPN interface.
 */
@CapacitorPlugin(name = "DshSocket")
public class DshSocketPlugin extends Plugin {
    private OkHttpClient client;
    private final Map<String, WebSocket> sockets = new ConcurrentHashMap<>();

    @Override
    public void load() {
        super.load();
        client = new OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .pingInterval(25, TimeUnit.SECONDS)
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

        WebSocket ws = client.newWebSocket(reqBuilder.build(), new WebSocketListener() {
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
