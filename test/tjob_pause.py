#!/usr/bin/env python3
# tjob_pause (27.11.2026): ⏸ во время перечитки таблицы — пауза не «сбрасывается» старым снимком boot. Сервер — НАСТОЯЩИЙ Code.gs (мок из tjob_reg.py).
#  python3 test/tjob_pause.py [index.html] [server/Code.gs]
import sys, pathlib, json, re
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path(__file__).resolve().parent.parent
PAGE = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / 'index.html').resolve()
GS = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else ROOT / 'server/Code.gs').read_text(encoding='utf-8'); res = []
def ck(n, c, d=''): res.append(bool(c)); print(('OK   ' if c else 'FAIL ') + n, '' if c else d)
SRC = (ROOT / 'test' / 'tjob_reg.py').read_text(encoding='utf-8')
INIT = re.search(r'INIT = r"""(.*?)""" % json\.dumps\(GS\)', SRC, re.S).group(1) % json.dumps(GS)
INIT = INIT.replace("REQ.length = 0; })();", """const Z = BOOK.s['Заказы']; Z.d[0][12] = 'Корпус, м² · korpus'; Z.d[1][12] = 10;
  BOOK.s['Операции'].d = [['h'], ['м²', 'korpus', 'Корпус', 30, 'sbor', 'Сборка', 50]];
  REQ.length = 0; })();""")
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 412, 'height': 900}); ctx.add_init_script(INIT); pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e))); E = pg.evaluate
    pg.goto(PAGE.as_uri() + '?key=' + 'a' * 48); pg.wait_for_timeout(1500)
    E("() => api('shiftStart', {geo: ''}).then(() => api('workStart', {order: 'К 2111', op: 'korpus.sbor', plan: 0})).then(() => reload())"); pg.wait_for_timeout(1500)
    ck('работа идёт', E("() => !!S.active"), E("() => TIMEJ.filter(t => t.who === ME)"))
    E("() => { reload(); stopWork(); }"); pg.wait_for_timeout(2000)
    open_ = E("() => BOOK.s['Время'] ? BOOK.s['Время'].d.slice(1).filter(r => r[1] && !r[4]).length : -1")
    ck('сервер: пауза записана (нет открытых отрезков)', open_ == 0, open_)
    ck('экран: пауза держится, не вернулась старым снимком', E("() => !S.active"), E("() => S.active"))
    ck('без ошибок страницы', not errs, errs)
    b.close()
print(f'{sum(res)}/{len(res)}'); sys.exit(0 if all(res) else 1)
