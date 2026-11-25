#!/usr/bin/env python3
# tjob_cnc: мини-приложение Akrix Job — экран «Станок» (руководитель / администратор). Сервер — НАСТОЯЩИЙ Code.gs в браузере (мок Apps Script, window.MOCK_API); события пишутся через cncLog.
#  python3 test/tjob_cnc.py [index.html] [server/Code.gs]
import sys, pathlib, json
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path(__file__).resolve().parent.parent
PAGE = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / 'index.html').resolve()
GS = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else ROOT / 'server/Code.gs').read_text(encoding='utf-8'); res = []
def ck(n, c, d=''): res.append(bool(c)); print(('OK   ' if c else 'FAIL ') + n, '' if c else d)
INIT = r"""(() => { try { const d = new Date(Date.now() - 6 * 3600e3); localStorage.setItem('akrixSplash', d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')); } catch (e) {}
  const GS = %s, ROLE = localStorage.getItem('tRole') || 'руководитель';
  function Sheet(name){ this.name = name; this.d = []; }
  Sheet.prototype = { appendRow(r){ this.d.push(r.slice()); }, setFrozenRows(){}, getLastRow(){ return this.d.length; }, getLastColumn(){ return Math.max(0, ...this.d.map(r => r.length)); },
    getRange(r, c, nr = 1, nc = 1){ const s = this; return {
      getValues(){ const o = []; for (let i = 0; i < nr; i++){ const row = []; for (let j = 0; j < nc; j++){ const v = (s.d[r - 1 + i] || [])[c - 1 + j] ?? ''; row.push(typeof v === 'string' ? v.replace(/^'/, '') : v); } o.push(row); } return o; },
      getDisplayValues(){ return this.getValues().map(x => x.map(v => String(v).replace(/^'/, ''))); },
      setValue(v){ (s.d[r - 1] = s.d[r - 1] || [])[c - 1] = v; }, setValues(V){ V.forEach((row, i) => row.forEach((v, j) => { (s.d[r - 1 + i] = s.d[r - 1 + i] || [])[c - 1 + j] = v; })); },
      setNumberFormat(){ return this; }, setFontWeight(){ return this; }, setBackground(){ return this; } }; } };
  const BOOK = { s: {}, getSheetByName(n){ return this.s[n] || null; }, insertSheet(n){ return this.s[n] = new Sheet(n); } }, props = {};
  const env = { SpreadsheetApp: { getActiveSpreadsheet: () => BOOK }, PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] ?? null, setProperty: (k, v) => { props[k] = v; }, deleteProperty: k => { delete props[k]; } }) },
    LockService: { getScriptLock: () => ({ waitLock(){}, releaseLock(){} }) }, ContentService: { createTextOutput: t => ({ t, setMimeType(){ return this; } }), MimeType: { JSON: 1 } }, HtmlService: { createHtmlOutput: t => t },
    Utilities: { formatDate: (d, tz, f) => { const z = n => String(n).padStart(2, '0'); return f.replace('yyyy', d.getFullYear()).replace('yy', String(d.getFullYear()).slice(2)).replace('MM', z(d.getMonth() + 1)).replace('dd', z(d.getDate())).replace('HH', z(d.getHours())).replace('mm', z(d.getMinutes())).replace('ss', z(d.getSeconds())); },
      getUuid: () => 'x', computeHmacSha256Signature: () => [], newBlob: () => ({ getBytes: () => [] }) }, ScriptApp: { getProjectTriggers: () => [] }, Logger: { log(){} }, UrlFetchApp: {} };
  const S = new Function(...Object.keys(env), GS + '\n;return { doPost, SH };')(...Object.values(env));
  Object.values(S.SH).forEach(n => { if (!BOOK.s[n]) BOOK.insertSheet(n).appendRow(['h']); });
  const st = BOOK.s['Сотрудники']; st.d = [['id', 'имя', 'tg', 'tgid', 'роль', '', 'доступ'], ['s1', 'Дмитрий', '', '', ROLE, '', 'да'], ['s2', 'Гия', '', '', 'сборщик', '', 'да'], ['s3', 'Ника', '', '', 'сборщик', '', 'да']];
  const KB = 'a'.repeat(48); props['AK_' + KB] = 's1';
  window.REQ = []; window.BOOK = BOOK;
  window.MOCK_API = b => { REQ.push(b); return JSON.parse(S.doPost({ postData: { contents: JSON.stringify(Object.assign({ key: KB }, b)) }, parameter: {} }).t); };
  const iso = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const ev = []; let i = 0; const P = (dd, op, opName, kind, setup, run, set, plan, o) => ev.push(Object.assign({ eid: 'e' + (i++), t: 'part', pc: 'stanok', op, opName, ts0: iso(dd) + ' 10:' + String(i %% 60).padStart(2, '0') + ':00', order: 'К 2111', project: 'PRJ1', partName: 'Деталь ' + i, kind, setup, runSec: run, setupSec: set, planSec: plan, m0: 1, holes: 10, L: 700, W: 500, source: 'auto' }, o || {}));
  for (let k = 0; k < 4; k++){ P(0, 's2', 'Гия', 'drill', 'normal', 100, 20, 120); P(1, 's3', 'Ника', 'drill', 'normal', 160, 40, 120); }
  P(2, 's2', 'Гия', 'mill', 'flip', 300, 60, 330, { millMm: 3000, holes: 0, order: 'Н 1411', pc: 'shop' }); P(0, 's3', 'Ника', 'drill', 'normal', 900, 100, 120, { source: 'manual', partName: 'Долгая деталь' });
  ev.push({ eid: 'r1', t: 'run', pc: 'stanok', op: 's2', ts0: iso(0) + ' 09:00:00', runSec: 3600, idleSec: 600, planSec: 3000, partName: 'Программа А', result: 'done', order: 'К 2111' });
  ev.push({ eid: 'r2', t: 'run', pc: 'stanok', op: 's3', ts0: iso(1) + ' 09:00:00', runSec: 1800, idleSec: 300, planSec: 2000, partName: 'Программа Б', result: 'done', order: 'К 2111' });
  ev.push({ eid: 'r3', t: 'run', pc: 'stanok', op: 's3', ts0: iso(0) + ' 14:00:00', partName: 'Боковины кухни', order: 'К 2111' });
  ev.push({ eid: 'u1', t: 'setup', pc: 'stanok', op: 's2', ts0: iso(0) + ' 09:30:00', setupSec: 30 }, { eid: 'u2', t: 'setup', pc: 'stanok', op: 's3', ts0: iso(1) + ' 09:30:00', setupSec: 90 });
  ev.push({ eid: 'f1', t: 'fault', pc: 'stanok', op: 's3', ts0: iso(1) + ' 11:00:00', result: 'alarm' });
  ev.push({ eid: 'sh1', t: 'shift', pc: 'stanok', op: 's2', opName: 'Гия', ts0: iso(0) + ' 08:00:00' }, { eid: 'sh2', t: 'shift', pc: 'stanok', op: 's3', opName: 'Ника', ts0: iso(0) + ' 13:00:00' });
  ev.push({ eid: 'm1', t: 'manual', pc: 'stanok', op: 's2', ts0: iso(0) + ' 16:00:00', dur: 600, kind: 'manual:торцевая' }, { eid: 'm2', t: 'manual', pc: 'stanok', op: 's3', ts0: iso(1) + ' 16:00:00', dur: 1200, kind: 'manual:торцевая' });
  ev.push({ eid: 'b1', t: 'shift', pc: 'stanok', op: 's2', opName: 'Гия', ts0: iso(0) + ' 12:00:00', ts1: iso(0) + ' 12:05:00', dur: 300, x: { a: 'break', auto: 1 } }, { eid: 'g1', t: 'gap', pc: 'stanok', op: 's2', ts0: iso(0) + ' 11:50:00', idleSec: 400, x: { chg: 'part', brk: 200 } });
  ev.push({ eid: 'd1', t: 'part', pc: 'stanok', op: 's2', ts0: iso(18) + ' 10:00:00', project: 'PRJ1', module: 'm7', part: 'R', kind: 'drill', setup: 'normal', runSec: 40, setupSec: 5 }, { eid: 'd2', t: 'part', pc: 'stanok', op: 's2', ts0: iso(18) + ' 10:01:00', project: 'PRJ1', module: 'm7', part: 'R', kind: 'mill', setup: 'normal', runSec: 60, setupSec: 5 });
  ev.push({ eid: 'old', t: 'part', pc: 'stanok', op: 's2', ts0: iso(20) + ' 10:00:00', kind: 'drill', setup: 'normal', runSec: 50, setupSec: 10, planSec: 60 });
  window.MOCK_API({ action: 'cncLog', events: ev }); REQ.length = 0; })();""" % json.dumps(GS)
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 412, 'height': 900}, device_scale_factor=2); ctx.add_init_script(INIT); pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e))); E = pg.evaluate
    pg.goto(PAGE.as_uri()); pg.wait_for_timeout(1500)
    tabs = E("() => [...document.querySelectorAll('#tabs [data-tab]')].map(b => b.dataset.tab)")
    ck('руководитель: вкладка «Станок» последней в режиме руководителя', tabs[-1:] == ['cnc'] and 'reg' in tabs, tabs)
    pg.click('#tabs [data-tab=cnc]'); pg.wait_for_timeout(800)
    ck('запрос cncStat от 30 дней назад (для норм)', E("() => REQ.some(q => q.action === 'cncStat' && q.from)"), E("() => REQ"))
    T = lambda: E("() => document.getElementById('view').textContent.replace(/\\u00a0/g, ' ')")
    kp = E("() => [...document.querySelectorAll('.rgk.cn6 b')].map(b => b.textContent.replace(/\\u00a0/g, ' '))")
    # неделя: 10 деталей; ср. (5400 + 120) / 10 = 552 с; станок по 'run' 3600+1800 = 1,5 ч; установки 30+90 = 2 мин; простой 900 − перерыв в переходе 200 = 700 с; перерывы 300 с; сбоев 1 — строкой
    ck('сводка недели: 10 деталей, ср. 9,2 мин, станок 1,5 ч, установки 2 мин, простой 11,7 мин, перерывы 5 мин; переделок нет', kp == ['10', '9,2 мин', '1,5 ч', '2 мин', '11,7 мин', '5 мин'] and 'Переделк' not in T(), kp)
    ck('сбои — строкой под сводкой: 1', 'Сбоев: 1' in E("() => (document.querySelector('.cnfl')||{}).textContent||''"))
    t = T()
    ck('сейчас на станке: Ника (последняя смена), программа «Боковины кухни» идёт', 'Ника' in E("() => document.querySelector('.cnnow').textContent") and 'Боковины кухни · ' not in t and 'Боковины кухни' in t and 'идёт' in t, E("() => document.querySelector('.cnnow').textContent"))
    ops = E("() => [...document.querySelectorAll('.cnt .cnr')].slice(0, 2).map(r => r.textContent.replace(/\\u00a0/g, ' '))")
    # Гия: детали 4×(100+20)+360 = 840, план 480+330 = 810 → 96 %; Ника: 4×200+1000 = 1800, план 600 → 33 %
    ck('операторы: эффективность Гия 96 %, Ника 33 % (Σ план / Σ станок + установки)', any('Гия' in r and 'эфф. 96 %' in r for r in ops) and any('Ника' in r and 'эфф. 33 %' in r for r in ops), ops)
    ck('операторы: медиана установки Гия 30 с, Ника 1,5 мин; ср. на деталь, перерыв Гия 5 мин; «перед.» нет', any('Гия' in r and 'уст. 30 с' in r and 'ср. дет.' in r and 'перерыв 5 мин' in r for r in ops) and any('Ника' in r and 'уст. 1,5 мин' in r for r in ops) and not any('перед.' in r for r in ops), ops)
    E("() => document.querySelectorAll('details.fold').forEach(d => d.open = true)")
    t = T()
    ck('операции: присадка · обычная — 9 дет., фрезеровка · переворот — 1 м фрез. 1,7 мин (100 с); самая долгая — «Долгая деталь»', 'присадка · обычная9 дет.' in t and '1 м фрез. 1,7 мин' in t and 'Долгая деталь' in t, t[t.find('Операции'):t.find('Операции') + 400])
    sec = t[t.find('Лучше / хуже'):t.find('Тренд')]
    ck('лучше / хуже нормы: Гия по присадке −40 % от медианы операции (120 против 200 с), Ника 0 %', 'Гияприсадка · обычная-40 %' in sec and 'Никаприсадка · обычная0 %' in sec, sec)
    ck('план против факта: 1,4 ч → 1,5 ч, 108 %', 'Факт / план108 %' in t.replace(' ', '').replace('План', 'План') or '108 %' in t[t.find('План против'):], t[t.find('План против'):t.find('План против') + 200])
    ck('ручные: торцевая — 2 раза, всего 0,5 ч', 'торцевая' in t and '2 раз' in t and 'всего 0,5 ч' in t, t[t.find('Ручные'):t.find('Ручные') + 200])
    ck('нормы 30 дней по операции + установке + размеру (до 1200)', 'присадка · обычная · до 1200' in t and 'фрезеровка · переворот · до 1200' in t, t[t.find('Нормы'):])
    ck('тренд — три линии', E("() => document.querySelectorAll('.cntr polyline').length") == 3)
    pg.select_option('[data-cf=op]', 's2'); pg.wait_for_timeout(300)
    kp = E("() => [...document.querySelectorAll('.rgk.cn6 b')].map(b => b.textContent.replace(/\\u00a0/g, ' '))")
    ck('фильтр оператора Гия: 5 деталей, станок 60 мин, сбоев нет', kp[0] == '5' and kp[2] == '60 мин' and not E("() => document.querySelector('.cnfl')"), kp)
    pg.select_option('[data-cf=op]', ''); pg.wait_for_timeout(200); pg.click('[data-cact=per][data-v=today]'); pg.wait_for_timeout(300)
    kp = E("() => [...document.querySelectorAll('.rgk.cn6 b')].map(b => b.textContent.replace(/\\u00a0/g, ' '))")
    ck('сегодня: 5 деталей (4 Гия + 1 Ника)', kp[0] == '5', kp)
    pg.click('[data-cact=per][data-v=own]'); pg.wait_for_timeout(300)
    ck('свой период: поля дат', E("() => document.querySelectorAll('[data-cf=from],[data-cf=to]').length") == 2)
    pg.fill('[data-cf=from]', E("() => cnAdd(CN.d.today, -25)")); pg.dispatch_event('[data-cf=from]', 'change'); pg.wait_for_timeout(300)
    kp = E("() => [...document.querySelectorAll('.rgk.cn6 b')].map(b => b.textContent.replace(/\\u00a0/g, ' '))")
    ck('свой период 25 дней: 12 деталей (с давней; drill + mill одной детали m7 · R — одна)', kp[0] == '12', kp)
    pg.select_option('[data-cf=pc]', 'shop'); pg.wait_for_timeout(300)
    ck('фильтр ПК shop: 1 деталь', E("() => document.querySelector('.rgk.cn6 b').textContent") == '1')
    pg.select_option('[data-cf=pc]', ''); pg.click('[data-cact=per][data-v=week]'); pg.wait_for_timeout(300)
    ck('экран телефона: без горизонтальной прокрутки, таб-бар вмещает 9 вкладок', E("() => document.documentElement.scrollWidth <= window.innerWidth + 1 && [...document.querySelectorAll('#tabs button')].every(b => b.getBoundingClientRect().right <= window.innerWidth)"))
    E("() => window.scrollTo(0, 0)"); pg.screenshot(path=str(pathlib.Path(__file__).with_name('tjob_cnc.png')), full_page=True)
    ctx2 = b.new_context(viewport={'width': 412, 'height': 900}); ctx2.add_init_script("localStorage.setItem('tRole', 'сборщик')"); ctx2.add_init_script(INIT); p2 = ctx2.new_page(); p2.goto(PAGE.as_uri()); p2.wait_for_timeout(1500)
    ck('сотрудник: вкладки «Станок» нет', p2.evaluate("() => !document.querySelector('#tabs [data-tab=cnc]')"))
    ck('без ошибок', not errs, errs[:3])
    b.close()
print('ИТОГ', sum(res), '/', len(res)); sys.exit(0 if all(res) else 1)
