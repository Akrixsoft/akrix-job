#!/usr/bin/env python3
# tshortcut: Akrix Job → Настройки → «📌 Ярлыки на главный экран» (23.11.2026) + Akrix Пульт: #code= → подключение без ввода, 📌 значок, манифест.
#  python3 test/tshortcut.py [index.html] [server/Code.gs]
import sys, pathlib, json, re
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path(__file__).resolve().parent.parent
PAGE = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / 'index.html').resolve()
GS = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else ROOT / 'server/Code.gs').read_text(encoding='utf-8'); res = []
def ck(n, c, d=''): res.append(bool(c)); print(('OK   ' if c else 'FAIL ') + n, '' if c else d)
SRC = (ROOT / 'test' / 'tjob_reg.py').read_text(encoding='utf-8')
INIT = re.search(r'INIT = r"""(.*?)""" % json\.dumps\(GS\)', SRC, re.S).group(1) % json.dumps(GS)
INIT = INIT.replace("REQ.length = 0; })();", """const M0 = window.MOCK_API; window.MOCK_API = b => b.action === 'pairCode' ? (REQ.push(b), { ok: true, data: { code: '482913' } }) : M0(b);
  window.OPENED = []; window.open = (u, t) => { OPENED.push(u); return null; }; REQ.length = 0; })();""")
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 412, 'height': 900}, device_scale_factor=2); ctx.add_init_script(INIT); pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e))); E = pg.evaluate
    for role in ['руководитель', 'сборщик']:
        pg.goto(PAGE.as_uri()); E("r => localStorage.setItem('tRole', r)", role); pg.reload(); pg.wait_for_timeout(1500)
        pg.click('#who [data-act=settings]'); pg.wait_for_timeout(300)
        t = pg.inner_text('#view'); ck(f'{role}: в настройках «📌 Ярлыки на главный экран»', 'Ярлыки на главный экран' in t, t[:200])
    pg.click('text=📌 Ярлыки на главный экран'); pg.wait_for_timeout(200)
    t = pg.inner_text('#view'); ck('раскрыто: Akrix Job (вне Telegram — пояснение), Пульт станка, «Открыть пульт», подсказка про 📌', 'Значок Job добавляется из Telegram' in t and 'пульт станка' in t.lower() and 'Открыть пульт' in t and '📌' in t, t[:400])
    pg.click('[data-act=pultOpen]'); pg.wait_for_timeout(600)
    ck('«Открыть пульт» → код из Job (pairCode) → pult.html#code=482913', E("OPENED") == ['https://akrixsoft.github.io/akrix-job/pult.html#code=482913'] and E("REQ.some(q => q.action === 'pairCode')"), E("OPENED"))
    ck('без ошибок (Job)', not errs, errs[:3])
    # Пульт: #code= → pair без ввода; 📌 по beforeinstallprompt
    PI = """(() => { window.PAIRS = []; const f0 = window.fetch; window.fetch = async (u, o) => { if (!/script\\.google/.test(String(u))) return f0(u, o); const q = JSON.parse(o.body);
      if (q.action === 'pair') { PAIRS.push(q.code); return new Response(JSON.stringify({ ok: true, data: { key: 'k'.repeat(48), name: 'Гия' } })); }
      return new Response(JSON.stringify({ ok: true, data: { me: { id: 's2', name: 'Гия' }, machines: ['stanok'], now: Date.now() } })); }; })()"""
    c2 = b.new_context(viewport={'width': 412, 'height': 900}); c2.add_init_script(PI); q = c2.new_page(); e2 = []; q.on('pageerror', lambda e: e2.append(str(e)))
    q.goto((ROOT / 'pult.html').as_uri() + '#code=482913'); q.wait_for_timeout(1200)
    ck('пульт: код из адреса → подключение без ввода, ключ сохранён, код убран из адреса', q.evaluate("PAIRS") == ['482913'] and q.evaluate("localStorage.getItem('pult_key')") == 'k' * 48 and '#code' not in q.url, [q.evaluate("PAIRS"), q.url])
    ck('после подключения — выбор станка (stanok)', 'stanok' in q.inner_text('#sc'))
    ck('📌 скрыт, пока браузер не предложил установку', q.evaluate("document.getElementById('ins').hidden"))
    q.evaluate("() => { const e = new Event('beforeinstallprompt'); e.prompt = () => { window.PROMPTED = 1; }; e.userChoice = Promise.resolve({ outcome: 'accepted' }); dispatchEvent(e); }"); q.wait_for_timeout(100)
    ck('браузер готов → 📌 в шапке', not q.evaluate("document.getElementById('ins').hidden"))
    q.click('#ins'); q.wait_for_timeout(200); ck('📌 → окно «Добавить на главный экран», кнопка скрыта', q.evaluate("window.PROMPTED === 1 && document.getElementById('ins').hidden"))
    mf = json.loads((ROOT / 'pult.webmanifest').read_text(encoding='utf-8'))
    ck('манифест: Akrix Пульт, standalone, значки 192 / 512 есть', mf['name'] == 'Akrix Пульт' and mf['display'] == 'standalone' and all((ROOT / i['src']).exists() for i in mf['icons']) and q.evaluate("!!document.querySelector('link[rel=manifest]')"))
    ck('без ошибок (пульт)', not e2, e2[:3])
    b.close()
print('ИТОГ', sum(res), '/', len(res)); sys.exit(0 if all(res) else 1)
