package ge.akrix.job;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/* после перезагрузки и обновления — вернуть карточку в шторку */
public class BootReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context c, Intent i) {
        Shade.channel(c); Shade.schedule(c); Shade.refreshAsync(c);
    }
}
