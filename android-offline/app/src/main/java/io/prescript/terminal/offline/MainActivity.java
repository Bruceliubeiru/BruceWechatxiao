package io.prescript.terminal.offline;

import android.app.Activity;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.FileInputStream;
import java.nio.MappedByteBuffer;
import java.nio.channels.FileChannel;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OnnxValue;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtSession;

public final class MainActivity extends Activity {
    private WebView webView;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final OrtEnvironment ortEnv = OrtEnvironment.getEnvironment();
    private OrtSession ortSession;
    private MappedByteBuffer modelBuffer;

    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        webView = new WebView(this);
        setContentView(webView);
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(false);
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowUniversalAccessFromFileURLs(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        webView.setWebViewClient(new WebViewClient());
        webView.addJavascriptInterface(new TerminalBridge(), "TerminalNative");
        webView.loadUrl("file:///android_asset/index.html");
    }

    private synchronized OrtSession session() throws Exception {
        if (ortSession != null) return ortSession;
        android.content.res.AssetFileDescriptor afd = getAssets().openFd("model/model.onnx");
        try (FileInputStream in = new FileInputStream(afd.getFileDescriptor());
             FileChannel channel = in.getChannel()) {
            modelBuffer = channel.map(FileChannel.MapMode.READ_ONLY, afd.getStartOffset(), afd.getDeclaredLength());
        } finally { afd.close(); }
        OrtSession.SessionOptions options = new OrtSession.SessionOptions();
        options.setIntraOpNumThreads(Math.max(1, Math.min(4, Runtime.getRuntime().availableProcessors())));
        ortSession = ortEnv.createSession(modelBuffer, options);
        options.close();
        return ortSession;
    }

    private static long[][] longMatrix(JSONArray rows) throws Exception {
        long[][] out = new long[rows.length()][];
        for (int i = 0; i < rows.length(); i++) {
            JSONArray row = rows.getJSONArray(i);
            out[i] = new long[row.length()];
            for (int j = 0; j < row.length(); j++) out[i][j] = row.getLong(j);
        }
        return out;
    }
    private static boolean[][] boolMatrix(JSONArray rows) throws Exception {
        boolean[][] out = new boolean[rows.length()][];
        for (int i = 0; i < rows.length(); i++) {
            JSONArray row = rows.getJSONArray(i);
            out[i] = new boolean[row.length()];
            for (int j = 0; j < row.length(); j++) out[i][j] = row.getBoolean(j);
        }
        return out;
    }
    private static long[] longVector(JSONArray arr) throws Exception {
        long[] out = new long[arr.length()];
        for (int i = 0; i < arr.length(); i++) out[i] = arr.getLong(i);
        return out;
    }

    private String infer(String raw) throws Exception {
        JSONObject root = new JSONObject(raw);
        JSONObject feed = root.getJSONObject("feed");
        try (
            OnnxTensor inputIds = OnnxTensor.createTensor(ortEnv, longMatrix(feed.getJSONArray("input_ids")));
            OnnxTensor attention = OnnxTensor.createTensor(ortEnv, longMatrix(feed.getJSONArray("attention_mask")));
            OnnxTensor markerPos = OnnxTensor.createTensor(ortEnv, longMatrix(feed.getJSONArray("marker_pos")));
            OnnxTensor markerMask = OnnxTensor.createTensor(ortEnv, boolMatrix(feed.getJSONArray("marker_mask")));
            OnnxTensor qtype = OnnxTensor.createTensor(ortEnv, longVector(feed.getJSONArray("qtype")))
        ) {
            Map<String, OnnxTensor> inputs = new HashMap<>();
            inputs.put("input_ids", inputIds);
            inputs.put("attention_mask", attention);
            inputs.put("marker_pos", markerPos);
            inputs.put("marker_mask", markerMask);
            inputs.put("qtype", qtype);
            try (OrtSession.Result result = session().run(inputs)) {
                OnnxValue value = result.get(0);
                Object rawValue = value.getValue();
                if (!(rawValue instanceof float[][])) throw new IllegalStateException("Unexpected logits type");
                float[][] logits = (float[][]) rawValue;
                JSONArray rows = new JSONArray();
                for (float[] row : logits) {
                    JSONArray values = new JSONArray();
                    for (float v : row) values.put((double) v);
                    rows.put(values);
                }
                return new JSONObject().put("logits", rows).toString();
            }
        }
    }

    private void callback(String id, boolean ok, String payload, boolean json) {
        final String script = ok && json
            ? "window.__nativeResult(" + JSONObject.quote(id) + ",true," + payload + ");"
            : "window.__nativeResult(" + JSONObject.quote(id) + "," + ok + "," + JSONObject.quote(payload) + ");";
        runOnUiThread(() -> webView.evaluateJavascript(script, null));
    }

    private final class TerminalBridge {
        @JavascriptInterface public void invoke(String id, String action, String data) {
            if (!"infer".equals(action)) {
                callback(id, false, "Offline build only supports local inference.", false);
                return;
            }
            executor.submit(() -> {
                try { callback(id, true, infer(data), true); }
                catch (Throwable t) { callback(id, false, t.getClass().getSimpleName() + ": " + String.valueOf(t.getMessage()), false); }
            });
        }
    }

    @Override protected void onDestroy() {
        executor.shutdownNow();
        if (ortSession != null) try { ortSession.close(); } catch (Exception ignored) {}
        webView.destroy();
        super.onDestroy();
    }
}
