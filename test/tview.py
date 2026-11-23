#!/usr/bin/env python3
# tview: просмотрщик чертежа Akrix Job (view/index.html, сборка akrix-soft calc/build/view_build.py) — телефон 412 px, касания.
#  Сервер — мок projGet (window.VW_MOCK). Загрузка по заказу, «версия от», тап по модулю → карточка В → Ш → Г, сдвиг / масштаб / поворот 3D без правки проекта,
#  изделия чипами, sha → без повторной загрузки, нет сети → копия на телефоне, цены не видны, выход без «не сохранено».
#  python3 tview.py <akrix-job/view/index.html> <папка проектов akrix-soft/Projects>
import sys, pathlib, json
from playwright.sync_api import sync_playwright
V = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '/home/claude/akrix-job/view/index.html').resolve()
PD = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else '/home/claude/akrix-soft/Projects')
T1 = (PD / 'Тамар_Мепе_05-10-26.json').read_text(encoding='utf-8'); T2 = (PD / 'Тригубов_24-10-26.json').read_text(encoding='utf-8'); res = []
def ck(n, c, d=''): res.append(bool(c)); print(('OK   ' if c else 'FAIL ') + n, '' if c else d)
INIT = """(() => { const D = { 'К 2111': [%s, 'ab12cd', 'S1'], 'Т 2410': [%s, 'tr24', 'T1'] }; window.CALLS = [];
  window.VW_MOCK = async b => { CALLS.push(b); await new Promise(r => setTimeout(r, 150)); if (localStorage.getItem('tOff')) throw new Error('Failed to fetch');
    const x = D[b.order]; if (!x) throw new Error('Заказ не найден: ' + b.order);
    const o = { project: x[1], order: b.order, file: x[1] + '.json', sha: x[2], saved: '2026-11-22 19:05', committed: '2026-11-22 19:06' };
    if (b.sha === x[2]) o.same = true; else o.data = x[0]; return o; }; })()""" % (json.dumps(T1), json.dumps(T2))
def touch(q, typ, pts):
    CDP.send('Input.dispatchTouchEvent', {'type': typ, 'touchPoints': [{'x': x, 'y': y, 'id': i} for i, (x, y) in enumerate(pts)]})
def drag(q, a, b, n=8):
    touch(q, 'touchStart', [a])
    for k in range(1, n + 1): touch(q, 'touchMove', [(a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n)]); q.wait_for_timeout(16)
    touch(q, 'touchEnd', [])
