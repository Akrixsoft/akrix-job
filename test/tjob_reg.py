#!/usr/bin/env python3
# tjob_reg: мини-приложение Akrix Job — экран «Реестр» (руководитель / администратор). Сервер — НАСТОЯЩИЙ Code.gs в браузере (мок Apps Script, window.MOCK_API); события пишутся через cncLog.
#  python3 test/tjob_reg.py [index.html] [server/Code.gs]
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
  const or = BOOK.s['Заказы'], row = (id, cl, pr, cost, done, status, proj) => { const r = new Array(27).fill(''); r[0] = "'" + id; r[1] = cl; r[2] = pr; r[5] = cost; r[9] = done; r[11] = status; r[26] = proj; return r; };
  or.appendRow(row('К 2111', 'Костя', 'Кухня', 9000, '2026-12-15', 'в работе', 'PRJ1')); or.appendRow(row('Л 1811', 'Лиси', 'Кухня', 12400, '2026-11-18', 'сдан', ''));
  window.MOCK_API({ action: 'finAdd', type: 'договор', sum: 12400, order: 'Л 1811', client: 'Лиси' }); window.MOCK_API({ action: 'finAdd', type: 'аванс', sum: 9000, order: 'Л 1811', client: 'Лиси' });
  REQ.length = 0; })();""" % json.dumps(GS)
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 412, 'height': 900}, device_scale_factor=2); ctx.add_init_script(INIT); pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e))); E = pg.evaluate
    pg.goto(PAGE.as_uri()); pg.wait_for_timeout(1500)
    tabs = E("() => [...document.querySelectorAll('#tabs [data-tab]')].map(b => b.dataset.tab)")
    ck('руководитель: вкладка «Реестр» в режиме руководителя', 'reg' in tabs, tabs)
    pg.click('#tabs [data-tab=reg]'); pg.wait_for_timeout(800)
    cards = E("() => [...document.querySelectorAll('.rgc .rgh')].map(b => b.dataset.k)")
    ck('строки реестра с сервера: Л 1811 и проект PRJ1', 'o:Л 1811' in cards and 'p:PRJ1' in cards, cards)
    t = E("() => document.querySelector('.rgh[data-k=\"o:Л 1811\"]').textContent")
    ck('«сдан» в Job → «8. Выполнен» 🔒, остаток 3 400 подсвечен', '8. Выполнен' in t and '🔒' in t and '3 400' in t.replace(' ', ' ') and E("() => !!document.querySelector('.rgh[data-k=\"o:Л 1811\"] .rgbad')"), t)
    ck('итоги — только с поступлениями: 12 400 / 12 400 / 9 000 / 3 400', E("() => [...document.querySelectorAll('.rgk:not(.sm) b')].map(b => b.textContent.replace(/\\s/g, ''))") == ['12400', '12400', '9000', '3400'])
    pg.click('.rgh[data-k="p:PRJ1"]'); pg.wait_for_timeout(300)
    st = E("() => { const c = document.querySelector('.rgc.open'); return [getComputedStyle(c).borderTopColor, getComputedStyle(c.querySelector('.rgh')).backgroundColor]; }")
    ck('раскрытие: тёмно-жёлтая рамка, бледно-жёлтая строка', st == ['rgb(201, 162, 39)', 'rgb(255, 247, 209)'], st)
    pg.select_option('.rgc.open [data-rst]', '4. Деталировка'); pg.wait_for_timeout(500)
    ck('статус → regSet; заказы Job не тронуты', E("() => REQ.some(q => q.action === 'regSet' && q.status === '4. Деталировка') && BOOK.s['Реестр заказов'].d.some(r => r[0] === 'p:PRJ1' && r[5] === '4. Деталировка') && BOOK.s['Заказы'].d[1][11] === 'в работе'"))
    pg.fill('.rgc.open [data-rf=sum]', '4000'); pg.select_option('.rgc.open [data-rf=way]', 'нал'); pg.click('.rgc.open [data-ract=pay]'); pg.wait_for_timeout(600)
    t = E("() => document.querySelector('.rgc.open').textContent.replace(/\\u00a0/g, ' ')")
    ck('первый аванс → фиксация 9 000, остаток 5 000', '9 000' in t and '5 000' in t and 'первым поступлением' in t, t[:300])
    pg.fill('.rgc.open [data-rf=tot]', '11000'); pg.click('.rgc.open [data-ract=quote]'); pg.wait_for_timeout(600)
    ck('ручная котировка: остаток 7 000', '7 000' in E("() => document.querySelector('.rgc.open').textContent.replace(/\\u00a0/g, ' ')") and E("() => BOOK.s['Реестр заказов'].d.find(r => r[0] === 'p:PRJ1')[8]") == 'ручн')
    pg.click('.rgc.open [data-ract=del]'); n1 = E("() => REQ.filter(q => q.action === 'finDel').length"); pg.click('.rgc.open [data-ract=del]'); pg.wait_for_timeout(500)
    ck('удаление записи — со второго нажатия', n1 == 0 and E("() => REQ.filter(q => q.action === 'finDel').length") == 1)
    pg.fill('#reg-q', 'лиси'); pg.wait_for_timeout(200)
    ck('поиск без перерисовки', E("() => [...document.querySelectorAll('.rgc')].filter(c => !c.hidden).length") == 1)
    ck('экран телефона: без горизонтальной прокрутки', E("() => document.documentElement.scrollWidth <= window.innerWidth + 1"))
    ctx2 = b.new_context(viewport={'width': 412, 'height': 900}); ctx2.add_init_script("localStorage.setItem('tRole', 'сборщик')"); ctx2.add_init_script(INIT); p2 = ctx2.new_page(); p2.goto(PAGE.as_uri()); p2.wait_for_timeout(1500)
    ck('сотрудник: вкладки «Реестр» нет', p2.evaluate("() => !document.querySelector('#tabs [data-tab=reg]') && document.getElementById('roleseg').hidden"))
    ck('без ошибок', not errs, errs[:3])
    b.close()
print('ИТОГ', sum(res), '/', len(res)); sys.exit(0 if all(res) else 1)
