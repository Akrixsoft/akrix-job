/* =====================================================================
   Akrix Job — серверная часть (Google Apps Script, привязан к таблице «Akrix Job — база»)
   Вставить целиком в Расширения → Apps Script → Code.gs
   Токен бота: Настройки проекта → Свойства скрипта → BOT_TOKEN
   ===================================================================== */

/* ============ BLOCK: CONFIG ============ */
const APP_URL = 'https://akrixsoft.github.io/akrix-job/';   // адрес мини-приложения (GitHub Pages)
const TZ = 'Asia/Tbilisi';
const SH = { params:'Параметры', staff:'Сотрудники', orders:'Заказы', extras:'Доп. обработки', modules:'Модули', tasks:'Задачи',
  ops:'Операции', lib:'Библиотека монтажа', shifts:'Смены', marks:'Отметки', plans:'Планы', takes:'Взятые задачи', kit:'Комплект', notes:'Заметки монтажа', buy:'Закупка', buyCat:'Справочник закупки', time:'Время', skills:'Навыки', pays:'Выплаты', skillLog:'Навыки — история', fix:'Доделки', drill:'Станок — журнал', parts:'Детали' };
const ORD = { id:0, client:1, product:2, sys:3, kind:4, cost:5, term:6, ship:7, ceh:8, done:9, team:10, status:11, mat0:12, matN:21, off:21, mountAt:22, prisManual:23, master:24, shopPct:25 };
const BOSS_ROLES = ['руководитель', 'администратор'];   // полный доступ: заказы, фонд, люди, закупка

function book_(){ return SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SHEET_ID')); }
function sh_(name){ return book_().getSheetByName(name); }
function appUrl_(){ const u = PropertiesService.getScriptProperties().getProperty('WEBAPP_URL'); if (!u) throw new Error('Добавьте свойство скрипта WEBAPP_URL — адрес веб-приложения (…/exec)'); return APP_URL + '?api=' + encodeURIComponent(u.trim()); }
function token_(){ return PropertiesService.getScriptProperties().getProperty('BOT_TOKEN') || ''; }

/* ============ BLOCK: SHEET HELPERS ============ */
function cell_(v){ // Date → строка; время (1899) → ЧЧ:ММ
  if (Object.prototype.toString.call(v) === '[object Date]'){ if (v.getFullYear() < 1901) return Utilities.formatDate(v, TZ, 'HH:mm'); return Utilities.formatDate(v, TZ, 'yyyy-MM-dd HH:mm'); }
  return v;
}
function read_(name, firstRow, cols){ // строки с номером строки в конце
  const s = sh_(name), last = s.getLastRow(); if (last < firstRow) return [];
  const w = cols || s.getLastColumn();
  return s.getRange(firstRow, 1, last - firstRow + 1, w).getValues()
    .map((r, i) => r.map(cell_).concat([firstRow + i]))
    .filter(r => r.slice(0, -1).some(x => x !== '' && x !== null) && !String(r[0]).startsWith('пример'));
}
function append_(name, row){ const s = sh_(name); s.appendRow(row); return s.getLastRow(); }
function now_(){ return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm'); }
function today_(){ return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function hm_(){ return Utilities.formatDate(new Date(), TZ, 'HH:mm'); }
function utc_(iso){ const p = String(iso).slice(0, 10).split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2])); }
function addDays_(iso, n){ const d = utc_(iso); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function dayDiff_(a, b){ return Math.round((utc_(a) - utc_(b)) / 864e5); }
function findOrderRow_(id){ const s = sh_(SH.orders), v = s.getRange(1, 1, s.getLastRow(), 1).getDisplayValues();
  for (let i = 2; i < v.length; i++) if (String(v[i][0]).trim() === String(id).trim()) return i + 1; throw new Error('Заказ не найден: ' + id); }

/* ============ BLOCK: PARAMS ============ */
function params_(){
  const v = sh_(SH.params).getRange('A2:B40').getValues(), m = {};
  v.forEach(r => { if (r[0]) m[String(r[0]).trim()] = cell_(r[1]); });
  const g = (label, def) => { const k = Object.keys(m).find(x => x.indexOf(label) === 0); return k !== undefined && m[k] !== '' ? m[k] : def; };
  return { rateH: +g('Ставка нормо-часа', 15), prisAuto: +g('Присадка по выгрузке', 70), prisManualAdd: 100 - +g('Присадка по выгрузке', 70),   // ручная = 100% пула
    planTo: String(g('Крайний срок плана', '18:00')), remindPlan: String(g('Напоминания бота о плане', '16:00, 17:30')),
    remindClose: String(g('Напоминание закрыть', '20:00')), remindMorning: String(g('Напоминание о незакрытой', '08:00')), remindBuy: String(g('Напоминание о закупке', '09:30')), lagMaster: String(g('Отставание заказа — писать мастеру', 'нет')), hoursDay: +g('Часов в рабочем дне', 8), dayOff: String(g('Выходной день', 'воскресенье')),
    helperRate: +g('Ставка помощника', 9), korpusOther: +g('Ставка корпуса «Прочее»', 25), shopDefault: +g('Сборка в цеху по умолчанию', 50), botName: String(g('Имя бота', '')) };
}

/* ============ BLOCK: AUTH (подпись Telegram initData) ============ */
function hex_(bytes){ return bytes.map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join(''); }
function verify_(init){
  if (!init) throw new Error('Откройте приложение из Telegram');
  const p = {}; String(init).split('&').forEach(kv => { const i = kv.indexOf('='); p[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1)); });
  const hash = p.hash; delete p.hash;
  const dcs = Object.keys(p).sort().map(k => k + '=' + p[k]).join('\n');
  const secret = Utilities.computeHmacSha256Signature(token_(), 'WebAppData');
  const sig = hex_(Utilities.computeHmacSha256Signature(Utilities.newBlob(dcs).getBytes(), secret));
  if (sig !== hash) throw new Error('Подпись Telegram не сошлась');
  if (Date.now() / 1000 - Number(p.auth_date) > 7 * 86400) throw new Error('Сессия устарела — переоткройте приложение');
  return JSON.parse(p.user);
}
function whoAmI_(tgUser){
  const s = sh_(SH.staff), rows = read_(SH.staff, 2, 7);
  const un = String(tgUser.username || '').toLowerCase();
  const r = rows.find(x => String(x[3]) === String(tgUser.id)) || rows.find(x => un && String(x[2]).replace('@', '').trim().toLowerCase() === un);
  if (!r || String(r[6]).trim() === 'нет') throw new Error('Нет доступа. Попросите руководителя добавить @' + (tgUser.username || tgUser.id) + ' в лист «Сотрудники»');
  if (String(r[3]) !== String(tgUser.id)) s.getRange(r[7], 4).setValue(String(tgUser.id));
  return { id: String(r[0]), name: String(r[1]), boss: BOSS_ROLES.indexOf(String(r[4]).trim()) >= 0, role: String(r[4]).trim() };
}

/* ============ BLOCK: ANDROID KEY — вход из Android-приложения: код из Telegram (10 мин) → постоянный ключ (свойство AK_<ключ> = id) ============ */
function whoByKey_(key){ const pr = PropertiesService.getScriptProperties(), id = /^[a-f0-9]{48}$/.test(String(key)) ? pr.getProperty('AK_' + key) : null;
  const r = id && read_(SH.staff, 2, 7).find(x => String(x[0]) === id);
  if (!r || String(r[6]).trim() === 'нет') throw new Error('Телефон не подключён — получи новый код в Akrix Job');
  return { id: String(r[0]), name: String(r[1]), boss: BOSS_ROLES.indexOf(String(r[4]).trim()) >= 0, role: String(r[4]).trim(), viaKey: true }; }
function pair_(code){ const pr = PropertiesService.getScriptProperties(), lock = LockService.getScriptLock(); lock.waitLock(20000);
  try { const f = JSON.parse(pr.getProperty('PAIRFAIL') || '{"n":0,"t":0}'); if (Date.now() - f.t > 6e5){ f.n = 0; f.t = Date.now(); }
    if (f.n >= 20) throw new Error('Слишком много попыток — подожди 10 минут');
    const c = String(code || '').replace(/\D/g, ''), v = c.length === 6 ? JSON.parse(pr.getProperty('PC_' + c) || 'null') : null;
    if (!v || v.exp < Date.now()){ f.n++; pr.setProperty('PAIRFAIL', JSON.stringify(f)); throw new Error('Код не подошёл или истёк'); }
    pr.deleteProperty('PC_' + c); const key = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').slice(0, 48);
    pr.setProperty('AK_' + key, v.id); const st = staffById_(v.id); return { key, name: st ? String(st[1]) : '' }; }
  catch (e){ return { error: String(e.message || e) }; } finally { lock.releaseLock(); } }
/* ===== END BLOCK: ANDROID KEY ===== */

