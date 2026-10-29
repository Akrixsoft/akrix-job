package ge.akrix.job;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/* ===== BLOCK: API — запросы к серверу Apps Script (POST → 302 → GET ответа) ===== */
public final class Api {
    public static final String DEF_API = "https://script.google.com/macros/s/AKfycbzBsEFoQZgEeBymc72HM36xPsMtc-0Atob6ePsnacI3SPxcTkZ4MdluzBvpOsqqOhP6/exec";
    public static final String WEB = "https://akrixsoft.github.io/akrix-job/";

    public static SharedPreferences prefs(Context c) { return c.getSharedPreferences("akrix", Context.MODE_PRIVATE); }
    public static String key(Context c) { return prefs(c).getString("key", ""); }
    public static String api(Context c) { return prefs(c).getString("api", DEF_API); }

    /** Серверная ошибка (текст для человека) */
    public static class ApiError extends Exception { public ApiError(String m) { super(m); } }

    public static JSONObject call(Context c, String action, JSONObject body) throws Exception {
        JSONObject b = body == null ? new JSONObject() : body;
        b.put("action", action);
        if (!"pair".equals(action)) b.put("key", key(c));
        String txt = post(api(c), b.toString());
        JSONObject j = new JSONObject(txt);
        if (!j.optBoolean("ok")) throw new ApiError(j.optString("error", "Ошибка сервера"));
        Object d = j.opt("data");
        if (d instanceof JSONObject && ((JSONObject) d).has("error")) throw new ApiError(((JSONObject) d).optString("error"));
        return d instanceof JSONObject ? (JSONObject) d : new JSONObject();
    }

    /** счётчик изменений на сервере (без входа, мгновенно); -1 — нет связи */
    public static long ver(Context c) {
        try { return new JSONObject(post(api(c), "{\"action\":\"ver\"}")).optLong("ver", -1); } catch (Exception e) { return -1; }
    }

    private static String post(String url, String json) throws Exception {
        HttpURLConnection h = (HttpURLConnection) new URL(url).openConnection();
        h.setInstanceFollowRedirects(false);
        h.setConnectTimeout(15000); h.setReadTimeout(30000);
        h.setRequestMethod("POST"); h.setDoOutput(true);
        h.setRequestProperty("Content-Type", "text/plain;charset=utf-8");
        try (OutputStream o = h.getOutputStream()) { o.write(json.getBytes(StandardCharsets.UTF_8)); }
        int code = h.getResponseCode();
        if (code >= 300 && code < 400) {   // Apps Script отдаёт ответ по ссылке редиректа
            String loc = h.getHeaderField("Location"); h.disconnect();
            HttpURLConnection g = (HttpURLConnection) new URL(loc).openConnection();
            g.setConnectTimeout(15000); g.setReadTimeout(30000);
            return read(g.getInputStream());
        }
        return read(code >= 400 ? h.getErrorStream() : h.getInputStream());
    }

    private static String read(InputStream in) throws Exception {
        ByteArrayOutputStream bo = new ByteArrayOutputStream(); byte[] buf = new byte[8192]; int n;
        while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
        in.close(); return bo.toString("UTF-8");
    }
}
/* ===== END BLOCK: API ===== */
