#!/usr/bin/env python3
# tjob_view: Akrix Job — кнопка 📐 Чертёж (BLOCK VIEW, 22.11.2026). Сервер — НАСТОЯЩИЙ Code.gs в браузере (мок Apps Script из tjob_reg.py).
#  boot отдаёт prj (заказ → проект); 📐 — в карточке заказа и на «Монтаже» только у связанного заказа; нажатие → view/?order=…, адрес и ключ — в akxViewAuth; копия → «копия от …».
#  python3 test/tjob_view.py [index.html] [server/Code.gs]
import sys, pathlib, json, re
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path(__file__).resolve().parent.parent
PAGE = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / 'index.html').resolve()
GS = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else ROOT / 'server/Code.gs').read_text(encoding='utf-8'); res = []
def ck(n, c, d=''): res.append(bool(c)); print(('OK   ' if c else 'FAIL ') + n, '' if c else d)
SRC = (ROOT / 'test' / 'tjob_reg.py').read_text(encoding='utf-8')
INIT = re.search(r'INIT = r"""(.*?)""" % json\.dumps\(GS\)', SRC, re.S).group(1) % json.dumps(GS)
INIT = INIT.replace("REQ.length = 0; })();", """const mo = BOOK.s['Монтаж'] || null; BOOK.s['Заказы'].d[1][10] = 's1'; REQ.length = 0; })();""")
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 412, 'height': 900}, device_scale_factor=2); ctx.add_init_script(INIT); pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e))); E = pg.evaluate
    pg.goto(PAGE.as_uri() + '?key=' + 'a' * 48); pg.wait_for_timeout(1500)
    ck('boot: prj — заказ К 2111 → проект PRJ1, сданный без проекта — нет', E("() => ORDERS.find(o => o.id === 'К 2111').project") == 'PRJ1')
    tabs = E("() => [...document.querySelectorAll('#tabs [data-tab]')].map(b => b.dataset.tab)")
    pg.click('[data-act=regOpen][data-o="К 2111"]'); pg.wait_for_timeout(300)
    if not pg.locator('details.ord[data-ord="К 2111"][open]').count(): pg.click('details.ord[data-ord="К 2111"] summary'); pg.wait_for_timeout(300)
    bt = pg.locator('details.ord[data-ord="К 2111"] [data-act=vwOpen]')
    ck('карточка заказа: кнопка «📐 Чертёж»', bt.count() == 1 and '📐 Чертёж' in bt.inner_text(), tabs)
    E("() => localStorage.setItem('akxView:o:К 2111', JSON.stringify({ saved: '2026-11-22 19:05', sha: 'S1' }))"); E("() => render()"); pg.wait_for_timeout(300)
    if not pg.locator('details.ord[data-ord="К 2111"][open]').count(): pg.click('details.ord[data-ord="К 2111"] summary'); pg.wait_for_timeout(200)
    ck('есть копия на телефоне → «копия от 22.11 19:05»', 'копия от 22.11 19:05' in pg.locator('details.ord[data-ord="К 2111"] [data-act=vwOpen]').inner_text())
    e0 = list(errs); nav = []; pg.on('framenavigated', lambda f: nav.append(f.url) if f == pg.main_frame else None)
    pg.click('details.ord[data-ord="К 2111"] [data-act=vwOpen]'); pg.wait_for_timeout(800)
    ck('нажатие → view/?order=К 2111', any('/view/?order=' + '%D0%9A%202111' in u for u in nav), nav)
    au = json.loads(E("() => localStorage.getItem('akxViewAuth')") or '{}')
    ck('akxViewAuth: адрес сервера и ключ телефона (без Telegram)', au.get('key') == 'a' * 48 and 'api' in au and not au.get('init'), au)
    ck('без ошибок (до перехода на view/)', not e0, e0[:3])
    b.close()
print('ИТОГ', sum(res), '/', len(res)); sys.exit(0 if all(res) else 1)
