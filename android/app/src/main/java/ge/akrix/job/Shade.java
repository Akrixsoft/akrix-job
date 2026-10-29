package ge.akrix.job;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.drawable.Icon;
import android.os.SystemClock;
import android.service.quicksettings.TileService;
import org.json.JSONArray;
import org.json.JSONObject;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/* ===== BLOCK: SHADE — карточка в шторке: текущая задача с идущим временем и кнопки ===== */
public final class Shade {
    static final String CH = "work";
    static final int ID = 1;
    private static int req = 100;

    static void channel(Context c) {
        NotificationChannel ch = new NotificationChannel(CH, "Работа", NotificationManager.IMPORTANCE_LOW);
        ch.setDescription("Текущая задача и смена"); ch.setShowBadge(false);
        c.getSystemService(NotificationManager.class).createNotificationChannel(ch);
    }

    /** обновить карточку в фоне */
    static void refreshAsync(Context c) { final Context a = c.getApplicationContext(); new Thread(() -> refresh(a)).start(); }

    static void refresh(Context c) { refresh(c, true); }

    /** force=false — сначала дешёвый опрос счётчика: ничего не менялось — карточку не трогаем */
    static void refresh(Context c, boolean force) {
        if (Api.key(c).isEmpty()) { c.getSystemService(NotificationManager.class).cancel(ID); return; }
        if (!force) { long v = Api.ver(c); if (v >= 0 && v == Api.prefs(c).getLong("ver", -2)) { next(c); return; } }
        try {
            long v0 = Api.ver(c);
            JSONObject m = Api.call(c, "mini", null);
            Api.prefs(c).edit().putString("mini", m.toString()).putLong("ver", v0).apply();
            next(c);
            post(c, m, null);
        } catch (Api.ApiError e) {
            if (e.getMessage() != null && e.getMessage().contains("не подключён")) { Api.prefs(c).edit().remove("key").apply(); posted(c, "Телефон отключён", "Открой Akrix Job и введи новый код", new Notification.Action[0]); }
            else postCached(c, "⚠ " + e.getMessage());
        } catch (Exception e) { postCached(c, "нет связи"); }
        try { TileService.requestListeningState(c, new ComponentName(c, ShiftTile.class)); } catch (Exception ignored) {}
    }

    static void postCached(Context c, String note) {
        try { String s = Api.prefs(c).getString("mini", null); if (s != null) post(c, new JSONObject(s), note); } catch (Exception ignored) {}
    }

    /** короткое имя операции для кнопки: последняя часть «клиент · изделие · операция» */
    static String shortOp(String label) { String[] p = label.split(" · "); String s = p[p.length - 1]; return s.length() > 18 ? s.substring(0, 17) + "…" : s; }
    static String head(String label) { int i = label.lastIndexOf(" · "); return i > 0 ? label.substring(0, i) : ""; }