/* ============ BLOCK: API ============ */
function doGet(){ return ContentService.createTextOutput('Akrix Job API работает'); }
function doPost(e){
  let out;
  if (e && e.parameter && e.parameter.tg){   // вебхук Telegram: кнопки и команды в чате бота
    if (e.parameter.tg === tgSecret_()){ const lock = LockService.getScriptLock(); lock.waitLock(20000);
      try { handleTg_(JSON.parse(e.postData.contents)); bump_(); } catch (err) {} finally { lock.releaseLock(); } }
    return HtmlService.createHtmlOutput('ok'); }   // HtmlService: без редиректа 302, иначе Telegram повторяет обновления
  try {
    const b = JSON.parse(e.postData.contents);
    if (b.action === 'ver') return ContentService.createTextOutput(JSON.stringify({ ok: true, ver: ver_() })).setMimeType(ContentService.MimeType.JSON);   // быстрый опрос: менялось ли что-нибудь
    if (b.action === 'pair') return ContentService.createTextOutput(JSON.stringify({ ok: true, data: pair_(b.code) })).setMimeType(ContentService.MimeType.JSON);
    const me = b.key && !b.init ? whoByKey_(b.key) : whoAmI_(verify_(b.init));
    const fn = API[b.action]; if (!fn) throw new Error('Нет действия ' + b.action);
    if (fn.boss && !me.boss) throw new Error('Только для руководителя');
    const lock = LockService.getScriptLock(); lock.waitLock(20000);
    try { out = { ok: true, data: fn(me, b) }; out.ver = RO_[b.action] ? ver_() : bump_(); } finally { lock.releaseLock(); }
  } catch (err) { out = { ok: false, error: String(err && err.message || err) }; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}
function bossOnly_(f){ f.boss = true; return f; }
/* ===== BLOCK: SYNC — счётчик изменений: любая запись +1; клиенты опрашивают его и перечитывают таблицу только при изменении ===== */
const RO_ = { boot: 1, mini: 1, pairCode: 1, staffList: 1, orderList: 1 };
function ver_(){ return +(PropertiesService.getScriptProperties().getProperty('VER') || 0); }
function bump_(){ const pr = PropertiesService.getScriptProperties(), v = (+(pr.getProperty('VER') || 0)) + 1; pr.setProperty('VER', String(v)); return v; }
/* ===== END BLOCK: SYNC ===== */

const API = {
  /* ---- загрузка всего для приложения ---- */
  boot(me){ ensureTriggers_(); ensureWebhook_();
    const o = sh_(SH.orders);
    return { me, caps: ['closeFor'], params: params_(), today: today_(), now: hm_(),
      staff: read_(SH.staff, 2, 10).map(r => ({ id: String(r[0]), name: String(r[1]), role: String(r[4]).trim(), helperRate: r[5], active: String(r[6]).trim() !== 'нет', tg: !!r[3], payMode: String(r[8] || '').trim() === 'без лимита' ? 'free' : 'earned', subs: subsOf_(r[9]), subsRaw: String(r[9] || '') })),
      pays: sh_(SH.pays) ? read_(SH.pays, 2, 9) : [],
      ops: read_(SH.ops, 2, 11),
      orderHead: o.getRange(1, 1, 1, 26).getValues()[0],
      orders: read_(SH.orders, 2, 26),
      extras: read_(SH.extras, 2, 5), modules: read_(SH.modules, 2, 5), tasks: read_(SH.tasks, 2, 5), lib: read_(SH.lib, 2, 2),
      shifts: read_(SH.shifts, 2, 12), marks: read_(SH.marks, 2, 12).filter(r => r[11] !== 'да'),
      plans: read_(SH.plans, 2, 6), takes: read_(SH.takes, 2, 5), kit: read_(SH.kit, 2, 7).filter(r => r[6] !== 'да'), notes: read_(SH.notes, 2, 5), buy: read_(SH.buy, 2, 8), buyCat: sh_(SH.buyCat) ? read_(SH.buyCat, 2, 2) : [], time: sh_(SH.time) ? read_(SH.time, 2, 11) : [], skills: skills_(), skillLog: sh_(SH.skillLog) ? read_(SH.skillLog, 2, 6) : [], fixes: sh_(SH.fix) ? read_(SH.fix, 2, 11).filter(r => r[5] !== 'удалена') : [],
      parts: sh_(SH.parts) ? read_(SH.parts, 2, 8).map(r => [String(r[0]).trim(), String(r[2]), String(r[3]), String(r[6])]) : [],
      drilled: sh_(SH.drill) ? read_(SH.drill, 2, 16).map(r => [String(r[2]).trim(), String(r[6]), String(r[12]), String(r[9]), String(r[15])]) : [] };
  },
  /* ---- смена ---- */
  shiftStart(me, b){   // смена = одна строка в день; ушёл и вернулся — новый отрезок в колонке L «Отрезки»
    const t = today_(), rows = read_(SH.shifts, 2, 12), at = hm_();
    const day = rows.filter(r => String(r[0]).slice(0, 10) === t && String(r[1]) === me.id).pop();
    if (day && !day[3]) throw new Error('Смена уже начата');
    if (day){ const g = segs_(day).concat([{ s: at, e: '' }]); const s = sh_(SH.shifts);
      s.getRange(day[12], 4).setValue(''); s.getRange(day[12], 12).setValue("'" + segStr_(g));
      if (!me.boss) notifyBosses_('arrive', '↩️ ' + me.name + ' вернулся в ' + at + '.'); taskMsg_(me.id, true); return { at, late: '', again: true }; }
    const plan = latestPlan_(me.id, t);
    let late = ''; if (plan && plan.at && !plan.off){ const d = toMin_(at) - toMin_(plan.at); late = d > 0 ? d : 0; }
    append_(SH.shifts, [t, me.id, "'" + at, '', '', plan ? (plan.off ? 'не выходил' : "'" + plan.at) : 'не указан', late, b.geo || '', '', '', '', "'" + at + '–']);
    if (!me.boss) notifyBosses_('arrive', subs => subs.indexOf('arrive_plan') >= 0   // подробности (план и опоздание) — отдельной галкой
      ? (late > 5 ? '⏰ ' : '✅ ') + me.name + ' пришёл в ' + at + (plan && plan.at && !plan.off ? ' · план ' + plan.at + (late > 5 ? ' · опоздание ' + late + ' мин' : '') : ' · план не указан') + '.'
      : '✅ ' + me.name + ' пришёл в ' + at + '.');
    taskMsg_(me.id, true); return { at, late, plan };
  },
  shiftEnd(me, b){ // b.date — закрыть смену прошлого дня с указанным временем ухода b.at; b.who — руководитель закрывает смену сотрудника
    const by = me; if (b.who && String(b.who) !== me.id){ if (!me.boss) throw new Error('Закрыть чужую смену может только руководитель');
      const st = staffById_(b.who); if (!st) throw new Error('Нет сотрудника'); me = { id: String(st[0]), name: String(st[1]), boss: false }; }
    const other = by !== me;
    const t = b.date || today_(), rows = read_(SH.shifts, 2, 12), r = rows.reverse().find(x => String(x[0]).slice(0, 10) === t && String(x[1]) === me.id && !x[3]);
    if (!r) throw new Error('Открытой смены нет');
    if (t !== today_() && !/^\d\d:\d\d$/.test(String(b.at || ''))) throw new Error('Укажи, во сколько ушёл');
    let at = t !== today_() ? b.at : hm_();
    if (other && t === today_() && /^\d\d:\d\d$/.test(String(b.at || '')) && b.at < at) at = b.at;   // руководитель указал время ухода раньше «сейчас»
    const g = segs_(r); if (at < g[g.length - 1].s) throw new Error('Время ухода раньше начала отрезка ' + g[g.length - 1].s); g[g.length - 1].e = at;
    const h = Math.round(segMin_(g) / 60 * 100) / 100;   // сумма отрезков, перерывы не считаются
    stopWork_(me.id, t === today_() ? at : null); const s = sh_(SH.shifts); s.getRange(r[12], 4, 1, 2).setValues([["'" + at, h]]); s.getRange(r[12], 9, 1, 2).setValues([[b.geo || '', (b.misc || '') + (other ? (b.misc ? ' · ' : '') + 'закрыл ' + by.name : '')]]);
    s.getRange(r[12], 12).setValue("'" + segStr_(g));
    if (other) notifyOne_(me.id, '🏁 ' + by.name + ' закрыл твою смену: уход ' + at + ' · на смене ' + String(h).replace('.', ',') + ' ч.');
    else if (!me.boss) notifyBosses_('leave', '🏁 ' + me.name + ' ушёл в ' + at + (t !== today_() ? ' (смена ' + t.slice(8, 10) + '.' + t.slice(5, 7) + ', закрыта задним числом)' : '') + ' · на смене ' + String(h).replace('.', ',') + ' ч.');
    if (t === today_() || !onShift_(me.id)) taskMsgClose_(me.id);
    return { at, hours: h };
  },
  /* ---- счётчик времени: одна активная операция на человека ---- */
  workStart(me, b){ stopWork_(me.id); const pl = Math.round(+b.plan || 0);   // pl — свой таймер, мин (0 — без вопроса)
    const dl = Math.max(0, Math.min(240, Math.round(+b.delay || 0))), at = new Date(Date.now() + dl * 6e4);   // отложенный старт: строка с будущим началом
    append_(SH.time, [Utilities.formatDate(at, TZ, 'yyyy-MM-dd HH:mm'), me.id, b.order, b.op, '', '', '', pl > 0 ? pl : '', '', dl && b.ping ? 'ждёт' : '']);
    if (dl && b.ping) pingAt_(at); taskMsg_(me.id); return {}; },
  workStop(me){ stopWork_(me.id); taskMsg_(me.id); return {}; },
  /* ---- Drilling: журнал присадки по деталям (пока копится; автоотметки по модулям — после передачи модулей из конструктора) ---- */
  drillEvents(me, b){ const ev = (b.events || []).slice(0, 200); if (!ev.length) return { accepted: 0, mismatches: [] };
    if (!sh_(SH.drill)){ const s0 = book_().insertSheet(SH.drill); s0.appendRow(['Получено', 'eid', 'Заказ', 'Проект', 'Версия проекта', 'Модуль', 'Деталь', 'Название', 'Начало', 'Конец', 'Станок, с', 'Источник', 'Оператор', 'Компьютер', 'Переделка', 'Отметка', 'Отправил']); }
    const s = sh_(SH.drill), seen = {}; if (s.getLastRow() > 1) s.getRange(2, 2, s.getLastRow() - 1, 1).getValues().forEach(r => seen[String(r[0])] = 1);
    const orders = {}; read_(SH.orders, 2, 1).forEach(r => orders[String(r[0]).trim()] = 1);
    const rows = [], mism = [], at = now_();
    ev.forEach(e => { const id = String(e.eid || ''); if (!id || seen[id]) return; seen[id] = 1;
      const o = String(e.order || '').trim(); if (o && !orders[o]) mism.push({ module: e.module || '', part: e.part || '', reason: 'заказа ' + o + ' нет в Job' });
      rows.push([at, id, "'" + o, String(e.project || ''), e.projectVer == null ? '' : String(e.projectVer), String(e.module || ''), String(e.part || ''), String(e.partName || ''),
        "'" + String(e.start || ''), "'" + String(e.end || ''), +e.machineSec || 0, String(e.source || ''), String(e.operator || ''), String(e.pc || ''), e.redo ? 'да' : '', String(e.mark || ''), me.id]); });
    if (rows.length) s.getRange(s.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    return { accepted: rows.length, duplicates: ev.length - rows.length, mismatches: mism }; },
  /* ---- конструктор: список заказов с модулями и привязка проекта (mode 'link') ---- */
  orderList(me){ const mods = sh_(SH.modules), mr = read_(SH.modules, 2, 7), marks = read_(SH.marks, 2, 12).filter(r => r[11] !== 'да');
    const opsN = {}; read_(SH.ops, 2, 5).forEach(r => { const g = String(r[1]).trim(); if (g && r[4]) (opsN[g] = opsN[g] || {})[String(r[4]).trim()] = 1; });
    const done = {}; marks.forEach(r => { const k = String(r[2]).trim() + '|' + String(r[3]).trim() + '|' + String(r[5]).trim(); (done[k] = done[k] || {})[String(r[4]).trim()] = 1; });
    const code = n => { const m = String(n).match(/[СC]\d+\s*·\s*[МM]\d+|[МM]\d+/); return m ? m[0].replace(/\s/g, '') : ''; };
    const orders = read_(SH.orders, 2, 27).filter(r => String(r[0]).trim() && String(r[11]).trim() !== 'сдан' && !/^пример/.test(String(r[0])));
    return { orders: orders.map(r => { const id = String(r[0]).trim();
      return { id, client: String(r[1]), product: String(r[2]), project: String(r[26] || ''), state: String(r[11] || ''),
        modules: mr.filter(m => String(m[0]).trim() === id).map(m => { const g = String(m[1]).trim(), d = done[id + '|' + g + '|' + String(m[2]).trim()] || {}, n = Object.keys(opsN[g] || {}).length;
          return { name: String(m[2]), code: String(m[5] || '') || code(m[2]), id: String(m[6] || ''), group: g, area: +String(m[3]).replace(',', '.') || 0, done: n ? Math.round(Object.keys(d).length / n * 100) / 100 : 0, pris: !!d.pris, note: String(m[4] || '') }; }) }; }) }; },
  orderPush: bossOnly_(function(me, b){ if (b.mode !== 'link') throw new Error('Пока поддерживается только mode:link');
    const pid = String((b.project || {}).id || ''); if (!pid) throw new Error('Нет id проекта');
    const so = sh_(SH.orders), sm = sh_(SH.modules); if (!String(so.getRange(1, 27).getValue())) so.getRange(1, 27).setValue('Проект');
    if (!String(sm.getRange(1, 6).getValue())) sm.getRange(1, 6, 1, 2).setValues([['Код', 'id конструктора']]);
    let sp = sh_(SH.parts); if (!sp){ sp = book_().insertSheet(SH.parts); sp.appendRow(['Заказ', 'id модуля', 'Модуль', 'Деталь (key)', 'Код', 'Материал', 'Группа', 'Площадь', 'Проект']); }
    let linked = 0, added = 0; const unmatched = [];
    (b.orders || []).forEach(o => { const oid = String(o.id || '').trim(), row = findOrderRow_(oid); const cur = String(so.getRange(row, 27).getValue() || '');
      if (cur && cur !== pid) throw new Error('Заказ ' + oid + ' уже связан с другим проектом');
      so.getRange(row, 27).setValue(pid);
      const mr = read_(SH.modules, 2, 7).filter(m => String(m[0]).trim() === oid), byName = {}; mr.forEach(m => byName[String(m[2]).trim().toLowerCase()] = m);
      const byId = {}; mr.forEach(m => { if (m[6]) byId[String(m[6])] = m; });
      (o.modules || []).forEach(m => { const ex = (m.jobName && byName[String(m.jobName).trim().toLowerCase()]) || byId[String(m.id)];
        if (ex){ sm.getRange(ex[7], 6, 1, 2).setValues([[String(m.code || ''), String(m.id || '')]]); linked++; }
        else if (m.jobName){ unmatched.push({ name: String(m.jobName), side: 'job', reason: 'нет такого модуля в Job' }); }
        else { sm.appendRow(["'" + oid, String(m.group || 'korpus'), String(m.name || m.code || 'модуль'), +m.area || 1, 'из проекта', String(m.code || ''), String(m.id || '')]); added++; } });
      // группы, которых нет в составе заказа: детали не учитываются, пока группу не добавят в «Составе заказа»
      const hdr = so.getRange(1, ORD.mat0 + 1, 1, 9).getDisplayValues()[0], vals = so.getRange(row, ORD.mat0 + 1, 1, 9).getValues()[0], has = {};
      hdr.forEach((h, i) => { const c = String(h).split('·').pop().trim(); if (c && +String(vals[i]).replace(',', '.') > 0) has[c] = 1; });
      const miss = {}; (o.modules || []).forEach(m => (m.parts || []).forEach(p => { const g = String(p.group || m.group || 'korpus'); if (!has[g]) miss[g] = (miss[g] || 0) + 1; }));
      Object.keys(miss).forEach(g => unmatched.push({ name: oid + ': группа ' + g + ' (' + miss[g] + ' дет.)', side: 'project', reason: 'группы нет в составе заказа — добавь её в карточке заказа, иначе детали не учитываются' }));
      // детали модуля из других групп (другой материал) — свой модуль в той группе: то же имя, площадь = сумма деталей
      const nowM = read_(SH.modules, 2, 7).filter(x => String(x[0]).trim() === oid);
      (o.modules || []).forEach(m => { const g0 = String(m.group || 'korpus'), nm = String(m.jobName || m.name || m.code || 'модуль'), byG = {};
        (m.parts || []).forEach(p => { const g = String(p.group || g0); if (g !== g0) byG[g] = (byG[g] || 0) + (+p.area || 0); });
        Object.keys(byG).forEach(g => { if (nowM.some(x => String(x[1]).trim() === g && (String(x[6]) === String(m.id) || String(x[2]).trim() === nm))) return;
          sm.appendRow(["'" + oid, g, nm, Math.round(byG[g] * 1000) / 1000 || 1, 'из проекта · детали ' + g, String(m.code || ''), String(m.id || '')]); added++; }); });
      (o.unmatchedJob || []).forEach(n => { const ex = byName[String(n).trim().toLowerCase()]; if (ex){ sm.getRange(ex[7], 5).setValue('нет в проекте'); unmatched.push({ name: String(n), side: 'job' }); } });
      // детали заказа — перезаписываются целиком
      const all = sp.getLastRow() > 1 ? sp.getRange(2, 1, sp.getLastRow() - 1, 9).getValues() : [], keep = all.filter(r => String(r[0]).trim() !== oid);
      (o.modules || []).forEach(m => (m.parts || []).forEach(p => keep.push(["'" + oid, String(m.id || ''), String(m.jobName || m.name || ''), String(p.key || ''), String(p.code || ''), String(p.mat || ''), String(p.group || m.group || ''), +p.area || 0, pid])));
      if (all.length) sp.getRange(2, 1, all.length, 9).clearContent();
      if (keep.length) sp.getRange(2, 1, keep.length, 9).setValues(keep); });
    return { linked, added, unmatched }; }),
  /* ---- внешние программы (Drilling, конструктор): список сотрудников для выбора оператора ---- */
  staffList(me){ return { staff: read_(SH.staff, 2, 7).filter(r => String(r[0]).trim() && String(r[6]).trim() !== 'нет').map(r => ({ id: String(r[0]).trim(), name: String(r[1]), role: String(r[4]).trim() })) }; },
  /* ---- Android: код подключения и компактное состояние для шторки ---- */
  pairCode(me){ if (me.viaKey) throw new Error('Код выдаётся в Telegram'); const pr = PropertiesService.getScriptProperties();
    let c; do { c = String(100000 + Math.floor(Math.random() * 900000)); } while (pr.getProperty('PC_' + c));
    pr.setProperty('PC_' + c, JSON.stringify({ id: me.id, exp: Date.now() + 6e5 })); return { code: c }; },
  mini(me){ const run = read_(SH.time, 2, 6).filter(x => String(x[1]) === me.id && !x[4]).pop(), list = myTasks_(me.id);
    const lbl = (o, op) => { const t = list.find(x => x.order === o && x.op === op); if (t) return t.label; const r = read_(SH.orders, 2, 3).find(x => String(x[0]).trim() === o); return (r ? r[1] + ' · ' + r[2] + ' · ' : '') + opName_(o, op); };
    const active = run ? { order: String(run[2]).trim(), op: String(run[3]).trim(), label: lbl(String(run[2]).trim(), String(run[3]).trim()), startMs: utcMs_(cell_(run[0])) } : null;
    return { name: me.name, onShift: onShift_(me.id), active, tasks: list.slice(0, 8) }; },
  /* время вручную: любой день (тестовый режим — без ограничений, с пометкой); за себя — каждый, за других — взявший задачу или руководитель; минус — поправка */
  timeAdd(me, b){ const m = Math.round(+b.minutes || 0); if (!m) throw new Error('Впиши время');
    const who = String(b.who || me.id), day = /^\d{4}-\d\d-\d\d$/.test(String(b.date || '')) ? b.date : today_();
    if (who !== me.id && !me.boss && !tookTask_(me.id, b.order, b.op)) throw new Error('Время за другого вписывает тот, кто взял задачу, или руководитель');
    if (m < 0){ const have = read_(SH.time, 2, 6).filter(r => String(r[1]) === who && String(r[2]).trim() === String(b.order).trim() && String(r[3]) === b.op).reduce((a, r) => a + (+r[5] || 0), 0);
      if (have + m < 0) throw new Error('Нельзя убрать больше, чем есть: ' + Math.round(have) + ' мин'); }
    const at = day + ' 12:00', late = day !== today_() ? 'позже' : '';
    append_(SH.time, [at, who, b.order, b.op, at, m, 'вручную', '', '', '', me.id + ' ' + now_() + (late ? ' · внесено позже' : '')]); return {}; },
  shiftLate(me){ // «работаю дальше» — вечерняя смена, больше не напоминать
    const t = today_(), r = read_(SH.shifts, 2, 11).reverse().find(x => String(x[0]).slice(0, 10) === t && String(x[1]) === me.id && !x[3]);
    if (r) sh_(SH.shifts).getRange(r[11], 11).setValue('да'); return {};
  },
  /* ---- отметки работы: галочка = запись в расчёт ---- */
  mark(me, b){
    let who = me.id;
    if (b.auto){   // автоотметка по станку: без дублей (отметка модуля уже есть — вернуть её), исполнитель — оператор станка
      const ex = read_(SH.marks, 2, 12).find(r => r[11] !== 'да' && String(r[2]).trim() === String(b.order).trim() && String(r[3]) === String(b.grp) && String(r[4]) === String(b.op) && String(r[5]) === String(b.unit));
      if (ex) return { row: ex[12], dup: true };
      if (b.who && staffById_(b.who)) who = String(b.who); }
    const row = append_(SH.marks, [now_(), who, b.order, b.grp, b.op, b.unit, b.pct, b.amount, 0, b.partner || '', b.mode || '', '']);
    taskMsg_(me.id); return { row, at: hm_() };
  },
  unmark(me, b){
    const s = sh_(SH.marks), r = s.getRange(b.row, 1, 1, 12).getValues()[0];
    if (String(r[1]) !== me.id && !me.boss) throw new Error('Можно снять только свою отметку');
    if (!me.boss && String(cell_(r[0])).slice(0, 10) !== today_()) throw new Error('Снять можно только сегодняшнюю отметку');
    s.getRange(b.row, 12).setValue('да'); return {};
  },
  take(me, b){ append_(SH.takes, [now_(), me.id, b.order, b.op, 'взял']); taskMsg_(me.id); return {}; },
  untake(me, b){ append_(SH.takes, [now_(), me.id, b.order, b.op, 'отменил']); taskMsg_(me.id); return {}; },
  unjoin(me, b){ append_(SH.takes, [now_(), b.who, b.order, b.op, 'отключён ' + me.id]); taskMsg_(String(b.who)); return {}; },
  /* доли участников: задаёт позвавший (взявший задачу) или руководитель; 'доли S1:70,S3:30' или 'доли сброс' */
  shareSet(me, b){ const e = Object.entries(b.shares || {}).filter(x => +x[1] > 0);
    if (e.length && Math.abs(e.reduce((a, x) => a + +x[1], 0) - 100) > 0.5) throw new Error('Доли должны давать 100%');
    append_(SH.takes, [now_(), me.id, b.order, b.op, 'доли ' + (e.length ? e.map(x => x[0] + ':' + Math.round(+x[1])).join(',') : 'сброс')]); return {}; },
  /* ученик просится на операцию: сообщение взявшему (если есть) или руководству и мастеру */
  askJoin(me, b){ const txt = me.name + ' просится помощником: ' + (b.opName || b.op) + ' · ' + b.order + '. Подключить — в списке участников задачи.';
    if (b.to) notifyOne_(String(b.to), txt, 'ask_me'); else { notifyBosses_('ask', txt); const o = read_(SH.orders, 2, 26).find(r => String(r[0]).trim() === String(b.order)); if (o && o[24]) notifyOne_(String(o[24]).trim(), txt); }
    return {}; },
  join(me, b){ if (!b.who || b.who === me.id) throw new Error('Выбери сотрудника'); append_(SH.takes, [now_(), b.who, b.order, b.op, 'подключён ' + me.id]); taskMsg_(String(b.who)); return {}; },
  /* ---- план выхода ---- */
  planSet(me, b){
    const d = b.date; if (!canEditPlan_(d) && !me.boss) throw new Error('Этот день уже не меняется');
    append_(SH.plans, [d, b.who && me.boss ? b.who : me.id, b.clear ? '' : (b.off ? '' : "'" + b.at), b.clear ? '' : (b.off ? 'да' : ''), b.clear ? 'очищено' : (b.reason || ''), now_()]);
    return {};
  },
  planBulk(me, b){
    const rows = []; (b.dates || []).forEach(d => { if (canEditPlan_(d)) rows.push([d, me.id, "'" + b.at, '', '', now_()]); });
    if (rows.length){ const s = sh_(SH.plans); s.getRange(s.getLastRow() + 1, 1, rows.length, 6).setValues(rows); }
    return { n: rows.length };
  },
  /* ---- комплектовка и монтаж ---- */
  kitAdd(me, b){
    if (mountAt_(b.order)) throw new Error('Монтаж начат — список закрыт');
    const row = append_(SH.kit, [b.order, b.sec, b.name, b.qty ? "'" + b.qty : '', me.id, '', '']);
    if (b.toLib) append_(SH.lib, [b.sec, b.name]);
    return { row };
  },
  kitSet(me, b){ // qty / packed / del
    const s = sh_(SH.kit);
    if (b.del || b.qty !== undefined){ const ord = s.getRange(b.row, 1).getValue(); if (mountAt_(ord)) throw new Error('Монтаж начат — список закрыт'); }
    if (b.del) s.getRange(b.row, 7).setValue('да');
    if (b.qty !== undefined) s.getRange(b.row, 4).setValue(b.qty ? "'" + b.qty : '');
    if (b.packed !== undefined) s.getRange(b.row, 6).setValue(b.packed ? 'да' : '');
    return {};
  },
  kitPackAll(me, b){ const s = sh_(SH.kit); read_(SH.kit, 2, 7).forEach(r => { if (String(r[0]) === String(b.order) && r[6] !== 'да') s.getRange(r[7], 6).setValue(b.packed ? 'да' : ''); }); return {}; },
  mountStart(me, b){ const r = findOrderRow_(b.order); const at = now_(); sh_(SH.orders).getRange(r, ORD.mountAt + 1).setValue("'" + at); return { at }; },
  noteAdd(me, b){ append_(SH.notes, [now_(), b.order, me.id, b.text, b.next ? 'да' : '']); return { at: now_() }; },
  /* ---- руководитель: состав заказа и сроки ---- */
  /* ---- новый заказ из приложения: строка в «Заказах»; состав (группы) добавляется уже в карточке ---- */
  orderAdd: bossOnly_(function(me, b){ const id = String(b.id || '').trim(); if (!id) throw new Error('Впиши № заказа');
    const s = sh_(SH.orders), ids = s.getRange(1, 1, s.getLastRow(), 1).getDisplayValues().map(x => String(x[0]).trim());
    if (ids.indexOf(id) >= 0) throw new Error('Заказ № ' + id + ' уже есть');
    if (!String(b.client || '').trim()) throw new Error('Впиши клиента');
    const row = new Array(26).fill(''); const d = v => /^\d{4}-\d\d-\d\d$/.test(String(v || '')) ? v : '';
    row[ORD.id] = "'" + id; row[ORD.client] = String(b.client).trim(); row[ORD.product] = String(b.product || '').trim(); row[ORD.sys] = b.sys === 'm2' ? 'м²' : '%';
    row[ORD.kind] = String(b.kind || 'Кухни, комоды'); row[ORD.cost] = Math.round(+b.cost || 0) || ''; row[ORD.term] = b.hard ? 'жёсткий' : 'мягкий';
    row[ORD.ship] = d(b.ship); row[ORD.ceh] = d(b.ceh); row[ORD.done] = d(b.done); row[ORD.status] = 'в работе'; row[ORD.master] = String(b.master || '');
    if (b.sys !== 'm2' && +b.cost > 0) row[ORD.mat0] = Math.round(+b.cost);   // «Готовые плиты» на всю стоимость — по умолчанию, правится в составе
    s.appendRow(row); return { id }; }),
  orderSet: bossOnly_(function(me, b){ // b.col — номер колонки 1..24 (только разрешённые)
    const allowed = [ORD.ship + 1, ORD.ceh + 1, ORD.done + 1, ORD.off + 1, ORD.prisManual + 1, ORD.team + 1, ORD.status + 1, ORD.master + 1, ORD.shopPct + 1];
    for (let c = ORD.mat0 + 1; c <= ORD.mat0 + 9; c++) allowed.push(c);
    if (allowed.indexOf(+b.col) < 0) throw new Error('Колонка не редактируется из приложения');
    const r = findOrderRow_(b.order), v = b.value;
    sh_(SH.orders).getRange(r, +b.col).setValue(v); return {};
  }),
  /* ---- закупка: добавляют все, статус ведёт руководитель / администратор ---- */
  buyAdd(me, b){ const n = String(b.name || '').trim(); if (!n) throw new Error('Впиши позицию');
    const cat = sh_(SH.buyCat); if (cat && !read_(SH.buyCat, 2, 1).some(r => String(r[0]).trim().toLowerCase() === n.toLowerCase())) cat.appendRow([n, '', 'добавлено из приложения']);
    const row = append_(SH.buy, [now_(), me.id, b.order || '', b.name, b.qty ? "'" + b.qty : '', 'нужно', now_(), me.id]);
    if (!me.boss) bossTgs_('buy_new').forEach(t => tg_('sendMessage', { chat_id: t, text: 'Закупка: ' + n + (b.qty ? ' × ' + b.qty : '') + (b.order ? ' (заказ ' + b.order + ')' : '') + ' — добавил ' + me.name + '.',
      reply_markup: { inline_keyboard: [[{ text: '☐ Куплено', callback_data: 'b:' + row + ':g' }], [{ text: 'Весь список', callback_data: 'list' }]] } }));
    return { row }; },
  buySet: bossOnly_(function(me, b){
    const ok = ['нужно', 'заказано', 'получено', 'отменено']; if (ok.indexOf(b.status) < 0) throw new Error('Неизвестный статус');
    const s = sh_(SH.buy); s.getRange(b.row, 6, 1, 3).setValues([[b.status, now_(), me.id]]);
    return {}; }),
  /* ---- назначение задач: руководитель, администратор или мастер заказа ---- */
  taskAssign(me, b){ canAssign_(me, b.order); return { row: append_(SH.tasks, [b.order, b.op, b.who, b.due || '', 'назначил ' + me.id]) }; },
  taskUnassign(me, b){ const s = sh_(SH.tasks), ord = s.getRange(b.row, 1).getDisplayValue(); canAssign_(me, ord); s.getRange(b.row, 1, 1, 5).clearContent(); return {}; },
  /* ---- деньги: аванс просит сотрудник, выдаёт руководитель / администратор; зарплата — по закрытым заказам ---- */
  payRequest(me, b){ const a = Math.round(+b.amount || 0); if (!(a > 0)) throw new Error('Впиши сумму');
    if (read_(SH.pays, 2, 8).some(r => String(r[1]) === me.id && r[4] === 'запрос')) throw new Error('Предыдущий запрос ещё не рассмотрен');
    const row = append_(SH.pays, [now_(), me.id, 'аванс', a, 'запрос', '', '', String(b.note || '')]);
    notifyBosses_('adv', 'Запрос аванса: ' + me.name + ' — ' + a + ' ₾' + (b.note ? ' (' + b.note + ')' : '') + '. Решение — в «Людях».');
    return { row }; },
  payCancel(me, b){ const s = sh_(SH.pays), r = s.getRange(b.row, 1, 1, 8).getValues()[0];
    if (String(r[1]) !== me.id || r[4] !== 'запрос') throw new Error('Отменить можно только свой нерассмотренный запрос');
    s.getRange(b.row, 5, 1, 3).setValues([['отменён', me.id, now_()]]); return {}; },
  payDecide: bossOnly_(function(me, b){ const ok = ['выдано', 'отклонено']; if (ok.indexOf(b.status) < 0) throw new Error('Неизвестное решение');
    const s = sh_(SH.pays), r = s.getRange(b.row, 1, 1, 8).getValues()[0]; if (r[4] !== 'запрос') throw new Error('Запрос уже рассмотрен');
    s.getRange(b.row, 5, 1, 3).setValues([[b.status, me.id, now_()]]);
    notifyOne_(String(r[1]), b.status === 'выдано' ? 'Аванс ' + r[3] + ' ₾ выдан.' : 'Запрос аванса ' + r[3] + ' ₾ отклонён.', 'pay_info'); return {}; }),
  payAdd: bossOnly_(function(me, b){ const a = Math.round(+b.amount || 0); if (!(a > 0)) throw new Error('Впиши сумму');
    const type = b.type === 'аванс' ? 'аванс' : 'зарплата';
    const row = append_(SH.pays, [now_(), b.who, type, a, 'выдано', me.id, now_(), String(b.note || ''), b.order ? "'" + b.order : '']);
    notifyOne_(String(b.who), (type === 'аванс' ? 'Выдан аванс ' : 'Выплачена зарплата ') + a + ' ₾.', 'pay_info'); return { row }; }),
  /* ---- доделки: хвосты, «взять с собой», гарантия — по любому заказу, в т.ч. сданному; оплата — отметкой на исполнителя при «сделано» ---- */
  fixAdd(me, b){ const t = String(b.text || '').trim(); if (!t) throw new Error('Впиши, что сделать'); if (!String(b.order || '').trim()) throw new Error('Нет заказа');
    const type = ['хвост', 'взять', 'гарантия'].indexOf(b.type) >= 0 ? b.type : 'хвост', who = me.boss ? String(b.who || '') : '', pay = me.boss ? Math.max(0, Math.round(+b.pay || 0)) : 0;
    const row = append_(fixSh_(), [now_(), "'" + String(b.order).trim(), me.id, t, type, 'открыта', '', '', who, pay || '', '']);
    if (who && who !== me.id) notifyOne_(who, '🔧 Доделка' + (pay ? ' · ' + pay + ' ₾' : '') + ': ' + t + ' · заказ ' + b.order + '.', 'fix_info'); return { row }; },
  fixEdit: bossOnly_(function(me, b){ const s = sh_(SH.fix), r = s.getRange(+b.row, 1, 1, 11).getValues()[0]; if (r[5] !== 'открыта') throw new Error('Доделка уже закрыта');
    const who = String(b.who || ''), pay = Math.max(0, Math.round(+b.pay || 0)); s.getRange(+b.row, 9, 1, 2).setValues([[who, pay || '']]);
    if (who && who !== me.id && (who !== String(r[8]) || pay !== (+r[9] || 0))) notifyOne_(who, '🔧 Доделка' + (pay ? ' · ' + pay + ' ₾' : '') + ': ' + r[3] + ' · заказ ' + r[1] + '.', 'fix_info'); return {}; }),
  fixDone(me, b){ const s = sh_(SH.fix), r = s.getRange(+b.row, 1, 1, 11).getValues()[0]; if (r[5] !== 'открыта') return {};
    const pay = +r[9] || 0, who = String(r[8] || ''); let mk = '';
    if (pay > 0 && who) mk = append_(SH.marks, [now_(), who, "'" + String(r[1]).trim(), 'korpus', 'fix' + b.row, 'доделка: ' + String(r[3]).slice(0, 60), 100, pay, 0, '', '', '']);
    s.getRange(+b.row, 6, 1, 6).setValues([['сделана', now_(), me.id, who, pay || '', mk]]); return { mark: mk }; },
  fixUndo: bossOnly_(function(me, b){ const s = sh_(SH.fix), r = s.getRange(+b.row, 1, 1, 11).getValues()[0];
    if (r[10]) sh_(SH.marks).getRange(+r[10], 12).setValue('да');   // оплата снимается
    s.getRange(+b.row, 6, 1, 6).setValues([['открыта', '', '', r[8], r[9], '']]); return {}; }),
  fixDel: bossOnly_(function(me, b){ const s = sh_(SH.fix), r = s.getRange(+b.row, 1, 1, 11).getValues()[0]; if (r[10]) sh_(SH.marks).getRange(+r[10], 12).setValue('да');
    s.getRange(+b.row, 6).setValue('удалена'); return {}; }),
  /* премия по заказу — отдельная отметка «премия»: входит в заработок по этому заказу */
  bonusAdd: bossOnly_(function(me, b){ const a = Math.round(+b.amount || 0); if (!(a > 0)) throw new Error('Впиши сумму');
    const row = append_(SH.marks, [now_(), b.who, "'" + b.order, 'korpus', 'premia', 'премия', 100, a, 0, '', '', '']);
    notifyOne_(String(b.who), 'Премия ' + a + ' ₾ по заказу ' + b.order + '.', 'bonus_info'); return { row }; }),
  /* типы сообщений бота для руководителя / админа (свои настройки) — «Сотрудники», колонка J */
  /* свои уведомления: руководство — какие сообщения получать; все — какие напоминания выключить ('-код') */
  notifySet(me, b){ const pos = me.boss ? (b.types || []).filter(x => NTYPES_[x]) : [], neg = (b.types || []).filter(x => x[0] === '-' && ETYPES_[x.slice(1)]);
    const v = me.boss && !pos.length ? ['никаких'].concat(neg) : pos.concat(neg);
    const r = read_(SH.staff, 2, 1).find(x => String(x[0]) === me.id); sh_(SH.staff).getRange(r[1], 10).setValue(v.join(', ')); return {}; },
  payMode: bossOnly_(function(me, b){ const r = read_(SH.staff, 2, 1).find(x => String(x[0]) === String(b.who)); if (!r) throw new Error('Нет сотрудника');
    sh_(SH.staff).getRange(r[1], 9).setValue(b.mode === 'free' ? 'без лимита' : 'до заработанного'); return {}; }),
  /* ---- снимок отставания заказов (считает приложение) — утром бот пишет мастеру ---- */
  lagSnap(me, b){ const pr = PropertiesService.getScriptProperties(); pr.setProperty('LAG', JSON.stringify({ at: now_(), items: (b.items || []).slice(0, 30) })); return {}; },
  /* ---- карта навыков: руководитель выставляет уровни 0–3 прямо из приложения ---- */
  skillSet: bossOnly_(function(me, b){
    const lv = b.level === '' || b.level == null ? '' : +b.level; if (lv !== '' && !(lv >= 0 && lv <= 3)) throw new Error('Уровень 0–3');
    const s = sh_(SH.skills); if (!s) throw new Error('Нет листа «Навыки»');
    const k = skills_(), r = k.rows.find(x => x.code === b.code); if (!r) throw new Error('Нет навыка ' + b.code);
    let c = k.ids.indexOf(String(b.who));
    if (c < 0){ const st = read_(SH.staff, 2, 2).find(x => String(x[0]) === String(b.who)); if (!st) throw new Error('Нет сотрудника ' + b.who);
      c = k.ids.length; s.getRange(1, c + 3).setValue(st[1] + ' ' + b.who); }
    const cell = s.getRange(r.row, c + 3), old = cell.getValue(); cell.setValue(lv);
    if (String(old) !== String(lv)){ let lg = sh_(SH.skillLog); if (!lg){ lg = book_().insertSheet(SH.skillLog); lg.appendRow(['Дата', 'Сотрудник ID', 'Навык', 'Было', 'Стало', 'Кто изменил']); }
      lg.appendRow([now_(), String(b.who), b.code, old === '' ? '' : old, lv, me.id]); }   // история — для флага «без роста»
    cell.setBackground(lv === '' ? '#fcf2cc' : '#d1e6fa'); return {}; }),
  /* ---- план на завтра: задачи на день (лист «Задачи», пометка «план», срок = день плана) ---- */
  planTask(me, b){ const d = String(b.date || ''); if (!/^\d{4}-\d\d-\d\d$/.test(d) || d <= today_()) throw new Error('План — на завтра и дальше');
    const who = b.who && me.boss ? String(b.who) : me.id;
    if (read_(SH.tasks, 2, 5).some(r => String(r[0]).trim() === String(b.order) && String(r[1]).trim() === b.op && String(r[2]).trim() === who && String(r[3]).slice(0, 10) === d)) return {};
    return { row: append_(SH.tasks, ["'" + b.order, b.op, who, d, 'план ' + me.id]) }; },
  planUntask(me, b){ const s = sh_(SH.tasks), r = s.getRange(b.row, 1, 1, 5).getValues()[0];
    if (!me.boss && !(String(r[2]).trim() === me.id && String(r[4]).indexOf('план') === 0)) throw new Error('Эту задачу поставил руководитель — снять может он');
    s.getRange(b.row, 1, 1, 5).clearContent(); return {}; },
  extraAdd: bossOnly_(function(me, b){ return { row: append_(SH.extras, [b.order, b.grp, b.name, b.pct === null || b.pct === '' ? '' : +b.pct, '']) }; }),
  extraDel: bossOnly_(function(me, b){ sh_(SH.extras).getRange(b.row, 1, 1, 5).clearContent(); return {}; })
};

/* ============ BLOCK: DOMAIN HELPERS ============ */
// лист «Навыки»: колонки C… — сотрудники («Имя ID»), строки — навыки с кодом в колонке B
function skills_(){ const s = sh_(SH.skills); if (!s) return null;
  const lr = s.getLastRow(), lc = s.getLastColumn(); if (lr < 1 || lc < 3) return { ids: [], rows: [] };
  const v = s.getRange(1, 1, lr, lc).getValues();
  const ids = v[0].slice(2).map(h => (String(h).trim().match(/(\S+)$/) || ['', ''])[1]);
  const rows = []; for (let i = 1; i < v.length; i++){ const code = String(v[i][1]).trim();
    if (/^[a-z_]+$/.test(code)) rows.push({ name: String(v[i][0]), code, vals: v[i].slice(2).map(x => x === '' || x === null ? '' : +x), row: i + 1 }); }
  return { ids, rows }; }
// отрезки смены: колонка L «08:10–12:00, 13:00–»; у старых строк — по «Пришёл/Ушёл»
function segs_(r){ const L = String(r[11] || '').trim();
  if (L) return L.split(',').map(x => { const p = x.trim().split('–'); return { s: p[0], e: p[1] || '' }; });
  return [{ s: String(r[2]), e: r[3] ? String(r[3]) : '' }]; }
function segStr_(g){ return g.map(x => x.s + '–' + x.e).join(', '); }
function segMin_(g, now){ return g.reduce((a, x) => { const e = x.e || now; if (!e) return a; let m = toMin_(e) - toMin_(x.s); if (m < 0) m += 1440; return a + m; }, 0); }
function toMin_(s){ const p = String(s).split(':').map(Number); return p[0] * 60 + (p[1] || 0); }
function latestPlan_(who, date){
  let best = null; read_(SH.plans, 2, 6).forEach(r => { if (String(r[0]).slice(0, 10) === date && String(r[1]) === who) best = r; });
  if (!best || best[4] === 'очищено') return null; return { at: String(best[2]), off: best[3] === 'да', reason: best[4] };
}
function canEditPlan_(d){ const p = params_(), t = today_();
  const diff = dayDiff_(d, t); return diff > 1 || (diff === 1 && toMin_(hm_()) < toMin_(p.planTo)); }
function tookTask_(id, order, op){ order = String(order).trim(); let took = false;
  read_(SH.takes, 2, 5).forEach(r => { if (String(r[1]) !== id || String(r[2]).trim() !== order || String(r[3]).trim() !== op) return; const a = String(r[4]); if (a === 'взял') took = true; else if (a === 'отменил') took = false; });
  if (!took) took = read_(SH.tasks, 2, 5).some(r => String(r[0]).trim() === order && String(r[1]).trim() === op && String(r[2]).trim() === id);
  return took; }
function stopWork_(who, endAt){ const s = sh_(SH.time); if (!s) return; let now = new Date(), endS = now_();   // endAt 'HH:mm' сегодня — остановить задним числом (не позже «сейчас»)
  if (endAt){ const e = utcMs_(today_() + ' ' + endAt); if (e < now.getTime()){ now = new Date(e); endS = today_() + ' ' + endAt; } }
  let hit = false; read_(SH.time, 2, 6).forEach(r => { if (String(r[1]) === who && !r[4]){ hit = true; const st = utcMs_(r[0]); if (st > now.getTime()){ s.getRange(r[6], 5, 1, 2).setValues([[cell_(r[0]), 0]]); return; } s.getRange(r[6], 5, 1, 2).setValues([[endS, Math.max(0, Math.round((now - st) / 6e4))]]); } }); if (hit) msgDrop_(who); }
function utcMs_(s){ const p = String(s).split(/[- :]/).map(Number); return Date.UTC(p[0], p[1] - 1, p[2], p[3] || 0, p[4] || 0) - 4 * 3600e3; }   // время таблицы — Тбилиси (UTC+4)
function canAssign_(me, order){ if (me.boss) return;
  const m = sh_(SH.orders).getRange(findOrderRow_(order), ORD.master + 1).getDisplayValue().trim();
  if (m !== me.id) throw new Error('Назначать задачи может руководитель или мастер заказа'); }
function notifyBuy_(r){ // получено → тем, кто добавил позицию, и тем, кто работает по заказу
  const ids = {}; ids[String(r[1])] = 1; const ord = String(r[2]).trim();
  if (ord){ read_(SH.takes, 2, 5).forEach(x => { if (String(x[2]).trim() === ord) ids[String(x[1])] = 1; });
    read_(SH.tasks, 2, 5).forEach(x => { if (String(x[0]).trim() === ord && x[2]) ids[String(x[2]).trim()] = 1; }); }
  const text = 'Получено: ' + r[3] + (r[4] ? ' × ' + r[4] : '') + (ord ? ' · заказ ' + ord : '');
  staffTg_().filter(x => ids[x.id] && empOn_(x.id, 'buy_got')).forEach(x => { try { send_(x.tg, text); } catch (e) {} }); }
function mountAt_(order){ try { return sh_(SH.orders).getRange(findOrderRow_(order), ORD.mountAt + 1).getDisplayValue(); } catch (e){ return ''; } }

/* ============ BLOCK: TELEGRAM BOT ============ */
function tg_(method, payload){
  const r = UrlFetchApp.fetch('https://api.telegram.org/bot' + token_() + '/' + method, { method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true });
  return JSON.parse(r.getContentText());
}
/* триггеры ставятся сами при первом запуске новой версии (без ручного setup) */
function ensureTriggers_(){ const pr = PropertiesService.getScriptProperties(); if (pr.getProperty('TRG') === 'v3') return;
  try { const has = n => ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === n);
    if (!has('remindMorning930')){ const m = toMin_(params_().remindBuy);
      ScriptApp.newTrigger('remindMorning930').timeBased().atHour(Math.floor(m / 60)).nearMinute(m % 60).everyDays(1).inTimezone(TZ).create(); }
    if (!has('checkTimers')) ScriptApp.newTrigger('checkTimers').timeBased().everyMinutes(15).create();
    pr.setProperty('TRG', 'v3'); } catch (e) {} }
/* свой таймер: время вышло — один вопрос в бот (Время: H — план, мин; I — когда спросили) */
function checkTimers(){ const s = sh_(SH.time); if (!s) return; const now = Date.now();
  read_(SH.time, 2, 9).forEach(r => { const pl = +r[7] || 0; if (r[4] || !pl || r[8]) return; const el = (now - utcMs_(r[0])) / 6e4; if (el < pl) return;
    const st = staffById_(r[1]); s.getRange(r[9], 9).setValue(now_()); if (!st || !st[3]) return;
    const o = read_(SH.orders, 2, 3).find(x => String(x[0]).trim() === String(r[2]).trim()), lbl = (o ? o[1] + ' · ' + o[2] + ' · ' : '') + opName_(r[2], r[3]);
    const h = Math.floor(el / 60), m = Math.round(el % 60);
    const q = tg_('sendMessage', { chat_id: String(st[3]), text: '⏱ ' + lbl + '\nПрошло ' + (h ? h + ' ч ' : '') + (m ? m + ' мин' : '') + ' — продолжаешь?',
      reply_markup: { inline_keyboard: [[{ text: '+30 мин', callback_data: 'tx:30:' + r[9] }, { text: '+1 ч', callback_data: 'tx:60:' + r[9] }, { text: '+2 ч', callback_data: 'tx:120:' + r[9] }], [{ text: '⏸ Пауза', callback_data: 'p' }]] } });
    if (q && q.ok) msgKeep_('TQ_' + st[0], st[3], q.result.message_id); }); }
/* сообщения бота с кнопками для идущей задачи (вопрос таймера, «Пора») — после паузы/закрытия кнопки снимаются */
function msgKeep_(key, chat, id){ try { const pr = PropertiesService.getScriptProperties(); let a = []; try { a = JSON.parse(pr.getProperty(key) || '[]'); } catch (e) {}
  a.push({ c: String(chat), id }); pr.setProperty(key, JSON.stringify(a.slice(-10))); } catch (e) {} }
function msgDrop_(who){ try { const pr = PropertiesService.getScriptProperties(); ['TQ_' + who].forEach(key => { const v = pr.getProperty(key); if (!v) return; pr.deleteProperty(key);
  JSON.parse(v).forEach(x => tg_('editMessageReplyMarkup', { chat_id: x.c, message_id: x.id, reply_markup: { inline_keyboard: [] } })); }); } catch (e) {} }
/* ===== BLOCK: START PING — отложенный старт: напоминание точно ко времени (Время: J «Напомнить о старте» = ждёт/отправлено) ===== */
function pingAt_(at){ try { const has = ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'startPing').length;
  if (has < 5) ScriptApp.newTrigger('startPing').timeBased().at(new Date(at.getTime() + 20e3)).create(); } catch (e) {} }
