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
import android.media.AudioFormat;
import android.media.AudioRecord;
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

import java.io.ByteArrayOutputStream;
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
    private static final int RECORD_SAMPLE_RATE = 16000;
    private static final int MAX_RECORD_SECONDS = 60;

    private SpeechRecognizer recognizer;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private boolean isListening = false;

    private AudioRecord audioRecord;
    private Thread recordThread;
    private ByteArrayOutputStream recordBuffer;
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
                startAudioRecord(call);
            } else {
                startRecognitionInternal(call);
            }
        } else {
            call.reject("未授予麦克风权限，请在系统设置中允许 Relay 使用麦克风");
        }
    }

    /**
     * 自己用 AudioRecord 录 16k 单声道 PCM，绕开系统语音识别服务。
     * 录完由 stopRecording 一次性返回 base64，交给服务器转写。
     */
    @PluginMethod
    public void startRecording(PluginCall call) {
        if (getPermissionState("audio") != PermissionState.GRANTED) {
            pendingAction = "record";
            requestPermissionForAlias("audio", call, "audioPermissionCallback");
            return;
        }
        startAudioRecord(call);
    }

    private void startAudioRecord(PluginCall call) {
        mainHandler.post(() -> {
            try {
                stopRecordingInternal();
                int minBuffer = AudioRecord.getMinBufferSize(
                    RECORD_SAMPLE_RATE,
                    AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT
                );
                int bufferSize = Math.max(minBuffer * 2, RECORD_SAMPLE_RATE);
                audioRecord = createAudioRecord(MediaRecorder.AudioSource.MIC, bufferSize);
                if (audioRecord == null) {
                    audioRecord = createAudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, bufferSize);
                }
                if (audioRecord == null) {
                    call.reject("麦克风初始化失败，可能被其他应用占用");
                    return;
                }
                recordBuffer = new ByteArrayOutputStream(RECORD_SAMPLE_RATE * 2 * 8);
                recordStartedAt = System.currentTimeMillis();
                recording = true;
                audioRecord.startRecording();
                recordThread = new Thread(this::recordLoop, "relay-audio-record");
                recordThread.start();
                JSObject res = new JSObject();
                res.put("started", true);
                res.put("sampleRate", RECORD_SAMPLE_RATE);
                call.resolve(res);
            } catch (Exception e) {
                stopRecordingInternal();
                call.reject("录音启动失败：" + e.getMessage());
            }
        });
    }

    private AudioRecord createAudioRecord(int source, int bufferSize) {
        try {
            AudioRecord record = new AudioRecord(
                source,
                RECORD_SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT,
                bufferSize
            );
            if (record.getState() == AudioRecord.STATE_INITIALIZED) {
                return record;
            }
            record.release();
        } catch (Exception ignored) {
            // try next source
        }
        return null;
    }

    private void recordLoop() {
        byte[] chunk = new byte[3200]; // ~100ms
        int maxBytes = RECORD_SAMPLE_RATE * 2 * MAX_RECORD_SECONDS;
        boolean speechSeen = false;
        long silenceSince = 0L;
        long lastLevelAt = 0L;
        while (recording && audioRecord != null) {
            int read;
            try {
                read = audioRecord.read(chunk, 0, chunk.length);
            } catch (Exception e) {
                break;
            }
            if (read <= 0) continue;
            if (recordBuffer != null) {
                recordBuffer.write(chunk, 0, read);
            }
            long now = System.currentTimeMillis();
            if (now - lastLevelAt >= 120) {
                lastLevelAt = now;
                double rms = rmsOf(chunk, read);
                final double level = Math.min(1.0, rms / 8000.0);
                mainHandler.post(() -> {
                    JSObject payload = new JSObject();
                    payload.put("level", level);
                    notifyListeners("recordLevel", payload);
                });
                if (rms > 700) {
                    speechSeen = true;
                    silenceSince = 0L;
                } else if (speechSeen && silenceSince == 0L) {
                    silenceSince = now;
                }
            }
            if (recordBuffer != null && recordBuffer.size() >= maxBytes) {
                autoStopRecording();
                break;
            }
            if (speechSeen && silenceSince > 0L && now - silenceSince > 1200) {
                autoStopRecording();
                break;
            }
        }
    }

    private double rmsOf(byte[] data, int length) {
        long sum = 0L;
        int count = 0;
        for (int i = 0; i + 1 < length; i += 2) {
            int sample = (short) ((data[i] & 0xff) | (data[i + 1] << 8));
            sum += (long) sample * sample;
            count += 1;
        }
        return Math.sqrt((double) sum / Math.max(1, count));
    }

    private void autoStopRecording() {
        recording = false;
        if (audioRecord != null) {
            try {
                audioRecord.stop();
            } catch (Exception ignored) {
                // ignore
            }
        }
        final long durationMs = System.currentTimeMillis() - recordStartedAt;
        mainHandler.post(() -> {
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
                if (recordThread != null) {
                    try {
                        recordThread.join(1500);
                    } catch (InterruptedException ignored) {
                        // ignore
                    }
                    recordThread = null;
                }
                if (audioRecord != null) {
                    try {
                        audioRecord.stop();
                    } catch (Exception ignored) {
                        // ignore
                    }
                    audioRecord.release();
                    audioRecord = null;
                }
                byte[] data = recordBuffer != null ? recordBuffer.toByteArray() : new byte[0];
                recordBuffer = null;
                if (data.length == 0) {
                    call.reject("没有录到声音，请重试");
                    return;
                }
                JSObject res = new JSObject();
                res.put("audio", Base64.encodeToString(data, Base64.NO_WRAP));
                res.put("sampleRate", RECORD_SAMPLE_RATE);
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
        if (recordThread != null) {
            try {
                recordThread.join(800);
            } catch (InterruptedException ignored) {
                // ignore
            }
            recordThread = null;
        }
        if (audioRecord != null) {
            try {
                audioRecord.stop();
            } catch (Exception ignored) {
                // ignore
            }
            audioRecord.release();
            audioRecord = null;
        }
        recordBuffer = null;
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
