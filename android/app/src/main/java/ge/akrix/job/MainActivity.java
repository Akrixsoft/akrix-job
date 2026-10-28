package ge.akrix.job;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import org.json.JSONObject;

/* ===== BLOCK: MAIN — вход по коду, дальше то же приложение Akrix Job внутри ===== */
public class MainActivity extends Activity {
    WebView web;
    long lastChange = 0;

    @Override protected void onCreate(Bundle s) {
        super.onCreate(s);
        Shade.channel(this); Shade.schedule(this);
        if (Api.key(this).isEmpty()) showPair(); else showWeb(getIntent().getStringExtra("go"));
    }

    @Override protected void onNewIntent(Intent i) {
        super.onNewIntent(i); setIntent(i);
        String go = i.getStringExtra("go");
        if (Api.key(this).isEmpty()) showPair(); else if (web == null || go != null) showWeb(go);
    }

    @Override protected void onPause() { super.onPause(); Shade.refreshAsync(this); }

    @Override public void onBackPressed() { if (web != null && web.canGoBack()) web.goBack(); else super.onBackPressed(); }

    /* --- вход: код из Telegram (Akrix Job → «📱 Android-приложение» → «Получить код») --- */
    void showPair() {
        web = null;
        LinearLayout l = new LinearLayout(this); l.setOrientation(LinearLayout.VERTICAL); l.setPadding(dp(24), dp(64), dp(24), dp(24)); l.setBackgroundColor(0xFFEEF0F3);
        TextView h = new TextView(this); h.setText("Akrix Job"); h.setTextSize(28); h.setTypeface(Typeface.DEFAULT_BOLD); h.setTextColor(0xFF15181D); l.addView(h);
        TextView t = new TextView(this); t.setTextSize(16); t.setTextColor(0xFF4A505A); t.setPadding(0, dp(12), 0, dp(20));
        t.setText("Открой Akrix Job в Telegram → внизу «📱 Android-приложение» → «Получить код». Введи 6 цифр:"); l.addView(t);
        EditText e = new EditText(this); e.setInputType(InputType.TYPE_CLASS_NUMBER); e.setTextSize(30); e.setGravity(Gravity.CENTER); e.setHint("000000");
        e.setLetterSpacing(0.3f); e.setBackgroundColor(Color.WHITE); e.setPadding(dp(12), dp(14), dp(12), dp(14)); l.addView(e, new LinearLayout.LayoutParams(-1, -2));
        Button b = new Button(this); b.setText("Подключить"); b.setTextSize(17); b.setAllCaps(false); b.setBackgroundColor(0xFFE3AE0B); b.setTextColor(0xFF1A1400);
        LinearLayout.LayoutParams bp = new LinearLayout.LayoutParams(-1, dp(56)); bp.topMargin = dp(16); l.addView(b, bp);
        b.setOnClickListener(v -> {
            String code = e.getText().toString().replaceAll("\\D", "");
            if (code.length() != 6) { Toast.makeText(this, "Нужно 6 цифр", Toast.LENGTH_SHORT).show(); return; }
            b.setEnabled(false); b.setText("Проверяю…");
            new Thread(() -> {
                try {
                    JSONObject q = new JSONObject(); q.put("code", code);
                    JSONObject r = Api.call(this, "pair", q);
                    Api.prefs(this).edit().putString("key", r.getString("key")).putString("name", r.optString("name")).apply();
                    runOnUiThread(() -> { Toast.makeText(this, "Готово, " + r.optString("name"), Toast.LENGTH_SHORT).show(); askNotify(); showWeb(null); Shade.refreshAsync(this); });
                } catch (Exception x) {
                    runOnUiThread(() -> { b.setEnabled(true); b.setText("Подключить"); Toast.makeText(this, x.getMessage() != null ? x.getMessage() : "Нет связи", Toast.LENGTH_LONG).show(); });
                }
            }).start();
        });
        setContentView(l);
    }

    void askNotify() {
        if (android.os.Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1);
    }

    @Override public void onRequestPermissionsResult(int r, String[] p, int[] g) { Shade.refreshAsync(this); }

    /* --- само приложение: веб-версия Akrix Job, вход по ключу телефона --- */
    void showWeb(String go) {
        askNotify();
        if (web == null) {
            web = new WebView(this);
            WebSettings ws = web.getSettings(); ws.setJavaScriptEnabled(true); ws.setDomStorageEnabled(true);
            web.addJavascriptInterface(new Bridge(), "AkrixAndroid");
            web.setWebViewClient(new WebViewClient() {
                @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                    Uri u = r.getUrl();
                    if ("akrixsoft.github.io".equals(u.getHost())) return false;
                    try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) {}
                    return true;
                }
            });
            setContentView(web, new ViewGroup.LayoutParams(-1, -1));
        }
        Uri.Builder u = Uri.parse(Api.WEB).buildUpon().appendQueryParameter("api", Api.api(this)).appendQueryParameter("key", Api.key(this));
        if (go != null) u.appendQueryParameter("go", go);
        web.loadUrl(u.build().toString());
    }

    class Bridge {
        /** веб-приложение что-то записало — обновить шторку (не чаще раза в 2 с) */
        @JavascriptInterface public void changed() {
            long n = System.currentTimeMillis(); if (n - lastChange < 2000) return; lastChange = n;
            web.postDelayed(() -> Shade.refreshAsync(MainActivity.this), 800);
        }
    }

    int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }
}
/* ===== END BLOCK: MAIN ===== */