function startPing(){ const s = sh_(SH.time); if (!s) return; const now = Date.now(); let next = 0;
  read_(SH.time, 2, 10).forEach(r => { if (r[9] !== 'ждёт' || r[4]) return; const st = utcMs_(r[0]);
    if (st > now + 60e3){ next = next ? Math.min(next, st) : st; return; }
    s.getRange(r[10], 10).setValue('отправлено'); const p = staffById_(r[1]); if (!p || !p[3]) return;
    const o = read_(SH.orders, 2, 3).find(x => String(x[0]).trim() === String(r[2]).trim());
    const q = tg_('sendMessage', { chat_id: String(p[3]), text: '▶ Пора: ' + (o ? o[1] + ' · ' + o[2] + ' · ' : '') + opName_(r[2], r[3]) + '\nВремя пошло.', reply_markup: { inline_keyboard: [[{ text: '⏸ Пауза', callback_data: 'p' }]] } });
    if (q && q.ok) msgKeep_('TQ_' + p[0], p[3], q.result.message_id); });
  try { ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'startPing').forEach(t => ScriptApp.deleteTrigger(t)); } catch (e) {}
  if (next) pingAt_(new Date(next)); }
/* ===== END BLOCK: START PING ===== */
/* утро: закупка, если список не закрыт; отставание заказов — мастеру (нет мастера — руководству) */
function remindMorning930(){
  const need = read_(SH.buy, 2, 8).filter(r => r[5] === 'нужно');
  if (need.length) bossTgs_('buy_morning').forEach(t => sendBuyList_(t, 'Закупка не закрыта'));
  let lag = null; try { lag = JSON.parse(PropertiesService.getScriptProperties().getProperty('LAG') || 'null'); } catch (e) {}
  if (!lag || !lag.items) return; const orders = read_(SH.orders, 2, 26);
  lag.items.filter(x => x.cls === 'bad').forEach(x => { const o = orders.find(r => String(r[0]).trim() === x.order); if (!o || String(o[11]).trim() === 'сдан') return;
    const txt = 'Заказ ' + x.label + ' отстаёт: ' + x.txt + ' до «' + x.dl + '» ' + x.date + '.';
    const m = String(o[24] || '').trim(), mBoss = m && isBoss_(m);
    if (m && !mBoss){ if (String(params_().lagMaster).trim() === 'да') notifyOne_(m, txt, 'lag_master'); } else if (m) { if (wants_(m, 'lag')) notifyOne_(m, txt); } else notifyBosses_('lag', txt); }); }