def pinch(q, c, d0, d1, n=8):
    touch(q, 'touchStart', [(c[0] - d0, c[1]), (c[0] + d0, c[1])])
    for k in range(1, n + 1): d = d0 + (d1 - d0) * k / n; touch(q, 'touchMove', [(c[0] - d, c[1]), (c[0] + d, c[1])]); q.wait_for_timeout(16)
    touch(q, 'touchEnd', [])
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 412, 'height': 915}, is_mobile=True, has_touch=True, device_scale_factor=2); ctx.add_init_script(INIT)
    q = ctx.new_page(); er = []; dl = []; CDP = ctx.new_cdp_session(q)
    q.on('pageerror', lambda e: er.append(str(e))); RQ = []; q.on('request', lambda r: r.url.startswith('file:') or r.url.startswith('data:') or r.url.startswith('blob:') or RQ.append(r.method + ' ' + r.url[:90])); q.on('dialog', lambda d: (dl.append(d.message), d.dismiss()))
    q.goto(V.as_uri() + '?order=' + 'К%202111'); q.wait_for_function('() => typeof VW !== "undefined" && VW.st === "ok"', timeout=30000); q.wait_for_timeout(600)
    S = lambda: q.evaluate("() => ({ n: prod().sk.mods.length, mods: JSON.stringify(prod().sk.mods.map(m => [m.x, m.y, m.W, m.H, m.D])), v: Object.assign({}, SK.v), iso: !!SK.iso, a: isoS().a, dirty: !!PRJ.dirty })")
    s0 = S(); bar = q.inner_text('#vwBar')
    ck('загрузка по заказу: проект Тамар Мепе, 24 объекта, «версия от 22.11.26 19:05», один запрос', s0['n'] == 24 and 'Тамар Мепе' in bar and 'версия от 22.11.26 19:05' in bar and q.evaluate('CALLS.length') == 1, [s0['n'], bar])
    g = q.evaluate("() => { const r = $('skc').getBoundingClientRect(), d = $('vwDock').getBoundingClientRect(); return { w: r.width, h: r.height, top: r.top, bot: r.bottom, dock: d.top, dockB: d.bottom, inH: innerHeight } }")
    ck('панель внизу (412 px): холст от верха до панели, панель у нижнего края', g['w'] >= 380 and g['h'] >= 700 and g['top'] < 2 and abs(g['bot'] - g['dock']) < 2 and abs(g['dockB'] - g['inH']) < 2, g)
    z = q.locator('#vwBar [data-vz]').all_inner_texts()
    ck('зоны вида сверху — кнопками в панели (▁ Низ, ▔ Верх), на холсте значков нет', [t.strip() for t in z] == ['▁ Низ', '▔ Верх'] and q.evaluate('SK.zvR.length') == 0, [z, q.evaluate('SK.zvR')])
    q.click('#vwBar [data-vz=d]'); q.wait_for_timeout(200)
    ck('«Низ» → полупрозрачно (◐), повторно → скрыто (✕); геометрия не меняется', q.evaluate("zvSt('d')") == 1 and '◐' in q.inner_text('#vwBar [data-vz=d]') and (q.click('#vwBar [data-vz=d]') or True) and q.evaluate("zvSt('d')") == 0 and S()['mods'] == s0['mods'])
    q.click('#vwBar [data-vz=d]'); q.wait_for_timeout(150)
    ck('третье нажатие — снова видно', q.evaluate("zvSt('d')") == 2)
    vis = q.evaluate("() => [...document.querySelectorAll('body *')].filter(e => e.offsetParent !== null && e.children.length === 0 && /₾|смет|Смет/.test(e.textContent)).map(e => e.textContent.slice(0, 30))")
    ck('цены и сметы не видны', not vis, vis)
    # тап по модулю: центр первого корпуса на главном виде
    c = q.evaluate("() => { const sk = prod().sk, mi = sk.mods.findIndex(m => !m.k), m = sk.mods[mi], r = $('skc').getBoundingClientRect(); return { x: r.left + sx(m.x + mW(m) / 2), y: r.top + sy(m.y + mH(m) / 2), mi } }")
    q.touchscreen.tap(c['x'], c['y']); q.wait_for_timeout(500)
    card = q.inner_text('#vwCard') if q.locator('#vwCard').count() else ''
    ck('тап по модулю → карточка: М3, В 950 → Ш 600 → Г 340, X 470, Y 1500', 'М3' in card and card.index('950') < card.index('600') < card.index('340') and '470' in card and '1500' in card, card)
    ck('карточка модуля — над панелью', q.evaluate("$('vwCard').getBoundingClientRect().bottom <= $('vwDock').getBoundingClientRect().top"))
    ck('тап выделил модуль кодом конструктора (SK.ms)', q.evaluate('SK.ms.length === 1 && SK.ms[0] === %d' % c['mi']))
    s1 = S(); ck('после тапа геометрия проекта не изменена', s1['mods'] == s0['mods'])
    q.click('#vwCard [data-vwx]'); q.wait_for_timeout(200); ck('✕ — карточка закрыта, выделение снято', q.locator('#vwCard').count() == 0 and q.evaluate('SK.ms.length') == 0)
    drag(q, (200, 500), (120, 420)); q.wait_for_timeout(300); s2 = S()
    ck('1 палец — сдвиг чертежа (2D), объекты на месте', abs(s2['v']['ox'] - s1['v']['ox'] + 80) < 3 and abs(s2['v']['oy'] - s1['v']['oy'] + 80) < 3 and s2['mods'] == s0['mods'], [s1['v'], s2['v']])
    pinch(q, (206, 500), 40, 120); q.wait_for_timeout(300); s3 = S()
    ck('2 пальца — масштаб ×3', 2.6 < s3['v']['s'] / s2['v']['s'] < 3.4 and s3['mods'] == s0['mods'], [s2['v']['s'], s3['v']['s']])
    q.click('#vwBar [data-vw="fit"]'); q.wait_for_timeout(300); ck('⤢ — вписать', abs(S()['v']['s'] - s0['v']['s']) < 1e-6)
    q.click('#vwBar [data-vw="3d"]'); q.wait_for_timeout(800); s4 = S()
    ck('3D: вид в изометрии, кнопка → «2D», кнопок зон нет', s4['iso'] and q.inner_text('#vwBar [data-vw="3d"]') == '2D' and q.locator('#vwBar [data-vz]').count() == 0)
    drag(q, (200, 500), (300, 500)); q.wait_for_timeout(400); s5 = S()
    ck('3D: 1 палец — поворот (угол +40°), объекты на месте', s5['a'] is not None and abs(((s5['a'] - (s4['a'] if s4['a'] is not None else 30)) % 360) - 40) < 2 and s5['mods'] == s0['mods'], [s4['a'], s5['a']])
    q.touchscreen.tap(206, 500); q.wait_for_timeout(500)
    ck('3D: тап — без ошибок, проект не изменён', S()['mods'] == s0['mods'] and not er, er)
    q.click('#vwBar [data-vw="3d"]'); q.wait_for_timeout(500); ck('2D — обратно в виды', not S()['iso'])
    q.keyboard.press('Delete'); q.keyboard.press('Control+z'); q.wait_for_timeout(200); ck('клавиши правки не действуют', S()['mods'] == s0['mods'])
    # повторное открытие: копия сразу, sha совпал → данные не передаются
    q.reload(); q.wait_for_function('() => typeof VW !== "undefined" && VW.st === "ok" && !VW.busy', timeout=30000)
    cl = q.evaluate('CALLS'); ck('повторно: запрос с sha копии → «same», проект из копии', cl[-1].get('sha') == 'S1' and S()['n'] == 24, cl)
    ck('выход без вопроса «не сохранено»', not dl, dl)
    # нет сети → копия
    q.evaluate("localStorage.setItem('tOff', '1')"); q.reload(); q.wait_for_function('() => typeof VW !== "undefined" && VW.st === "copy"', timeout=30000)
    bar = q.inner_text('#vwBar'); ck('нет связи → копия на телефоне: чертёж есть, «⚠ нет связи — копия, версия от …»', S()['n'] == 24 and 'нет связи' in bar and '22.11.26 19:05' in bar, bar)
    q.evaluate("localStorage.removeItem('tOff')")
    # заказ с двумя изделиями — чипы
    q.goto(V.as_uri() + '?order=' + 'Т%202410'); q.wait_for_function('() => typeof VW !== "undefined" && VW.st === "ok"', timeout=30000); q.wait_for_timeout(400)
    chips = q.locator('#vwPr button').all_inner_texts(); ck('два изделия — чипы «Кухня», «Прихожая»', chips == ['Кухня', 'Прихожая'], chips)
    n0 = S()['n']; q.click('#vwPr button >> nth=1'); q.wait_for_timeout(500)
    ck('чип «Прихожая» — другое изделие; чипы — в панели над кнопками, холст до панели', q.evaluate('P.active') == 1 and q.evaluate("Math.abs($('skc').getBoundingClientRect().bottom - $('vwDock').getBoundingClientRect().top) < 2 && $('vwPr').getBoundingClientRect().bottom <= $('vwBar').getBoundingClientRect().top + 1"), q.evaluate('P.active'))
    q.goto(V.as_uri() + '?order=' + 'Х%200000'); q.wait_for_function('() => typeof VW !== "undefined" && VW.st === "none"', timeout=30000)
    ck('нет такого заказа и копии — сообщение', 'не найден' in q.inner_text('#vwMsg'))
    # Telegram полноэкранный: сверху кнопки Telegram (46), снизу системная полоса (48) — отступы из Telegram.WebApp
    t2 = ctx.new_page(); t2.add_init_script("window.Telegram = { WebApp: { safeAreaInset: { top: 24, bottom: 48 }, contentSafeAreaInset: { top: 46, bottom: 0 }, ready(){}, disableVerticalSwipes(){ window.DVS = 1; }, onEvent(){} } };")
    t2.goto(V.as_uri() + '?order=' + 'К%202111'); t2.wait_for_function('() => typeof VW !== "undefined" && VW.st === "ok"', timeout=30000); t2.wait_for_timeout(500)
    gg = t2.evaluate("() => { const c = $('skc').getBoundingClientRect(), d = $('vwDock').getBoundingClientRect(), b = $('vwBar').querySelector('.vw-b').getBoundingClientRect(); return { top: c.top, cb: c.bottom, dt: d.top, bb: b.bottom, ih: innerHeight, dvs: !!window.DVS } }")
    ck('Telegram: чертёж ниже кнопок Telegram (70), кнопки панели выше системной полосы (48), свайп-сворачивание выключен', abs(gg['top'] - 70) < 2 and abs(gg['cb'] - gg['dt']) < 2 and gg['ih'] - gg['bb'] >= 48 and gg['dvs'], gg)
    c2 = t2.evaluate("() => { const sk = prod().sk, mi = sk.mods.findIndex(m => !m.k), m = sk.mods[mi], r = $('skc').getBoundingClientRect(); return { x: r.left + sx(m.x + mW(m) / 2), y: r.top + sy(m.y + mH(m) / 2) } }")
    t2.touchscreen.tap(c2['x'], c2['y']); t2.wait_for_timeout(400); t2.screenshot(path='/tmp/tview_tg.png'); t2.close()
    q.screenshot(path='/tmp/tview_last.png')
    ck('сеть: ни одной записи (POST) — только мок сервера Job', not [r for r in RQ if r.startswith('POST')], RQ[:5]); print('   запросы:', RQ[:6])
    ck('без ошибок страницы', not er, er[:3])
    print(f'{sum(res)}/{len(res)}'); sys.exit(0 if all(res) else 1)
