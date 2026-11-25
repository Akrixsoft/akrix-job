#!/usr/bin/env python3
# tjob_sync: Akrix Job — SYNC-W (25.11.2026): вся операция одной пачкой markMany; дубль модуля не пишется (сервер) и не считается (экран);
#  пока свои записи в очереди — таблица не перечитывается; старый сервер без markMany — по одной с проверкой дубля. Сервер — НАСТОЯЩИЙ Code.gs (мок из tjob_reg.py).
#  python3 test/tjob_sync.py [index.html] [server/Code.gs]
import sys, pathlib, json, re
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path(__file__).resolve().parent.parent
PAGE = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / 'index.html').resolve()
GS = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else ROOT / 'server/Code.gs').read_text(encoding='utf-8'); res = []
def ck(n, c, d=''): res.append(bool(c)); print(('OK   ' if c else 'FAIL ') + n, '' if c else d)
SRC = (ROOT / 'test' / 'tjob_reg.py').read_text(encoding='utf-8')
INIT = re.search(r'INIT = r"""(.*?)""" % json\.dumps\(GS\)', SRC, re.S).group(1) % json.dumps(GS)
INIT = INIT.replace("REQ.length = 0; })();", """const Z = BOOK.s['Заказы']; Z.d[0][12] = 'Корпус, м² · korpus'; Z.d[1][12] = 10;
  BOOK.s['Операции'].d = [['h'], ['м²', 'korpus', 'Корпус', 30, 'dost', 'Доставка деталей', 50], ['м²', 'korpus', 'Корпус', 30, 'sbor', 'Сборка', 50]];
  BOOK.s['Модули'].d = [['h'], ["'К 2111", 'korpus', 'М1 · 700×500', 2], ["'К 2111", 'korpus', 'М2', 3], ["'К 2111", 'korpus', 'М3', 5]];
  REQ.length = 0; })();""")
MK = "() => BOOK.s['Отметки'].d.slice(1).filter(r => r[11] !== 'да').map(r => r[5] + '|' + r[4])"
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 412, 'height': 900}); ctx.add_init_script(INIT); pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e))); E = pg.evaluate
    pg.goto(PAGE.as_uri() + '?key=' + 'a' * 48); pg.wait_for_timeout(1500)
    oi = E("() => ORDERS.findIndex(o => o.id === 'К 2111')")
    ck('заказ К 2111: корпус, 3 модуля', E("oi => ORDERS[oi].lines[0].units.length", oi) == 3, E("oi => ORDERS[oi].lines.map(l => [l.cat, l.units.length])", oi))
    E("() => { REQ.length = 0; }"); E("oi => tickWhole(oi, 'korpus.dost', true)", oi); pg.wait_for_timeout(800)
    acts = E("() => REQ.map(q => q.action)")
    ck('галка на всю операцию — один запрос markMany (3 модуля), без mark по одному', acts.count('markMany') == 1 and 'mark' not in acts and len(E("() => REQ.find(q => q.action === 'markMany').items")) == 3, acts)
    ck('в таблице 3 отметки', sorted(E(MK)) == ['М1 · 700×500|dost', 'М2|dost', 'М3|dost'], E(MK))
    ck('прогресс 100 %', E("oi => ORDERS[oi].lines[0].prog.dost", oi) == 100)
    # устройство со старыми данными: локально галок нет, ставит заново
    E("oi => { ORDERS[oi].lines[0].units.forEach(u => delete u.done.dost); syncProg(ORDERS[oi].lines[0]); REQ.length = 0; }", oi)
    E("oi => tickWhole(oi, 'korpus.dost', true)", oi); pg.wait_for_timeout(1500)
    ck('устаревшее устройство ставит галку повторно — дубли не записаны (3 отметки)', len(E(MK)) == 3, E(MK))
    ck('…ответ «дубль» → перечитка таблицы после своих записей', 'boot' in E("() => REQ.map(q => q.action)"), E("() => REQ.map(q => q.action)"))
    ck('…после перечитки: «Сделано сегодня» — 3 модуля, 100 %, не 200 %', E("oi => S.todayLines.filter(d => d.o.id === 'К 2111').length", oi) == 3 and E("oi => ORDERS[oi].lines[0].prog.dost", oi) == 100,
       E("() => S.todayLines.map(d => d.units[0])"))
    # дубли, уже лежащие в таблице (до исправления), — не считаются
    E("() => { const s = BOOK.s['Отметки'], r = s.d[1].slice(); r.length = 12; s.d.push(r); }"); E("() => reload()"); pg.wait_for_timeout(800)
    ck('старый дубль в таблице: на экране не удваивается (3 строки, 100 %)', E("oi => S.todayLines.filter(d => d.o.id === 'К 2111').length", oi) == 3 and E("oi => ORDERS[oi].lines[0].prog.dost", oi) == 100)
    # пока свои записи идут — перечитки нет
    E("() => { REQ.length = 0; PEND = 1; reload(); }"); pg.wait_for_timeout(500)
    ck('запись в очереди: reload() откладывается', 'boot' not in E("() => REQ.map(q => q.action)"))
    E("() => apiDone()"); pg.wait_for_timeout(800)
    ck('очередь пуста — перечитка сама', 'boot' in E("() => REQ.map(q => q.action)"))
    # старый сервер (без markMany): по одной, с проверкой дубля (auto) и без смены исполнителя
    E("() => { const M = window.MOCK_API; window.MOCK_API = b => b.action === 'markMany' ? { ok: false, error: 'Нет действия markMany' } : M(b); REQ.length = 0; MANY = true; }")
    E("oi => tickWhole(oi, 'korpus.sbor', true)", oi); pg.wait_for_timeout(1500)
    q = E("() => REQ.filter(q => q.action === 'mark')")
    ck('старый сервер: «Нет действия markMany» → 3 × mark с auto (проверка дубля), исполнитель — я', len(q) == 3 and all(x.get('auto') and not x.get('who') for x in q) and E("() => BOOK.s['Отметки'].d.slice(-3).every(r => r[1] === 's1' && r[4] === 'sbor')"), q)
    ck('без ошибок', not errs, errs)
    print('ИТОГ', sum(res), '/', len(res)); b.close()