/* ============ BLOCK: BOT (вебхук: закупка галками в чате) ============ */
function tgSecret_(){ const pr = PropertiesService.getScriptProperties(); let s = pr.getProperty('TG_SECRET'); if (!s){ s = Utilities.getUuid().replace(/-/g, ''); pr.setProperty('TG_SECRET', s); } return s; }
function ensureWebhook_(){ const pr = PropertiesService.getScriptProperties(); if (pr.getProperty('HOOK') === 'v1') return;
  try { const url = ScriptApp.getService().getUrl(); if (!url || !/\/exec$/.test(url)) return;
    const r = tg_('setWebhook', { url: url + '?tg=' + tgSecret_(), allowed_updates: ['message', 'callback_query'], drop_pending_updates: true });
    if (r && r.ok) pr.setProperty('HOOK', 'v1'); } catch (e) {} }
/* типы сообщений руководству; пусто в колонке J — набор по умолчанию */
const NTYPES_ = { arrive: 'Пришёл / вернулся сотрудник', arrive_plan: 'К приходу — план и опоздание', leave: 'Ушёл сотрудник (итог дня)', buy_new: 'Новая закупка — сразу', buy_morning: 'Список закупки утром',
  adv: 'Запрос аванса', ask: 'Просится помощником', lag: 'Заказ отстаёт от срока' };
