package ge.akrix.zamer;

import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.Context;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import java.util.UUID;

/* ===== BLOCK: BLE — Bosch GLM (протокол MT, как Akrix v166 / тест 03.11). Поиск → GATT → подписка → синхронизация; пакеты — наружу hex-строкой ===== */
@SuppressLint("MissingPermission")
class Ble {
    interface Out { void state(String st, String name); void pkt(String hex); void msg(String t); }
    static final UUID SVC = UUID.fromString("02a6c0d0-0451-4000-b000-fb3210111989");
    static final UUID CHR = UUID.fromString("02a6c0d1-0451-4000-b000-fb3210111989");
    static final UUID CCC = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");
    static final byte[] SYNC = {(byte) 0xC0, 0x55, 0x02, 0x01, 0x00, 0x1A};
    static final byte[] TRIG = {(byte) 0xC0, 0x56, 0x01, 0x00, 0x1E};

    final Context cx; final BluetoothAdapter ad; final Out out;
    final Handler ui = new Handler(Looper.getMainLooper());
    BluetoothGatt gatt; BluetoothGattCharacteristic ch; BluetoothLeScanner sc; boolean scanning; String name;

    Ble(Context cx, BluetoothAdapter ad, Out out) { this.cx = cx; this.ad = ad; this.out = out; }

    static String hex(byte[] b) { StringBuilder sb = new StringBuilder(); for (byte x : b) sb.append(String.format("%02X ", x)); return sb.toString().trim(); }

    /* --- поиск: первый прибор с сервисом Bosch MT или именем GLM / Bosch --- */
    final ScanCallback scb = new ScanCallback() {
        @Override public void onScanResult(int type, ScanResult r) {
            BluetoothDevice d = r.getDevice(); String n = d.getName();
            boolean svc = r.getScanRecord() != null && r.getScanRecord().getServiceUuids() != null
                    && r.getScanRecord().getServiceUuids().toString().toLowerCase().contains("02a6c0d0");
            if (!svc && (n == null || !(n.startsWith("GLM") || n.startsWith("Bosch")))) return;
            stopScan(); name = n != null ? n : "GLM"; open(d);
        }
        @Override public void onScanFailed(int e) { scanning = false; out.state("off", null); out.msg("поиск не удался (" + e + ")"); }
    };
    void scan() {
        if (scanning || gatt != null) return;
        sc = ad.getBluetoothLeScanner(); if (sc == null) { out.state("off", null); out.msg("сканер Bluetooth недоступен"); return; }
        scanning = true; out.state("wait", null); out.msg("поиск… включи Bluetooth на GLM");
        sc.startScan(null, new ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(), scb);
        ui.postDelayed(() -> { if (scanning) { stopScan(); out.state("off", null); out.msg("прибор не найден за 15 с"); } }, 15000);
    }
    void stopScan() { if (scanning && sc != null) { try { sc.stopScan(scb); } catch (Exception e) { } } scanning = false; }
    void disconnect() { stopScan(); if (gatt != null) gatt.disconnect(); else out.state("off", null); }
    void close() { stopScan(); if (gatt != null) { gatt.close(); gatt = null; } }

    /* --- GATT --- */
    void open(BluetoothDevice d) { if (gatt != null) gatt.close(); gatt = d.connectGatt(cx, false, gcb, BluetoothDevice.TRANSPORT_LE); }
    final BluetoothGattCallback gcb = new BluetoothGattCallback() {
        @Override public void onConnectionStateChange(BluetoothGatt g, int st, int ns) {
            if (ns == BluetoothProfile.STATE_CONNECTED) g.discoverServices();
            else if (ns == BluetoothProfile.STATE_DISCONNECTED) { ch = null; g.close(); if (gatt == g) gatt = null; out.state("off", null); }
        }
        @Override public void onServicesDiscovered(BluetoothGatt g, int st) {
            BluetoothGattService s = g.getService(SVC);
            if (s == null || (ch = s.getCharacteristic(CHR)) == null) { out.msg("это не дальномер Bosch"); g.disconnect(); return; }
            g.setCharacteristicNotification(ch, true);
            BluetoothGattDescriptor dsc = ch.getDescriptor(CCC);
            if (dsc == null) { ready(); return; }
            boolean ind = (ch.getProperties() & BluetoothGattCharacteristic.PROPERTY_INDICATE) != 0;
            dsc.setValue(ind ? BluetoothGattDescriptor.ENABLE_INDICATION_VALUE : BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
            if (!g.writeDescriptor(dsc)) ready();
        }
        @Override public void onDescriptorWrite(BluetoothGatt g, BluetoothGattDescriptor d, int st) { ready(); }
        @SuppressWarnings("deprecation")
        @Override public void onCharacteristicChanged(BluetoothGatt g, BluetoothGattCharacteristic c) { if (Build.VERSION.SDK_INT < 33) pkt(c.getValue()); }
        @Override public void onCharacteristicChanged(BluetoothGatt g, BluetoothGattCharacteristic c, byte[] v) { pkt(v); }
    };
    void ready() { out.state("on", name); ui.postDelayed(() -> write(SYNC), 150); }
    void pkt(byte[] v) { if (v != null) out.pkt(hex(v)); }
    @SuppressWarnings("deprecation")
    void write(byte[] b) {
        if (gatt == null || ch == null) return;
        ch.setWriteType(BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT); ch.setValue(b); gatt.writeCharacteristic(ch);
    }
    void measure() { write(TRIG); }
}