    static void post(Context c, JSONObject m, String note) throws Exception {
        boolean on = m.optBoolean("onShift");
        JSONObject act = m.optJSONObject("active");
        JSONArray tasks = m.optJSONArray("tasks"); if (tasks == null) tasks = new JSONArray();
        Notification.Builder b = new Notification.Builder(c, CH).setSmallIcon(R.drawable.ic_stat).setOngoing(true).setOnlyAlertOnce(true)
                .setColor(0xFFE3AE0B).setCategory(Notification.CATEGORY_STATUS).setContentIntent(open(c, null));
        java.util.List<Notification.Action> A = new java.util.ArrayList<>();
        StringBuilder big = new StringBuilder();
        if (!on) {
            b.setContentTitle("Смена не начата").setContentText(m.optString("name"));
            A.add(action(c, "▶ Начать смену", "shiftStart", null));
            A.add(new Notification.Action.Builder(null, "Открыть", open(c, null)).build());
        } else if (act != null) {
            long st = act.optLong("startMs"), now = System.currentTimeMillis();
            String lbl = act.optString("label");
            b.setContentTitle("🟢 " + shortFull(lbl)).setContentText(head(lbl)).setShowWhen(true).setWhen(st).setUsesChronometer(true);
            if (st > now) { b.setChronometerCountDown(true); b.setSubText("старт в " + new SimpleDateFormat("HH:mm", Locale.US).format(new Date(st))); }
            A.add(action(c, "⏸ Пауза", "workStop", null));
            for (int i = 0; i < tasks.length() && A.size() < 2; i++) { JSONObject t = tasks.getJSONObject(i);
                if (t.optString("order").equals(act.optString("order")) && t.optString("op").equals(act.optString("op"))) continue;
                A.add(action(c, "▶ " + shortOp(t.optString("label")), "workStart", t)); }
            A.add(new Notification.Action.Builder(null, "🏁 Смена", open(c, "close")).build());
        } else {
            b.setContentTitle("На смене · выбери задачу").setContentText(tasks.length() > 0 ? "▶ — начать, время пойдёт в задачу" : "Задач нет — возьми в приложении");
            for (int i = 0; i < tasks.length() && A.size() < 2; i++) { JSONObject t = tasks.getJSONObject(i); A.add(action(c, "▶ " + shortOp(t.optString("label")), "workStart", t)); }
            A.add(new Notification.Action.Builder(null, "🏁 Смена", open(c, "close")).build());
        }
        for (int i = 0; i < tasks.length(); i++) big.append(i > 0 ? "\n" : "").append("• ").append(tasks.getJSONObject(i).optString("label"));
        if (on && big.length() > 0) b.setStyle(new Notification.BigTextStyle().bigText((act != null ? head(act.optString("label")) + "\n\n" : "") + "Мои задачи:\n" + big));
        if (note != null) b.setSubText(note);
        for (Notification.Action a : A) b.addAction(a);
        c.getSystemService(NotificationManager.class).notify(ID, b.build());
    }

    static String shortFull(String label) { String[] p = label.split(" · "); return p[p.length - 1]; }

    static void posted(Context c, String title, String text, Notification.Action[] acts) {
        Notification.Builder b = new Notification.Builder(c, CH).setSmallIcon(R.drawable.ic_stat).setContentTitle(title).setContentText(text)
                .setContentIntent(open(c, null)).setOnlyAlertOnce(true);
        for (Notification.Action a : acts) b.addAction(a);
        c.getSystemService(NotificationManager.class).notify(ID, b.build());
    }

    /** «Отправляю…» сразу после нажатия, до ответа сервера */
    static void sending(Context c) { postCached(c, "отправляю…"); }

    static Notification.Action action(Context c, String title, String act, JSONObject t) {
        Intent i = new Intent(c, ActionReceiver.class).setAction("ge.akrix.job." + act + (req++));
        i.putExtra("act", act);
        if (t != null) { i.putExtra("order", t.optString("order")); i.putExtra("op", t.optString("op")); }
        PendingIntent p = PendingIntent.getBroadcast(c, req, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new Notification.Action.Builder((Icon) null, title, p).build();
    }

    static PendingIntent open(Context c, String go) {
        Intent i = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (go != null) i.putExtra("go", go);
        return PendingIntent.getActivity(c, go == null ? 1 : 2, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    /** на смене — следующая проверка через 3 мин (в режиме сна Android может отложить до ~10 мин) */
    static void next(Context c) {
        boolean on = false; try { String s = Api.prefs(c).getString("mini", null); if (s != null) on = new JSONObject(s).optBoolean("onShift"); } catch (Exception ignored) {}
        Intent i = new Intent(c, ActionReceiver.class).setAction("ge.akrix.job.poll").putExtra("act", "poll");
        PendingIntent p = PendingIntent.getBroadcast(c, 8, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        AlarmManager am = c.getSystemService(AlarmManager.class);
        if (on) am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, SystemClock.elapsedRealtime() + 180000, p); else am.cancel(p);
    }

    /** обновление раз в 15 минут (на случай, если смену меняли в Telegram) */
    static void schedule(Context c) {
        Intent i = new Intent(c, ActionReceiver.class).setAction("ge.akrix.job.tick").putExtra("act", "refresh");
        PendingIntent p = PendingIntent.getBroadcast(c, 9, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        c.getSystemService(AlarmManager.class).setInexactRepeating(AlarmManager.ELAPSED_REALTIME, SystemClock.elapsedRealtime() + 60000, AlarmManager.INTERVAL_FIFTEEN_MINUTES, p);
    }
}
/* ===== END BLOCK: SHADE ===== */
