package ge.akrix.zamer;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothManager;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;

/* ===== BLOCK: MAIN — Замер с сайта (обновляется сам; без сети — кэш сайта, при первом запуске без сети — копия из APK) + мосты AkrixBT / AkrixApp ===== */
@SuppressLint("MissingPermission")
public class MainActivity extends Activity {
    static final String URL = "https://akrixsoft.github.io/akrix-job/zamer/";
    WebView web; Ble ble; BluetoothAdapter ad;
    boolean pendingBt, offline;

    @SuppressLint("SetJavaScriptEnabled")
    @Override protected void onCreate(Bundle s) {
        super.onCreate(s);
        ad = ((BluetoothManager) getSystemService(BLUETOOTH_SERVICE)).getAdapter();
        web = new WebView(this);
        WebSettings w = web.getSettings();
        w.setJavaScriptEnabled(true); w.setDomStorageEnabled(true); w.setDatabaseEnabled(true);
        w.setMediaPlaybackRequiresUserGesture(false);
        web.addJavascriptInterface(new Bt(), "AkrixBT");
        web.addJavascriptInterface(new App(), "AkrixApp");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());
        ble = ad == null ? null : new Ble(this, ad, new Ble.Out() {
            public void state(String st, String nm) { js("akrixBtState('" + st + "'," + (nm == null ? "null" : q(nm)) + ")"); }
            public void pkt(String hex) { js("akrixBtPkt('" + hex + "')"); }
            public void msg(String t) { js("window.akrixBtMsg&&akrixBtMsg(" + q(t) + ")"); }
        });
        if (s != null) web.restoreState(s); else web.loadUrl(URL);
        setContentView(web);
    }
    @Override protected void onSaveInstanceState(Bundle o) { super.onSaveInstanceState(o); web.saveState(o); }
    @Override protected void onDestroy() { if (ble != null) ble.close(); super.onDestroy(); }
    @Override public void onBackPressed() { if (web.canGoBack()) web.goBack(); else super.onBackPressed(); }

    void js(String code) { runOnUiThread(() -> web.evaluateJavascript(code, null)); }
    static String q(String t) { return "'" + t.replace("\\", "\\\\").replace("'", "\\'").replace("\n", "\\n") + "'"; }

    /* ===== BLOCK: СТРАНИЦА — ссылки наружу, офлайн-копия ===== */
    class Client extends WebViewClient {
        @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
            String u = r.getUrl().toString();
            if (u.startsWith(URL) && !u.endsWith(".pdf")) return false;
            try { startActivity(new Intent(Intent.ACTION_VIEW, r.getUrl())); } catch (ActivityNotFoundException e) { toast("Нечем открыть"); }
            return true;
        }
        @Override public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
            if (!r.isForMainFrame() || offline) return;
            offline = true;   /* нет сети и нет кэша сайта: копия Замера из APK под тем же адресом — данные те же */
            v.loadDataWithBaseURL(URL, asset("zamer.html"), "text/html", "utf-8", URL);
            toast("Нет сети — Замер из приложения");
        }
    }
    String asset(String n) {
        try (InputStream in = getAssets().open(n)) { ByteArrayOutputStream o = new ByteArrayOutputStream(); byte[] b = new byte[16384]; int k; while ((k = in.read(b)) > 0) o.write(b, 0, k); return o.toString("UTF-8"); }
        catch (Exception e) { return "<p>Нет сети</p>"; }
    }

    /* ===== BLOCK: ФАЙЛЫ — 📷 камера (полное разрешение) и 🖼 галерея (несколько) для <input type=file> ===== */
    ValueCallback<Uri[]> fileCb; Uri camUri;
    static final int RQ_FILE = 11, RQ_CAM = 12;
    class Chrome extends WebChromeClient {
        @Override public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
            if (fileCb != null) fileCb.onReceiveValue(null);
            fileCb = cb;
            try {
                if (p.isCaptureEnabled()) {
                    ContentValues cv = new ContentValues();
                    cv.put(MediaStore.Images.Media.DISPLAY_NAME, "zamer_" + System.currentTimeMillis() + ".jpg");
                    cv.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
                    if (Build.VERSION.SDK_INT >= 29) cv.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/Akrix");
                    camUri = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, cv);
                    Intent i = new Intent(MediaStore.ACTION_IMAGE_CAPTURE).putExtra(MediaStore.EXTRA_OUTPUT, camUri);
                    startActivityForResult(i, RQ_CAM);
                } else {
                    Intent i = new Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE).setType("image/*");
                    if (p.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                    startActivityForResult(Intent.createChooser(i, "Кадры"), RQ_FILE);
                }
            } catch (Exception e) { fileCb = null; toast("Не открылось: " + e.getMessage()); return false; }
            return true;
        }
    }
    @Override protected void onActivityResult(int rc, int res, Intent d) {
        if (rc == RQ_BT) { if (pendingBt) { pendingBt = false; if (ad.isEnabled()) ble.scan(); else ble.out.state("off", null); } return; }
        if (fileCb == null) return;
        Uri[] r = null;
        if (rc == RQ_CAM) { if (res == RESULT_OK && camUri != null) r = new Uri[]{camUri}; else if (camUri != null) getContentResolver().delete(camUri, null, null); camUri = null; }
        else if (rc == RQ_FILE && res == RESULT_OK && d != null) {
            ArrayList<Uri> L = new ArrayList<>();
            if (d.getClipData() != null) for (int i = 0; i < d.getClipData().getItemCount(); i++) L.add(d.getClipData().getItemAt(i).getUri());
            else if (d.getData() != null) L.add(d.getData());
            r = L.toArray(new Uri[0]);
        }
        fileCb.onReceiveValue(r); fileCb = null;
    }

    /* ===== BLOCK: МОСТ AkrixBT — дальномер ===== */
    static final int RQ_PERM = 21, RQ_BT = 22;
    String[] perms() { return Build.VERSION.SDK_INT >= 31 ? new String[]{Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT} : new String[]{Manifest.permission.ACCESS_FINE_LOCATION}; }
    boolean hasPerms() { for (String p : perms()) if (checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) return false; return true; }
    void btStart() {
        if (ble == null) { js("akrixBtState('off',null);akrixBtMsg('Bluetooth нет на устройстве')"); return; }
        if (!hasPerms()) { pendingBt = true; requestPermissions(perms(), RQ_PERM); return; }
        if (!ad.isEnabled()) { pendingBt = true; startActivityForResult(new Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE), RQ_BT); return; }
        ble.scan();
    }
    @Override public void onRequestPermissionsResult(int rc, String[] p, int[] r) {
        if (rc == RQ_PERM && pendingBt) { pendingBt = false; if (hasPerms()) btStart(); else { ble.out.state("off", null); ble.out.msg("нет разрешения «Устройства поблизости»"); } }
    }
    class Bt {
        @JavascriptInterface public void connect() { runOnUiThread(MainActivity.this::btStart); }
        @JavascriptInterface public void measure() { runOnUiThread(() -> { if (ble != null) ble.measure(); }); }
        @JavascriptInterface public void disconnect() { runOnUiThread(() -> { if (ble != null) ble.disconnect(); }); }
    }

    /* ===== BLOCK: МОСТ AkrixApp — сохранение файла в «Загрузки/Akrix» + «Поделиться» ===== */
    class App {
        @JavascriptInterface public void save(String fn, String mime, String txt) { runOnUiThread(() -> saveFile(fn, mime, txt)); }
        @JavascriptInterface public String version() { try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; } catch (Exception e) { return ""; } }
    }
    void saveFile(String fn, String mime, String txt) {
        try {
            byte[] b = txt.getBytes(StandardCharsets.UTF_8); Uri u;
            if (Build.VERSION.SDK_INT >= 29) {
                ContentValues cv = new ContentValues();
                cv.put(MediaStore.Downloads.DISPLAY_NAME, fn); cv.put(MediaStore.Downloads.MIME_TYPE, mime);
                cv.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Akrix");
                u = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                try (OutputStream o = getContentResolver().openOutputStream(u)) { o.write(b); }
            } else {
                File f = new File(getExternalFilesDir(null), fn);
                try (OutputStream o = new FileOutputStream(f)) { o.write(b); }
                u = Uri.fromFile(f);
            }
            toast("Сохранено: Загрузки/Akrix/" + fn);
            if (Build.VERSION.SDK_INT >= 29) {
                Intent sh = new Intent(Intent.ACTION_SEND).setType(mime).putExtra(Intent.EXTRA_STREAM, u).putExtra(Intent.EXTRA_TITLE, fn).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                startActivity(Intent.createChooser(sh, fn));
            }
        } catch (Exception e) { toast("Не сохранено: " + e.getMessage()); }
    }
    void toast(String t) { Toast.makeText(this, t, Toast.LENGTH_LONG).show(); }
}
