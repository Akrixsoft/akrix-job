package ge.akrix.job;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import org.json.JSONObject;

/* ===== BLOCK: ACTIONS — кнопки в шторке: ▶ задача, ⏸ пауза, начать смену, обновить ===== */
public class ActionReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context ctx, Intent in) {
        final Context c = ctx.getApplicationContext();
        final String act = in.getStringExtra("act");
        final PendingResult pr = goAsync();
        if (act != null && !"refresh".equals(act)) Shade.sending(c);
        new Thread(() -> {
            try {
                if ("workStart".equals(act)) {
                    JSONObject b = new JSONObject(); b.put("order", in.getStringExtra("order")); b.put("op", in.getStringExtra("op")); b.put("plan", 0);
                    Api.call(c, "workStart", b);
                } else if ("workStop".equals(act)) Api.call(c, "workStop", null);
                else if ("shiftStart".equals(act)) { JSONObject b = new JSONObject(); b.put("geo", ""); Api.call(c, "shiftStart", b); }
                Shade.refresh(c);
            } catch (Exception e) { Shade.postCached(c, "⚠ " + e.getMessage()); }
            finally { pr.finish(); }
        }).start();
    }
}
/* ===== END BLOCK: ACTIONS ===== */