const NDEF_ = ['arrive', 'buy_new', 'buy_morning', 'adv', 'ask'];
function subsOf_(v){ v = String(v || '').trim(); if (!v) return NDEF_.slice(); return v.split(',').map(x => x.trim()).filter(Boolean); }
/* напоминания сотруднику: включены, пока не выключил сам */
const ETYPES_ = { plan_remind: 'Напоминание о плане на завтра', close_remind: 'Напоминание закрыть смену', morning_remind: 'Незакрытая вчерашняя смена', task_msg: '«Мои задачи» в чате бота',
  pay_info: 'Аванс и выплаты', bonus_info: 'Премии', splash: 'Пиздюли по утрам', ask_me: 'Просятся ко мне помощником', fix_info: 'Мне назначили доделку', lag_master: 'Мой заказ отстаёт (я мастер)' };
function empOn_(id, type){ const r = read_(SH.staff, 2, 10).find(x => String(x[0]) === String(id)); return !r || String(r[9] || '').split(',').map(x => x.trim()).indexOf('-' + type) < 0; }
function isBoss_(id){ const r = read_(SH.staff, 2, 5).find(x => String(x[0]) === String(id)); return !!r && BOSS_ROLES.indexOf(String(r[4]).trim()) >= 0; }
function wants_(id, type){ const r = read_(SH.staff, 2, 10).find(x => String(x[0]) === String(id)); return !!r && subsOf_(r[9]).indexOf(type) >= 0; }
function bossTgs_(type){ const ids = read_(SH.staff, 2, 10).filter(r => BOSS_ROLES.indexOf(String(r[4]).trim()) >= 0 && (!type || subsOf_(r[9]).indexOf(type) >= 0)).map(r => String(r[0]));
  return staffTg_().filter(x => ids.indexOf(x.id) >= 0).map(x => x.tg); }
