package io.jev.copilot;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.RadioButton;
import android.widget.RadioGroup;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import com.google.android.gms.tasks.Task;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions;
import java.io.IOException;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;

/** Consent-first share target. OCR runs on-device; all generative work is user-mediated. */
public final class MainActivity extends Activity {
    private EditText conversation;
    private EditText background;
    private TextView state;
    private RadioGroup modes;
    private TextRecognizer ocr;
    private final List<Uri> queued = new ArrayList<>();
    private boolean busy;

    private static final int BG = Color.rgb(247,248,250);
    private static final int INK = Color.rgb(26,35,54);

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        ocr = TextRecognition.getClient(new ChineseTextRecognizerOptions.Builder().build());
        buildUi();
        ingest(getIntent());
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        ingest(intent);
    }

    private int dp(float value) { return (int) (getResources().getDisplayMetrics().density * value + 0.5f); }
    private LinearLayout.LayoutParams lp() {
        return new LinearLayout.LayoutParams(-1, -2);
    }
    private TextView text(String value, int sp) {
        TextView t = new TextView(this);
        t.setText(value);
        t.setTextSize(sp);
        t.setTextColor(INK);
        return t;
    }
    private EditText edit(String hint, int lines) {
        EditText e = new EditText(this);
        e.setHint(hint);
        e.setMinLines(lines);
        e.setTextSize(16);
        e.setTextColor(INK);
        e.setGravity(android.view.Gravity.TOP | android.view.Gravity.START);
        e.setSaveEnabled(false); // Avoid Android view-hierarchy restoration of sensitive messages.
        e.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE |
                android.text.InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        return e;
    }
    private Button button(String label, Runnable action) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setOnClickListener(v -> action.run());
        return b;
    }
    private void add(LinearLayout root, View child) {
        LinearLayout.LayoutParams p = lp();
        p.bottomMargin = dp(12);
        root.addView(child, p);
    }
    private void buildUi() {
        ScrollView outer = new ScrollView(this);
        outer.setFillViewport(true);
        outer.setBackgroundColor(BG);
        LinearLayout root = new LinearLayout(this);
        root.setPadding(dp(18), dp(22), dp(18), dp(34));
        root.setOrientation(LinearLayout.VERTICAL);
        outer.addView(root);
        TextView title = text("Jev Chat · 沟通分析", 23);
        title.setTypeface(null, android.graphics.Typeface.BOLD);
        add(root, title);
        add(root, text("本地 OCR + 自主选择 AI App。分析请求在你主动分享后才交给外部模型；绝不自动发送给聊天对象。", 13));
        modes = new RadioGroup(this);
        modes.setOrientation(RadioGroup.HORIZONTAL);
        RadioButton a = new RadioButton(this); a.setId(View.generateViewId()); a.setText("A · 回复建议");
        RadioButton b = new RadioButton(this); b.setId(View.generateViewId()); b.setText("B · 自我审计");
        modes.addView(a); modes.addView(b);
        a.setChecked(true);
        add(root, modes);
        add(root, text("聊天记录（可复制粘贴或从微信/WhatsApp 分享文字、截图）", 14));
        conversation = edit("请保留双方发言的顺序、原话。OCR 可能无法区分我和对方，请自行核对。", 8);
        add(root, conversation);
        add(root, text("可选背景（例如：朋友 / 我是左侧 / 我希望礼貌拒绝）", 14));
        background = edit("关系、目标、发言人身份；不确定可留空", 2);
        add(root, background);
        state = text("尚未导入；不上传、不保留历史。", 13);
        add(root, state);
        add(root, button("复制分析请求（手动粘贴到 AI App）", this::copyPrompt));
        add(root, button("分享分析请求给 AI App（由你选择目标）", this::sharePrompt));
        add(root, button("清空本次聊天", () -> { conversation.setText(""); background.setText(""); state.setText("已清空界面；系统剪贴板内容不受本应用控制。"); }));
        add(root, text("隐私边界：本应用不请求联网、无障碍或聊天读取权限。把文字分享给其他 AI App 后，适用该服务的隐私政策。无法保证对方 App 能接收附件；截图经本机 OCR 后请核对结果。", 12));
        setContentView(outer);
    }
    private PromptComposer.Mode selectedMode() {
        RadioButton selected = findViewById(modes.getCheckedRadioButtonId());
        return selected != null && selected.getText().toString().startsWith("B")
                ? PromptComposer.Mode.AUDIT : PromptComposer.Mode.REPLY;
    }
    private String prompt() {
        return PromptComposer.compose(selectedMode(), conversation.getText().toString(), background.getText().toString());
    }
    private void copyPrompt() {
        try {
            String request = prompt();
            ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
            clipboard.setPrimaryClip(ClipData.newPlainText("Jev Chat analysis", request));
            state.setText("分析请求已复制到系统剪贴板。请打开你已有的 AI App，粘贴并自行发送。剪贴板由系统管理。");
        } catch (IllegalArgumentException ex) { state.setText(ex.getMessage()); }
    }
    private void sharePrompt() {
        try {
            String request = prompt();
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType("text/plain");
            send.putExtra(Intent.EXTRA_TEXT, request);
            startActivity(Intent.createChooser(send, "选择接收分析请求的 AI App"));
            state.setText("已打开系统分享界面。外部 App 是否支持直接接收文字需在真机验证；你仍须自己决定是否发送。");
        } catch (IllegalArgumentException ex) { state.setText(ex.getMessage()); }
        catch (Exception ex) { state.setText("无法打开分享界面，请改用复制方式。" ); }
    }
    private void ingest(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (!Intent.ACTION_SEND.equals(action) && !Intent.ACTION_SEND_MULTIPLE.equals(action)) return;
        CharSequence message = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        if (message != null && message.length() > 0) append("【分享文本】\n" + message);
        LinkedHashSet<Uri> incoming = new LinkedHashSet<>();
        ClipData clip = intent.getClipData();
        if (clip != null) for (int i = 0; i < clip.getItemCount(); i++) {
            Uri uri = clip.getItemAt(i).getUri(); if (uri != null) incoming.add(uri);
        }
        if (Build.VERSION.SDK_INT >= 33) {
            Uri single = intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class);
            if (single != null) incoming.add(single);
            ArrayList<Uri> multiple = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri.class);
            if (multiple != null) incoming.addAll(multiple);
        } else {
            @SuppressWarnings("deprecation") Uri single = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (single != null) incoming.add(single);
            @SuppressWarnings("deprecation") ArrayList<Uri> multiple = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (multiple != null) incoming.addAll(multiple);
        }
        for (Uri uri : incoming) if ("content".equals(uri.getScheme()) || "file".equals(uri.getScheme())) queued.add(uri);
        if (!busy && !queued.isEmpty()) processNext();
        else if (message != null && incoming.isEmpty()) state.setText("已导入分享文本。请确认是谁发出的每条消息。");
    }
    private void append(String s) {
        String before = conversation.getText().toString();
        if (before.length() > 0) conversation.append("\n\n");
        conversation.append(s);
    }
    private void processNext() {
        if (queued.isEmpty()) { busy = false; state.setText("OCR 已处理完毕，请核对内容、说话人和消息顺序。未联网。"); return; }
        busy = true;
        Uri uri = queued.remove(0);
        state.setText("正在本地识别截图（仅提取文字，不判断聊天双方）…");
        try {
            InputImage image = InputImage.fromFilePath(this, uri);
            Task<Text> job = ocr.process(image);
            job.addOnSuccessListener(result -> {
                String value = result.getText();
                append("【截图 OCR，须核对发言人和顺序】\n" + (value.isBlank() ? "[未识别到文字]" : value));
                processNext();
            }).addOnFailureListener(ex -> {
                append("【截图 OCR 失败】请手动粘贴这张截图中的聊天记录。");
                processNext();
            });
        } catch (IOException | SecurityException e) {
            append("【截图无法读取】请检查分享授权，或手动粘贴聊天记录。");
            processNext();
        }
    }
    @Override protected void onDestroy() {
        if (ocr != null) ocr.close();
        queued.clear();
        super.onDestroy();
    }
}
