package com.relay.agent;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.ArrayList;

/**
 * Native Android speech-to-text plugin that works inside Capacitor WebView
 * (where browser Web Speech API fails even with RECORD_AUDIO granted).
 * Uses inline SpeechRecognizer with automatic fallback to system RecognizerIntent.
 */
@CapacitorPlugin(
    name = "NativeSpeech",
    permissions = {
        @Permission(alias = "audio", strings = { Manifest.permission.RECORD_AUDIO })
    }
)
public class NativeSpeechPlugin extends Plugin {
    private SpeechRecognizer recognizer;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private boolean isListening = false;

    @PluginMethod
    public void start(PluginCall call) {
        if (getPermissionState("audio") != PermissionState.GRANTED) {
            requestPermissionForAlias("audio", call, "audioPermissionCallback");
            return;
        }
        startRecognitionInternal(call);
    }

    @PermissionCallback
    private void audioPermissionCallback(PluginCall call) {
        if (getPermissionState("audio") == PermissionState.GRANTED) {
            startRecognitionInternal(call);
        } else {
            call.reject("未授予麦克风权限，请在系统设置中允许 Relay 使用麦克风");
        }
    }

    private Intent buildSpeechIntent(String language) {
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, language);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, language);
        intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        intent.putExtra(RecognizerIntent.EXTRA_PROMPT, "请开始说话…");
        return intent;
    }

    private void startRecognitionInternal(PluginCall call) {
        String lang = call.getString("language", "zh-CN");
        Intent intent = buildSpeechIntent(lang != null ? lang : "zh-CN");

        // Prefer system RecognizerIntent dialog if inline SpeechRecognizer isn't available
        boolean inlineAvailable = SpeechRecognizer.isRecognitionAvailable(getContext());
        if (!inlineAvailable) {
            launchActivityRecognizer(call, intent);
            return;
        }

        mainHandler.post(() -> {
            try {
                destroyRecognizerLocked();
                recognizer = SpeechRecognizer.createSpeechRecognizer(getContext());
                recognizer.setRecognitionListener(new RecognitionListener() {
                    @Override
                    public void onReadyForSpeech(Bundle params) {
                        isListening = true;
                        notifyListeners("speechState", new JSObject().put("listening", true));
                    }

                    @Override
                    public void onBeginningOfSpeech() {}

                    @Override
                    public void onRmsChanged(float rmsdB) {}

                    @Override
                    public void onBufferReceived(byte[] buffer) {}

                    @Override
                    public void onEndOfSpeech() {
                        isListening = false;
                        notifyListeners("speechState", new JSObject().put("listening", false));
                    }

                    @Override
                    public void onError(int error) {
                        isListening = false;
                        notifyListeners("speechState", new JSObject().put("listening", false));
                        destroyRecognizerLocked();

                        boolean canFallback =
                            (error == SpeechRecognizer.ERROR_CLIENT
                                || error == SpeechRecognizer.ERROR_SERVER
                                || error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY
                                || error == 12
                                || error == 14)
                            && intent.resolveActivity(getContext().getPackageManager()) != null;

                        String reason = mapSpeechError(error);
                        JSObject errPayload = new JSObject();
                        errPayload.put("message", reason);
                        errPayload.put("code", error);
                        errPayload.put("fallbackAvailable", canFallback);
                        notifyListeners("speechError", errPayload);
                    }

                    @Override
                    public void onResults(Bundle results) {
                        isListening = false;
                        notifyListeners("speechState", new JSObject().put("listening", false));
                        ArrayList<String> matches = results != null
                            ? results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                            : null;
                        if (matches != null && !matches.isEmpty()) {
                            JSObject payload = new JSObject();
                            payload.put("transcript", matches.get(0));
                            payload.put("isFinal", true);
                            notifyListeners("speechResult", payload);
                        }
                        destroyRecognizerLocked();
                    }

                    @Override
                    public void onPartialResults(Bundle partialResults) {
                        ArrayList<String> matches = partialResults != null
                            ? partialResults.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                            : null;
                        if (matches != null && !matches.isEmpty()) {
                            String text = matches.get(0);
                            if (text != null && !text.isEmpty()) {
                                JSObject payload = new JSObject();
                                payload.put("transcript", text);
                                payload.put("isFinal", false);
                                notifyListeners("speechResult", payload);
                            }
                        }
                    }

                    @Override
                    public void onEvent(int eventType, Bundle params) {}
                });

                isListening = true;
                recognizer.startListening(intent);
                JSObject res = new JSObject();
                res.put("mode", "inline");
                call.resolve(res);
            } catch (Exception e) {
                isListening = false;
                destroyRecognizerLocked();
                launchActivityRecognizer(call, intent);
            }
        });
    }

    @PluginMethod
    public void startDialog(PluginCall call) {
        String lang = call.getString("language", "zh-CN");
        Intent intent = buildSpeechIntent(lang != null ? lang : "zh-CN");
        launchActivityRecognizer(call, intent);
    }

    private void launchActivityRecognizer(PluginCall call, Intent intent) {
        if (intent.resolveActivity(getContext().getPackageManager()) == null) {
            call.reject("当前手机未安装系统语音识别服务，请直接使用系统键盘自带的语音输入键");
            return;
        }
        try {
            startActivityForResult(call, intent, "handleSpeechActivityResult");
        } catch (Exception e) {
            call.reject("无法唤起系统语音识别：" + e.getMessage());
        }
    }

    @ActivityCallback
    private void handleSpeechActivityResult(PluginCall call, ActivityResult result) {
        notifyListeners("speechState", new JSObject().put("listening", false));
        if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
            ArrayList<String> matches = result.getData().getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
            if (matches != null && !matches.isEmpty()) {
                String transcript = matches.get(0);
                JSObject payload = new JSObject();
                payload.put("transcript", transcript);
                payload.put("isFinal", true);
                notifyListeners("speechResult", payload);

                JSObject res = new JSObject();
                res.put("mode", "activity");
                res.put("transcript", transcript);
                call.resolve(res);
                return;
            }
        }
        JSObject res = new JSObject();
        res.put("mode", "activity");
        res.put("transcript", "");
        call.resolve(res);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        mainHandler.post(() -> {
            if (recognizer != null && isListening) {
                try {
                    recognizer.stopListening();
                } catch (Exception ignored) {
                    // ignore
                }
            }
            isListening = false;
            notifyListeners("speechState", new JSObject().put("listening", false));
            call.resolve();
        });
    }

    private void destroyRecognizerLocked() {
        if (recognizer != null) {
            try {
                recognizer.cancel();
                recognizer.destroy();
            } catch (Exception ignored) {
                // ignore
            }
            recognizer = null;
        }
    }

    private String mapSpeechError(int code) {
        switch (code) {
            case SpeechRecognizer.ERROR_AUDIO:
                return "音频录制失败，请确认麦克风未被其他应用占用";
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS:
                return "缺少麦克风权限，请在系统设置中允许 Relay 访问麦克风";
            case SpeechRecognizer.ERROR_NETWORK:
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:
                return "系统语音引擎需要联网，请检查网络或改用输入法语音输入";
            case SpeechRecognizer.ERROR_NO_MATCH:
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT:
                return "没有听清说话内容，请靠近麦克风重试";
            default:
                return "系统语音服务暂不可用（错误码 " + code + "），可直接使用手机键盘语音输入";
        }
    }

    @Override
    protected void handleOnDestroy() {
        mainHandler.post(this::destroyRecognizerLocked);
        super.handleOnDestroy();
    }
}
