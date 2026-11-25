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
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 412, 'height': 900}, device_scale_factor=2); ctx.add_init_script(INIT); pg = ctx.new_page(); errs = []
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
    # TODAY2: выполненная — не в «Задачи в цеху»; «Сделано» — строка со счётчиком, модули по раскрытию; пауза идущей задачи доступна
    E("oi => { const o = ORDERS[oi]; o.tasks = [{ op: 'korpus.dost', self: true }, { op: 'korpus.sbor', self: true }]; S.role = 'emp'; S.tab = 'today'; S.onShift = true; S.tasksOpen = true; S.active = { order: o.id, op: 'korpus.sbor', start: iso(new Date()) + ' ' + hm(nowMin() - 5) }; render(); }", oi); pg.wait_for_timeout(300)
    ck('выполненная доставка ушла из «Задачи в цеху», идущая сборка — на месте', E("() => [...document.querySelectorAll('details.tasks .tn')].map(x => x.textContent)") == ['Сборка'], E("() => [...document.querySelectorAll('details.tasks .tn')].map(x => x.textContent)"))
    ck('пауза у идущей готовой задачи доступна', E("() => { const b = document.querySelector('.tplay.on'); return !!b && !b.disabled; }"))
    ck('секция «Сделано» (без «сегодня»), строка: счётчик 3, модулей в строке нет', E("() => { const s = [...document.querySelectorAll('section.tile h2')].map(h => h.textContent); return s.includes('Сделано') && !s.includes('Сделано сегодня'); }") and E("() => document.querySelector('.dli .dcnt').textContent") == '3' and 'М2' not in E("() => document.querySelector('.dli summary').textContent"))
    pg.click('.dli summary'); pg.wait_for_timeout(200)
    ck('раскрытие: клиент и изделие, «отменить отметку»; ни модулей, ни их количества', 'Костя' in E("() => document.querySelector('.dli .dlb').textContent") and 'мод.' not in E("() => document.querySelector('.dli .dlb').textContent") and 'М2' not in E("() => document.querySelector('.dli .dlb').textContent") and E("() => !!document.querySelector('[data-act=lineUndo]')"))
    ck('строка заказа: «статистика и доли»', E("() => !!document.querySelector('.dlr [data-act=joinOpen]')") and 'статистика и доли' in E("() => document.querySelector('.dlr [data-act=joinOpen]').textContent"))
    E("oi => { PART[ORDERS[oi].id + '|korpus.dost'] = new Set(['s1', 's2']); }", oi); pg.click('.dlr [data-act=joinOpen]'); pg.wait_for_timeout(300)
    t = E("() => (document.querySelector('.dli[open] .dlj .tpop') || {}).textContent || ''")
    ck('нажатие: лист задачи — сумма, время участников, доли; без «Отменить взятое»', '₾' in t and 'время' in t and 'Доли' in t and 'Отменить взятое' not in t, t[:200])
    ck('доли: поля у всех участников, переключатель % / ₾, чипов и ±5 нет', E("() => document.querySelectorAll('.dlj .shin').length") == 2 and E("() => document.querySelectorAll('.dlj .shsw button').length") == 2 and not E("() => document.querySelector('.dlj [data-act=shPreset], .dlj [data-act=shStep]')"))
    F = lambda: E("() => [...document.querySelectorAll('.dlj .shin')].map(x => x.value)")
    A = lambda: E("() => [...document.querySelectorAll('.dlj [data-pamt]')].map(x => x.textContent)")
    pg.locator('.dlj .shin').nth(0).fill('66,67'); pg.wait_for_timeout(100)
    ck('ввод 66,67: сумма участника сверху — сразу 100 ₾, второе поле ещё не прыгает', A()[0] == '100 ₾' and F()[1] == '50', [A(), F()])
    pg.locator('.dlj .shin').nth(0).press('Enter'); pg.wait_for_timeout(1200)
    if not pg.locator('.dlj .shin').count(): E("oi => { PART[ORDERS[oi].id + '|korpus.dost'] = new Set(['s1', 's2']); S.joinOpen = ORDERS[oi].id + '|korpus.dost|d'; render(); }", oi); pg.wait_for_timeout(200)
    ck('Enter → второе забрало остаток 33,33; записано с дробью', E("oi => { const m = SHARE[ORDERS[oi].id + '|korpus.dost']; return m && Math.abs(m.s1 - 66.67) < 0.001 && Math.abs(m.s2 - 33.33) < 0.001; }", oi) and E("() => BOOK.s['Взятые задачи'].d.some(r => r[4] === 'доли s1:66.67,s2:33.33')"), E("() => BOOK.s['Взятые задачи'].d.slice(-2)"))
    E("oi => { PART[ORDERS[oi].id + '|korpus.dost'] = new Set(['s1', 's2']); S.joinOpen = ORDERS[oi].id + '|korpus.dost|d'; render(); }", oi); pg.wait_for_timeout(200)
    pg.locator('.dlj .shsw button[data-v=gel]').click(); pg.wait_for_timeout(200)
    ck('переключатель ₾: поля в лари 100 / 50, подпись «Всего 150 ₾»', F() == ['100', '50'] and 'Всего 150 ₾' in E("() => document.querySelector('.dlj .shbox').textContent"), F())
    pg.locator('.dlj .shin').nth(1).fill('30'); pg.locator('.dlj .shin').nth(1).press('Enter'); pg.wait_for_timeout(1200)
    E("oi => { PART[ORDERS[oi].id + '|korpus.dost'] = new Set(['s1', 's2']); S.joinOpen = ORDERS[oi].id + '|korpus.dost|d'; render(); }", oi); pg.wait_for_timeout(200)
    ck('₾: второму 30 → первый забрал остаток 120 ₾ (80 / 20 %)', F() == ['120', '30'] and E("oi => { const m = SHARE[ORDERS[oi].id + '|korpus.dost']; return Math.abs(m.s1 - 80) < 0.001 && Math.abs(m.s2 - 20) < 0.001; }", oi), F())
    pg.locator('.dlj').screenshot(path='/tmp/t/prev3.png')
    pg.locator('section.tile:has(.dli)').screenshot(path='/tmp/t/prev4.png')
    pg.locator('.dlj .shin').nth(1).fill('200'); pg.locator('.dlj .shin').nth(1).press('Enter'); pg.wait_for_timeout(300)
    ck('больше суммы задачи — поле остатка красное, не записано', E("() => document.querySelector('.dlj .shin.bad') !== null") and E("oi => Math.abs(SHARE[ORDERS[oi].id + '|korpus.dost'].s1 - 80) < 0.001", oi))
    E("() => { S.shMode = 'pct'; localStorage.removeItem('akxShMode'); }")
    E("oi => { PART[ORDERS[oi].id + '|korpus.dost'] = new Set(['s1', 's2']); S.joinOpen = ORDERS[oi].id + '|korpus.dost|d'; render(); }", oi); pg.wait_for_timeout(200)
    names = lambda: E("() => [...document.querySelectorAll('.dlj .tpi .tpn')].map(x => x.textContent.split(' ')[0])")
    ck('участники: только Дмитрий и Гия, Ники нет; ссылка «＋ добавить участника»', names() == ['Дмитрий', 'Гия'] and '＋ добавить участника' in E("() => document.querySelector('.dlj .tpadd').textContent"), names())
    pg.locator('section.tile:has(.dli)').screenshot(path='/tmp/t/prev5.png')
    pg.click('.dlj .tpadd'); pg.wait_for_timeout(200)
    ck('«＋ добавить» → видна Ника, ссылка «скрыть остальных»', 'Ника' in names() and 'скрыть' in E("() => document.querySelector('.dlj .tpadd').textContent"), names())
    ck('порядок: участники → доли → время вручную', E("() => { const t = document.querySelector('.dlj .tpop').innerHTML; return t.indexOf('shbox') < t.indexOf('Время вручную'); }"))
    ck('раскрытый блок не перехватывает прокрутку (overflow visible, overscroll auto)', E("() => { const c = getComputedStyle(document.querySelector('.dlj .tpop')); return c.overflowY === 'visible' && c.overscrollBehaviorY === 'auto'; }"))
    pg.click('.dlr [data-act=joinOpen]'); pg.wait_for_timeout(300)
    ck('«скрыть» закрывает статистику', not E("() => document.querySelector('.dlj')") and 'статистика и доли' in E("() => document.querySelector('.dlr [data-act=joinOpen]').textContent"))
    ck('без ошибок', not errs, errs)
    print('ИТОГ', sum(res), '/', len(res)); b.close()
