package ge.akrix.bt;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import java.util.UUID;

/* ===== BLOCK: MAIN — WebView со страницей теста (assets/bt.html) + мост AkrixBT ===== */
@SuppressLint("MissingPermission")
public class MainActivity extends Activity {
    static final UUID SVC = UUID.fromString("02a6c0d0-0451-4000-b000-fb3210111989");
    static final UUID CHR = UUID.fromString("02a6c0d1-0451-4000-b000-fb3210111989");
    static final UUID CCC = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");
    static final byte[] SYNC = {(byte) 0xC0, 0x55, 0x02, 0x01, 0x00, 0x1A};
    static final byte[] TRIG = {(byte) 0xC0, 0x56, 0x01, 0x00, 0x1E};

    WebView web;
    final Handler ui = new Handler(Looper.getMainLooper());
    BluetoothAdapter ad;
    BluetoothGatt gatt;
    BluetoothGattCharacteristic ch;
    BluetoothLeScanner sc;
    boolean scanning, pendingConnect;

    @SuppressLint("SetJavaScriptEnabled")
    @Override protected void onCreate(Bundle s) {
        super.onCreate(s);
        ad = ((BluetoothManager) getSystemService(BLUETOOTH_SERVICE)).getAdapter();
        web = new WebView(this);
        WebSettings w = web.getSettings();
        w.setJavaScriptEnabled(true); w.setDomStorageEnabled(true);
        web.addJavascriptInterface(new Bridge(), "AkrixBT");
        web.loadUrl("file:///android_asset/bt.html");
        setContentView(web);
    }

    @Override protected void onDestroy() { stopScan(); if (gatt != null) gatt.close(); super.onDestroy(); }

    /* ===== BLOCK: МОСТ — вызывается страницей ===== */
    class Bridge {
        @JavascriptInterface public void connect() { ui.post(MainActivity.this::startConnect); }
        @JavascriptInterface public void measure() { ui.post(() -> write(TRIG, "замер")); }
        @JavascriptInterface public void disconnect() { ui.post(() -> { stopScan(); if (gatt != null) gatt.disconnect(); else state("off"); }); }
    }

    /* ===== BLOCK: В СТРАНИЦУ ===== */
    void js(String code) { ui.post(() -> web.evaluateJavascript(code, null)); }
    void log(String t) { js("log(" + q(t) + ")"); }
    void state(String s) { js("akrixBtState('" + s + "')"); }
    static String q(String t) { return "'" + t.replace("\\", "\\\\").replace("'", "\\'") + "'"; }
    static String hex(byte[] b) { StringBuilder sb = new StringBuilder(); for (byte x : b) sb.append(String.format("%02X ", x)); return sb.toString().trim(); }

    /* ===== BLOCK: РАЗРЕШЕНИЯ И ВКЛЮЧЕНИЕ BT ===== */
    String[] perms() {
        return Build.VERSION.SDK_INT >= 31 ? new String[]{Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT}
                : new String[]{Manifest.permission.ACCESS_FINE_LOCATION};
    }
    boolean hasPerms() { for (String p : perms()) if (checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) return false; return true; }

