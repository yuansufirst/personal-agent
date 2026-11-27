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
import android.media.MediaRecorder;
import android.util.Base64;

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

import java.io.File;
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
    private static final int MAX_RECORD_SECONDS = 60;

    private MediaRecorder mediaRecorder;
    private File recordFile;
    private boolean mediaRecorderStopped = false;
    private Handler amplitudeHandler;
    private Runnable amplitudeTask;
    private volatile boolean recording = false;
    private long recordStartedAt = 0L;
    private String pendingAction = null;

    @PluginMethod
    public void start(PluginCall call) {
        if (getPermissionState("audio") != PermissionState.GRANTED) {
            pendingAction = "speech";
            requestPermissionForAlias("audio", call, "audioPermissionCallback");
            return;
        }
        startRecognitionInternal(call);
    }

    @PermissionCallback
    private void audioPermissionCallback(PluginCall call) {
        String action = pendingAction;
        pendingAction = null;
        if (getPermissionState("audio") == PermissionState.GRANTED) {
            if ("record".equals(action)) {
                startAacRecording(call);
            } else {
                startRecognitionInternal(call);
            }
        } else {
            call.reject("未授予麦克风权限，请在系统设置中允许 Relay 使用麦克风");
        }
    }

    /**
     * 自己用 MediaRecorder 录 AAC（24kbps，约 3KB/s），走服务器转写。
     * 系统 SpeechRecognizer 在部分 ROM 上会拒绝，且 PCM 原样上传太慢，
     * AAC 能把体积压到 1/8 左右。
     */
    @PluginMethod
    public void startRecording(PluginCall call) {
        if (getPermissionState("audio") != PermissionState.GRANTED) {
            pendingAction = "record";
            requestPermissionForAlias("audio", call, "audioPermissionCallback");
            return;
        }
        startAacRecording(call);
    }

    private void startAacRecording(PluginCall call) {
        mainHandler.post(() -> {
            try {
                stopRecordingInternal();
                File dir = getContext().getCacheDir();
                recordFile = new File(dir, "relay-voice-" + System.currentTimeMillis() + ".m4a");
                mediaRecorder = new MediaRecorder();
                mediaRecorder.setAudioSource(MediaRecorder.AudioSource.MIC);
                mediaRecorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
                mediaRecorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
                mediaRecorder.setAudioChannels(1);
                mediaRecorder.setAudioEncodingBitRate(24000);
                try {
                    mediaRecorder.setAudioSamplingRate(16000);
                } catch (Exception ignored) {
                    mediaRecorder.setAudioSamplingRate(44100);
                }
                mediaRecorder.setOutputFile(recordFile.getAbsolutePath());
                mediaRecorder.prepare();
                mediaRecorder.start();
                mediaRecorderStopped = false;
                recording = true;
                recordStartedAt = System.currentTimeMillis();
                startAmplitudePolling();
                JSObject res = new JSObject();
                res.put("started", true);
                res.put("format", "aac");
                call.resolve(res);
            } catch (Exception e) {
                stopRecordingInternal();
                call.reject("录音启动失败：" + e.getMessage());
            }
        });
    }

    private void startAmplitudePolling() {
        stopAmplitudePolling();
        amplitudeHandler = new Handler(Looper.getMainLooper());
        final long startedAt = System.currentTimeMillis();
        final boolean[] speechSeen = { false };
        final long[] silenceSince = { 0L };
        amplitudeTask = new Runnable() {
            @Override
            public void run() {
                if (!recording || mediaRecorder == null) return;
                int amplitude = 0;
                try {
                    amplitude = mediaRecorder.getMaxAmplitude();
                } catch (Exception ignored) {
                    // ignore
                }
                long now = System.currentTimeMillis();
                JSObject payload = new JSObject();
                payload.put("level", Math.min(1.0, amplitude / 12000.0));
                notifyListeners("recordLevel", payload);
                if (amplitude > 2500) {
                    speechSeen[0] = true;
                    silenceSince[0] = 0L;
                } else if (speechSeen[0] && silenceSince[0] == 0L) {
                    silenceSince[0] = now;
                }
                boolean tooLong = now - startedAt > MAX_RECORD_SECONDS * 1000L;
                boolean silentEnd = speechSeen[0]
                    && now - startedAt > 1500L
                    && silenceSince[0] > 0L
                    && now - silenceSince[0] > 1500L;
                if (tooLong || silentEnd) {
                    autoStopRecording();
                    return;
                }
                amplitudeHandler.postDelayed(this, 120);
            }
        };
        amplitudeHandler.postDelayed(amplitudeTask, 150);
    }

    private void stopAmplitudePolling() {
        if (amplitudeHandler != null && amplitudeTask != null) {
            amplitudeHandler.removeCallbacks(amplitudeTask);
        }
        amplitudeTask = null;
        amplitudeHandler = null;
    }

    private void autoStopRecording() {
        final long durationMs = System.currentTimeMillis() - recordStartedAt;
        mainHandler.post(() -> {
            try {
                if (mediaRecorder != null && !mediaRecorderStopped) {
                    mediaRecorder.stop();
                    mediaRecorderStopped = true;
                }
            } catch (Exception ignored) {
                // 录音太短时 stop 会抛异常，忽略
            }
            recording = false;
            stopAmplitudePolling();
            JSObject payload = new JSObject();
            payload.put("durationMs", durationMs);
            notifyListeners("recordAutoStop", payload);
        });
    }

    @PluginMethod
    public void stopRecording(PluginCall call) {
        mainHandler.post(() -> {
            try {
                recording = false;
                stopAmplitudePolling();
                if (mediaRecorder != null) {
                    if (!mediaRecorderStopped) {
                        try {
                            mediaRecorder.stop();
                        } catch (Exception ignored) {
                            // ignore
                        }
                    }
                    try {
                        mediaRecorder.release();
                    } catch (Exception ignored) {
                        // ignore
                    }
                    mediaRecorder = null;
                    mediaRecorderStopped = false;
                }
                File file = recordFile;
                recordFile = null;
                byte[] data = new byte[0];
                if (file != null && file.exists()) {
                    try (java.io.FileInputStream in = new java.io.FileInputStream(file)) {
                        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream((int) file.length());
                        byte[] buffer = new byte[8192];
                        int read;
                        while ((read = in.read(buffer)) > 0) {
                            out.write(buffer, 0, read);
                        }
                        data = out.toByteArray();
                    } catch (Exception ignored) {
                        // ignore
                    }
                    //noinspection ResultOfMethodCallIgnored
                    file.delete();
                }
                if (data.length == 0) {
                    call.reject("没有录到声音，请重试");
                    return;
                }
                JSObject res = new JSObject();
                res.put("audio", Base64.encodeToString(data, Base64.NO_WRAP));
                res.put("format", "aac");
                res.put("durationMs", System.currentTimeMillis() - recordStartedAt);
                call.resolve(res);
            } catch (Exception e) {
                stopRecordingInternal();
                call.reject("录音停止失败：" + e.getMessage());
            }
        });
    }

    private void stopRecordingInternal() {
        recording = false;
        stopAmplitudePolling();
        if (mediaRecorder != null) {
            try {
                if (!mediaRecorderStopped) {
                    mediaRecorder.stop();
                }
            } catch (Exception ignored) {
                // ignore
            }
            try {
                mediaRecorder.release();
            } catch (Exception ignored) {
                // ignore
            }
            mediaRecorder = null;
        }
        mediaRecorderStopped = false;
        if (recordFile != null) {
            //noinspection ResultOfMethodCallIgnored
            recordFile.delete();
            recordFile = null;
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