function bossByTg_(tgId){ return read_(SH.staff, 2, 7).find(r => String(r[3]) === String(tgId) && BOSS_ROLES.indexOf(String(r[4]).trim()) >= 0 && String(r[6]).trim() !== 'нет'); }
/* кнопка позиции: «☐ Название — 6 шт»; подробно — + заказ. Без единицы в кол-ве — «шт» */
function qtyU_(q){ q = String(q || '').trim(); if (!q) return ''; return /[a-zа-я²]/i.test(q) ? q : q + ' шт'; }
function buyBtn_(r, det){ const got = r[5] === 'получено', ord = String(r[2]).trim(), q = qtyU_(r[4]);
  return [{ text: (got ? '✅ ' : '☐ ') + r[3] + (q ? ' — ' + q : '') + (det && ord ? ' · ' + ord : ''), callback_data: 'b:' + r[8] + ':' + (got ? 'n' : 'g') }]; }
function buyKb_(rows, det){ return { inline_keyboard: rows.map(r => buyBtn_(r, det)).concat([[{ text: 'Обновить список', callback_data: 'list' }, { text: det ? 'Кратко' : 'Подробнее', callback_data: det ? 'mc' : 'md' }]]) }; }
function esc_(t){ return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function buyText_(rows, title){ const left = rows.filter(r => r[5] !== 'получено').length;
  return '<b>' + esc_(title || 'Закупка') + '</b> — ' + (left ? 'осталось ' + left + ' из ' + rows.length : 'всё куплено ✅'); }
function sendBuyList_(chatId, title, det){ const need = read_(SH.buy, 2, 8).filter(r => r[5] === 'нужно' || r[5] === 'заказано').slice(0, 40);
  if (!need.length) return tg_('sendMessage', { chat_id: chatId, text: 'Закупка закрыта ✅' });
  return tg_('sendMessage', { chat_id: chatId, text: buyText_(need, title), parse_mode: 'HTML', reply_markup: buyKb_(need, det) }); }
function buyRowsFromKb_(kb){ const all = read_(SH.buy, 2, 8);
  return [].concat.apply([], kb).map(b => { const mm = String(b.callback_data || '').match(/^b:(\d+):/); return mm ? all.find(x => x[8] === +mm[1]) : null; }).filter(Boolean); }
function handleTg_(u){
  if (u.callback_query && /^(w:|p$|t$)/.test(String(u.callback_query.data || ''))){ taskTap_(u.callback_query); return; }
  if (u.callback_query && /^tx:/.test(String(u.callback_query.data || ''))){ const q = u.callback_query, m = String(q.data).match(/^tx:(\d+):(\d+)$/), s = sh_(SH.time);
    const r = m ? s.getRange(+m[2], 1, 1, 9).getValues()[0] : null, st = read_(SH.staff, 2, 7).find(x => String(x[3]) === String(q.from.id));
    if (!r || !st || String(r[1]) !== String(st[0]) || r[4]){ tg_('answerCallbackQuery', { callback_query_id: q.id, text: 'Счётчик уже остановлен' }); return; }
    const el = (Date.now() - utcMs_(cell_(r[0]))) / 6e4; s.getRange(+m[2], 8, 1, 2).setValues([[Math.round(el) + +m[1], '']]);   // новый срок от текущего момента
    tg_('answerCallbackQuery', { callback_query_id: q.id, text: 'Ок, спрошу через ' + (+m[1] >= 60 ? (+m[1] / 60) + ' ч' : m[1] + ' мин') });
    tg_('editMessageReplyMarkup', { chat_id: q.message.chat.id, message_id: q.message.message_id, reply_markup: { inline_keyboard: [] } }); return; }
  if (u.callback_query){ const q = u.callback_query, boss = bossByTg_(q.from.id), d = String(q.data || '');
    if (!boss){ tg_('answerCallbackQuery', { callback_query_id: q.id, text: 'Только для руководителя' }); return; }
    if (d === 'list'){ tg_('answerCallbackQuery', { callback_query_id: q.id }); sendBuyList_(q.message.chat.id); return; }
    if (d === 'md' || d === 'mc'){ tg_('answerCallbackQuery', { callback_query_id: q.id }); const rows = buyRowsFromKb_((q.message.reply_markup || {}).inline_keyboard || []);
      if (rows.length) tg_('editMessageText', { chat_id: q.message.chat.id, message_id: q.message.message_id, text: buyText_(rows, String(q.message.text || '').split(' — ')[0]), parse_mode: 'HTML', reply_markup: buyKb_(rows, d === 'md') });
      return; }
    const m = d.match(/^b:(\d+):([gn])$/); if (!m){ tg_('answerCallbackQuery', { callback_query_id: q.id }); return; }
    const s = sh_(SH.buy), row = +m[1], r = s.getRange(row, 1, 1, 8).getValues()[0], st = m[2] === 'g' ? 'получено' : 'нужно';
    if (r[5] !== st && r[3]){ s.getRange(row, 6, 1, 3).setValues([[st, now_(), String(boss[0])]]); }   // повтор того же нажатия ничего не меняет
    tg_('answerCallbackQuery', { callback_query_id: q.id, text: (st === 'получено' ? '✅ Куплено: ' : 'Вернул в список: ') + r[3] });
    const kb = (q.message.reply_markup && q.message.reply_markup.inline_keyboard) || [], rows = buyRowsFromKb_(kb);   // перерисовать по таблице
    const det = kb.some(rw => rw.some(b => b.callback_data === 'mc'));   // сейчас открыт подробный вид
    const single = !kb.some(rw => rw.some(b => b.callback_data === 'list' && b.text === 'Обновить список'));   // одиночное сообщение о новой закупке
    if (single && rows.length) tg_('editMessageReplyMarkup', { chat_id: q.message.chat.id, message_id: q.message.message_id, reply_markup: { inline_keyboard: rows.map(r => buyBtn_(r)).concat([[{ text: 'Весь список', callback_data: 'list' }]]) } });
    else if (rows.length){ const title = String(q.message.text || '').split(' — ')[0] || 'Закупка';
      tg_('editMessageText', { chat_id: q.message.chat.id, message_id: q.message.message_id, text: buyText_(rows, title), parse_mode: 'HTML', reply_markup: buyKb_(rows, det) }); }
    return; }
  const msg = u.message; if (!msg || !msg.text) return; const t = msg.text.trim().toLowerCase();
  if (t === '/start' || t === '/buy' || t === 'закупка' || t === '/закупка'){
    if (bossByTg_(msg.from.id)) sendBuyList_(msg.chat.id); else tg_('sendMessage', { chat_id: msg.chat.id, text: 'Открой Akrix Job кнопкой меню внизу чата.' }); }
}
/* ============ BLOCK: «МОИ ЗАДАЧИ» — закреплённое сообщение бота с ▶ / ⏸ (в стиле списка закупки) ============ */
function staffById_(id){ return read_(SH.staff, 2, 7).find(r => String(r[0]) === String(id)); }
function opName_(order, key){ const p = String(key).split('.'), grp = p[0], code = p[1]; if (code === 'sborka_obj') return 'Сборка на объекте';
  if (/^x\d+$/.test(code)){ const ex = sh_(SH.extras); try { return String(ex.getRange(+code.slice(1), 3).getValue()) || code; } catch (e) { return code; } }
  const r = read_(SH.ops, 2, 6).find(x => String(x[1]).trim() === grp && String(x[4]).trim() === code); return r ? String(r[5]) : code; }
function myTasks_(id){ const t = today_(), keys = {}, add = (o, op) => { o = String(o).trim(); op = String(op).trim(); if (o && op) keys[o + '|' + op] = 1; };
  read_(SH.tasks, 2, 5).forEach(r => { if (String(r[2]).trim() !== id) return; if (String(r[4] || '').indexOf('план') === 0 && String(r[3]).slice(0, 10) > t) return; add(r[0], r[1]); });
  const last = {}; read_(SH.takes, 2, 5).forEach(r => { const a = String(r[4]); if (a.indexOf('доли ') === 0 || String(r[1]) !== id) return; last[String(r[2]).trim() + '|' + String(r[3]).trim()] = a; });
  Object.keys(last).forEach(k => { const a = last[k]; if (a === 'взял' || a.indexOf('подключ') === 0) keys[k] = 1; else if (a === 'отменил' || a.indexOf('отключ') === 0) delete keys[k]; });
  const done = {}; read_(SH.marks, 2, 12).forEach(r => { if (r[11] === 'да') return; const k = String(r[2]).trim() + '|' + String(r[3]).trim() + '.' + String(r[4]).trim(); done[k] = (done[k] || 0) + (+String(r[6]).replace(',', '.') || 0); });
  const ord = {}; read_(SH.orders, 2, 3).forEach(r => ord[String(r[0]).trim()] = r);
  const st = {}; read_(SH.orders, 2, 12).forEach(r => st[String(r[0]).trim()] = String(r[11]).trim());
  return Object.keys(keys).filter(k => (done[k] || 0) < 99.5 && ord[k.split('|')[0]] && st[k.split('|')[0]] !== 'сдан').map(k => { const p = k.split('|'), o = ord[p[0]];
    return { order: p[0], op: p[1], label: String(o[1]) + ' · ' + String(o[2]) + ' · ' + opName_(p[0], p[1]) }; }); }
function runningOf_(id){ const r = read_(SH.time, 2, 6).filter(x => String(x[1]) === id && !x[4]).pop(); return r ? { order: String(r[2]).trim(), op: String(r[3]).trim(), start: String(r[0]).slice(11, 16) } : null; }
function onShift_(id){ const t = today_(); return read_(SH.shifts, 2, 10).some(r => String(r[0]).slice(0, 10) === t && String(r[1]) === id && !r[3]); }
function taskView_(id){ const list = myTasks_(id), run = runningOf_(id);
  const cur = run ? list.find(x => x.order === run.order && x.op === run.op) : null;
  const text = '<b>Мои задачи</b>' + (cur ? ' — 🟢 идёт с ' + run.start + ', нажми её для паузы' : list.length ? ' — нажми ▶, чтобы начать' : ' — задач нет');
  const kb = list.slice(0, 20).map(x => { const on = cur === x, cb = (on ? 'p' : 'w:' + x.order + '|' + x.op);
    return [{ text: (on ? '🟢 ' : '▶ ') + x.label, callback_data: Utilities.newBlob(cb).getBytes().length <= 64 ? cb : 't' }]; });
  kb.push([{ text: 'Открыть Akrix Job', web_app: { url: appUrl_() } }]); return { text, kb }; }
function taskMsg_(id, create){ try { const st = staffById_(id); if (!st || !st[3]) return; if (create && !empOn_(id, 'task_msg')) return; const chat = String(st[3]), pr = PropertiesService.getScriptProperties(), key = 'TM_' + id;
    const v = taskView_(id); let m = null; try { m = JSON.parse(pr.getProperty(key) || 'null'); } catch (e) {}
    if (m && m.d !== today_() && create){ taskMsgClose_(id); m = null; }   // вчерашнее закреплённое — закрыть, сегодня новое
    if (m){ const r = tg_('editMessageText', { chat_id: chat, message_id: m.id, text: v.text, parse_mode: 'HTML', reply_markup: { inline_keyboard: v.kb } });
      if (r && (r.ok || /not modified/.test(r.description || ''))) return; if (!create) return; }
    if (!create) return;
    const r = tg_('sendMessage', { chat_id: chat, text: v.text, parse_mode: 'HTML', reply_markup: { inline_keyboard: v.kb }, disable_notification: true });
    if (r && r.ok){ pr.setProperty(key, JSON.stringify({ id: r.result.message_id, d: today_() })); tg_('pinChatMessage', { chat_id: chat, message_id: r.result.message_id, disable_notification: true }); } } catch (e) {} }
function taskMsgClose_(id){ try { const st = staffById_(id); if (!st || !st[3]) return; const pr = PropertiesService.getScriptProperties(), key = 'TM_' + id; let m = null; try { m = JSON.parse(pr.getProperty(key) || 'null'); } catch (e) {}
    if (!m) return; tg_('editMessageText', { chat_id: String(st[3]), message_id: m.id, text: '<b>Мои задачи</b> — смена закрыта', parse_mode: 'HTML' });
    tg_('unpinChatMessage', { chat_id: String(st[3]), message_id: m.id }); pr.deleteProperty(key); } catch (e) {} }
function taskTap_(q){ const st = read_(SH.staff, 2, 7).find(r => String(r[3]) === String(q.from.id) && String(r[6]).trim() !== 'нет'), d = String(q.data);
  if (!st){ tg_('answerCallbackQuery', { callback_query_id: q.id, text: 'Нет доступа' }); return; } const id = String(st[0]);
  if (d === 't'){ tg_('answerCallbackQuery', { callback_query_id: q.id, text: 'Эту задачу запусти в приложении' }); return; }
  if (d === 'p'){ stopWork_(id); tg_('answerCallbackQuery', { callback_query_id: q.id, text: 'Пауза' }); taskMsg_(id); return; }
  if (!onShift_(id)){ tg_('answerCallbackQuery', { callback_query_id: q.id, text: 'Сначала начни смену в приложении', show_alert: true }); return; }
  const p = d.slice(2).split('|'), run = runningOf_(id);
  if (!(run && run.order === p[0] && run.op === p[1])){ stopWork_(id); append_(SH.time, [now_(), id, p[0], p[1], '', '']); }   // повтор нажатия — без второго запуска
  tg_('answerCallbackQuery', { callback_query_id: q.id, text: '▶ Приступил' }); taskMsg_(id); }
function notifyBosses_(type, text){ const rows = read_(SH.staff, 2, 10).filter(r => BOSS_ROLES.indexOf(String(r[4]).trim()) >= 0 && subsOf_(r[9]).indexOf(type) >= 0), subs = {};
  rows.forEach(r => subs[String(r[0])] = subsOf_(r[9])); const ids = rows.map(r => String(r[0]));
  if (typeof text === 'function'){ staffTg_().filter(x => ids.indexOf(x.id) >= 0).forEach(x => send_(x.tg, text(subs[x.id]), 'Открыть')); return; }
  staffTg_().filter(x => ids.indexOf(x.id) >= 0).forEach(x => send_(x.tg, text, 'Открыть')); }
function fixSh_(){ if (!sh_(SH.fix)){ const s = book_().insertSheet(SH.fix); s.appendRow(['Создана', 'Заказ', 'Кто добавил', 'Что сделать', 'Тип', 'Статус', 'Сделана', 'Кто отметил', 'Исполнитель', 'Оплата, ₾', 'Строка отметки']); } return SH.fix; }
function notifyOne_(id, text, type){ if (type && !empOn_(id, type)) return; const x = staffTg_().find(y => y.id === id); if (x) send_(x.tg, text, 'Открыть'); }
/* сотрудникам — со звуком только на смене; вне смены сообщение приходит беззвучно. Руководству и админам — всегда со звуком */
let QUIET_ = null;
function quiet_(chatId){ if (!QUIET_){ const t = today_(), on = {}; QUIET_ = {};
    read_(SH.shifts, 2, 10).forEach(r => { if (String(r[0]).slice(0, 10) === t && !r[3]) on[String(r[1])] = 1; });
    read_(SH.staff, 2, 5).forEach(r => { if (r[3]) QUIET_[String(r[3])] = BOSS_ROLES.indexOf(String(r[4]).trim()) < 0 && !on[String(r[0])]; }); }
  return !!QUIET_[String(chatId)]; }
function send_(chatId, text, btn){ // btn: 'Текст' или [['Текст', 'go-параметр'], …]
  const p = { chat_id: chatId, text }; if (quiet_(chatId)) p.disable_notification = true;
  const list = !btn ? [] : Array.isArray(btn) ? btn : [[btn, '']];
  if (list.length) p.reply_markup = { inline_keyboard: list.map(x => [{ text: x[0], web_app: { url: appUrl_() + (x[1] ? '&go=' + x[1] : '') } }]) };
  return tg_('sendMessage', p);
}
function staffTg_(){ // кому бот пишет: есть Telegram ID, активен, уведомления не выключены (колонка H)
  return read_(SH.staff, 2, 8).filter(r => r[3] && String(r[6]).trim() !== 'нет' && String(r[7]).trim() !== 'нет').map(r => ({ id: String(r[0]), tg: String(r[3]), boss: String(r[4]).trim() === 'руководитель' })); }
const DAYS_ = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
function isWorkday_(iso){ const off = params_().dayOff.toLowerCase(); return off.indexOf(DAYS_[utc_(iso).getUTCDay()]) < 0; }

/* напоминание: план на завтра не указан */
function remindPlan(){
  const d = addDays_(today_(), 1), to = params_().planTo; if (!isWorkday_(d)) return;
  staffTg_().filter(x => !x.boss && empOn_(x.id, 'plan_remind')).forEach(x => { if (!latestPlan_(x.id, d)) send_(x.tg, 'План на завтра не указан: во сколько выходишь и какие задачи берёшь. Указать до ' + to + '.', 'Указать план'); });
}
/* напоминание вечером: смена открыта — одно сообщение, «работаю дальше» = вечерняя смена, больше не трогаем */
function remindClose(){
  const t = today_(), open = read_(SH.shifts, 2, 11).filter(r => String(r[0]).slice(0, 10) === t && !r[3] && r[10] !== 'да');
  const tg = {}; staffTg_().forEach(x => tg[x.id] = x.tg);
  open.forEach(r => { if (tg[r[1]] && empOn_(r[1], 'close_remind')) send_(tg[r[1]], 'Смена открыта с ' + r[2] + '. Ушёл — закрой смену. Задерживаешься — нажми «Работаю дальше».', [['Закрыть смену', 'close'], ['Работаю дальше', 'late']]); });
}
/* напоминание утром: вчерашняя (или более ранняя) смена так и не закрыта */
function remindMorning(){
  const t = today_(), tg = {}; staffTg_().forEach(x => tg[x.id] = x.tg);
  read_(SH.shifts, 2, 10).filter(r => String(r[0]).slice(0, 10) < t && !r[3]).forEach(r => {
    if (tg[r[1]] && empOn_(r[1], 'morning_remind')) send_(tg[r[1]], 'Смена ' + String(r[0]).slice(8, 10) + '.' + String(r[0]).slice(5, 7) + ' (с ' + r[2] + ') не закрыта. Укажи, во сколько ушёл.', [['Закрыть смену', 'close']]); });
}

/* ============ BLOCK: SETUP (запустить один раз вручную) ============ */
function setup(){
  if (!token_()) throw new Error('Сначала добавьте свойство скрипта BOT_TOKEN');
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  const p = params_();
  p.remindPlan.split(',').map(s => s.trim()).filter(Boolean).forEach(s => { const m = toMin_(s); ScriptApp.newTrigger('remindPlan').timeBased().atHour(Math.floor(m / 60)).nearMinute(m % 60).everyDays(1).inTimezone(TZ).create(); });
  const c = toMin_(p.remindClose); ScriptApp.newTrigger('remindClose').timeBased().atHour(Math.floor(c / 60)).nearMinute(c % 60).everyDays(1).inTimezone(TZ).create();
  const mb = toMin_(p.remindBuy); ScriptApp.newTrigger('remindMorning930').timeBased().atHour(Math.floor(mb / 60)).nearMinute(mb % 60).everyDays(1).inTimezone(TZ).create();
  const mo = toMin_(p.remindMorning); ScriptApp.newTrigger('remindMorning').timeBased().atHour(Math.floor(mo / 60)).nearMinute(mo % 60).everyDays(1).inTimezone(TZ).create();
  const r = tg_('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Akrix Job', web_app: { url: appUrl_() } } });
  Logger.log('Кнопка меню: ' + JSON.stringify(r));
  Logger.log('Триггеры: ' + ScriptApp.getProjectTriggers().length);
}
/* проверка бота: пишет руководителю */
function testBot(){ const b = staffTg_().find(x => x.boss); if (!b) throw new Error('Откройте приложение хотя бы раз — бот запомнит ваш Telegram ID'); Logger.log(JSON.stringify(send_(b.tg, 'Akrix Job: бот работает ✅', 'Открыть Akrix Job'))); }
