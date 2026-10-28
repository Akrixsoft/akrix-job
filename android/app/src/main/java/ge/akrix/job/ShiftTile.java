package ge.akrix.job;

import android.content.Intent;
import android.service.quicksettings.Tile;
import android.service.quicksettings.TileService;
import org.json.JSONObject;

/* ===== BLOCK: TILE — плитка «Смена» в быстрых настройках: начать смену / открыть закрытие ===== */
public class ShiftTile extends TileService {
    @Override public void onStartListening() { paint(); }

    void paint() {
        Tile t = getQsTile(); if (t == null) return;
        boolean on = false;
        try { String s = Api.prefs(this).getString("mini", null); if (s != null) on = new JSONObject(s).optBoolean("onShift"); } catch (Exception ignored) {}
        t.setState(Api.key(this).isEmpty() ? Tile.STATE_UNAVAILABLE : on ? Tile.STATE_ACTIVE : Tile.STATE_INACTIVE);
        t.setLabel("Смена");
        if (android.os.Build.VERSION.SDK_INT >= 29) t.setSubtitle(on ? "идёт" : "не начата");
        t.updateTile();
    }

    @Override public void onClick() {
        if (Api.key(this).isEmpty()) return;
        boolean on = getQsTile() != null && getQsTile().getState() == Tile.STATE_ACTIVE;
        if (on) {   // закрытие — в приложении: там итог смены
            Intent i = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("go", "close");
            if (android.os.Build.VERSION.SDK_INT >= 34) startActivityAndCollapse(Shade.open(this, "close")); else startActivityAndCollapse(i);
            return;
        }
        Tile t = getQsTile(); t.setState(Tile.STATE_ACTIVE); t.updateTile();
        final android.content.Context c = getApplicationContext();
        new Thread(() -> {
            try { JSONObject b = new JSONObject(); b.put("geo", ""); Api.call(c, "shiftStart", b); } catch (Exception ignored) {}
            Shade.refresh(c);
        }).start();
    }
}
/* ===== END BLOCK: TILE ===== */