    void startConnect() {
        if (ad == null) { log("Bluetooth нет на устройстве"); return; }
        if (!hasPerms()) { pendingConnect = true; log("запрос разрешений…"); requestPermissions(perms(), 1); return; }
        if (!ad.isEnabled()) { pendingConnect = true; log("Bluetooth выключен — включаю…"); startActivityForResult(new Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE), 2); return; }
        scan();
    }
    @Override public void onRequestPermissionsResult(int rc, String[] p, int[] r) {
        if (rc == 1 && pendingConnect) { pendingConnect = false; if (hasPerms()) startConnect(); else log("разрешения не даны"); }
    }
    @Override protected void onActivityResult(int rc, int res, Intent d) {
        if (rc == 2 && pendingConnect) { pendingConnect = false; if (ad.isEnabled()) scan(); else log("Bluetooth не включён"); }
    }

    /* ===== BLOCK: ПОИСК — первый прибор с сервисом Bosch MT или именем GLM / Bosch ===== */
    final ScanCallback scb = new ScanCallback() {
        @Override public void onScanResult(int type, ScanResult r) {
            BluetoothDevice d = r.getDevice(); String n = d.getName();
            boolean svc = r.getScanRecord() != null && r.getScanRecord().getServiceUuids() != null
                    && r.getScanRecord().getServiceUuids().toString().toLowerCase().contains("02a6c0d0");
            if (!svc && (n == null || !(n.startsWith("GLM") || n.startsWith("Bosch")))) return;
            stopScan(); log("найден: " + n + " · " + d.getAddress() + " · " + r.getRssi() + " dBm"); open(d);
        }
        @Override public void onScanFailed(int e) { scanning = false; state("off"); log("поиск не удался, код " + e); }
    };
    void scan() {
        if (scanning) return;
        sc = ad.getBluetoothLeScanner(); if (sc == null) { log("сканер недоступен"); return; }
        scanning = true; state("wait"); log("поиск прибора… (включи GLM, Bluetooth на нём)");
        sc.startScan(null, new ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(), scb);
        ui.postDelayed(() -> { if (scanning) { stopScan(); state("off"); log("прибор не найден за 15 с"); } }, 15000);
    }
    void stopScan() { if (scanning && sc != null) { try { sc.stopScan(scb); } catch (Exception e) { } } scanning = false; }

    /* ===== BLOCK: GATT ===== */
    long tOpen;
    void open(BluetoothDevice d) {
        if (gatt != null) { gatt.close(); gatt = null; }
        tOpen = System.currentTimeMillis();
        gatt = d.connectGatt(this, false, gcb, BluetoothDevice.TRANSPORT_LE);
    }
    final BluetoothGattCallback gcb = new BluetoothGattCallback() {
        @Override public void onConnectionStateChange(BluetoothGatt g, int st, int ns) {
            if (ns == BluetoothProfile.STATE_CONNECTED) { log("GATT подключён · " + (System.currentTimeMillis() - tOpen) + " мс"); g.discoverServices(); }
            else if (ns == BluetoothProfile.STATE_DISCONNECTED) { ch = null; g.close(); if (gatt == g) gatt = null; state("off"); if (st != 0) log("обрыв, статус " + st); }
        }
        @Override public void onServicesDiscovered(BluetoothGatt g, int st) {
            BluetoothGattService s = g.getService(SVC);
            if (s == null || (ch = s.getCharacteristic(CHR)) == null) { log("сервис Bosch MT не найден"); g.disconnect(); return; }
            g.setCharacteristicNotification(ch, true);
            BluetoothGattDescriptor dsc = ch.getDescriptor(CCC);
            if (dsc == null) { log("нет дескриптора 2902"); afterSub(g); return; }
            boolean ind = (ch.getProperties() & BluetoothGattCharacteristic.PROPERTY_INDICATE) != 0;
            dsc.setValue(ind ? BluetoothGattDescriptor.ENABLE_INDICATION_VALUE : BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
            if (!g.writeDescriptor(dsc)) { log("подписка не записана"); afterSub(g); }
        }
        @Override public void onDescriptorWrite(BluetoothGatt g, BluetoothGattDescriptor d, int st) { log("уведомления включены" + (st != 0 ? " (статус " + st + ")" : "")); afterSub(g); }
        @SuppressWarnings("deprecation")
        @Override public void onCharacteristicChanged(BluetoothGatt g, BluetoothGattCharacteristic c) { if (Build.VERSION.SDK_INT < 33) pkt(c.getValue()); }
        @Override public void onCharacteristicChanged(BluetoothGatt g, BluetoothGattCharacteristic c, byte[] v) { pkt(v); }
    };
    void afterSub(BluetoothGatt g) {
        ui.post(() -> { state("on"); js("BT.dev={name:" + q(String.valueOf(g.getDevice().getName())) + ",gatt:{disconnect:()=>AkrixBT.disconnect()}};stUi()"); });
        ui.postDelayed(() -> write(SYNC, "синхронизация"), 150);
    }
    void pkt(byte[] v) { if (v == null) return; String h = hex(v); js("akrixBtPkt('" + h + "')"); }
    @SuppressWarnings("deprecation")
    void write(byte[] b, String what) {
        if (gatt == null || ch == null) { log("не подключён"); return; }
        ch.setWriteType(BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT); ch.setValue(b);
        boolean ok = gatt.writeCharacteristic(ch);
        log("→ " + hex(b) + " (" + what + ")" + (ok ? "" : " — не отправлено"));
    }
}
