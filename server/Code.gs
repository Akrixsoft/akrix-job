/* =====================================================================
   Akrix Job — серверная часть (Google Apps Script, привязан к таблице «Akrix Job — база»)
   Вставить целиком в Расширения → Apps Script → Code.gs
   Токен бота: Настройки проекта → Свойства скрипта → BOT_TOKEN
   ===================================================================== */

/* ============ BLOCK: CONFIG ============ */
const APP_URL = 'https://akrixsoft.github.io/akrix-job/';   // адрес мини-приложения (GitHub Pages)
const TZ = 'Asia/Tbilisi';
const SH = { params:'Параметры', staff:'Сотрудники', orders:'Заказы', extras:'Доп. обработки', modules:'Модули', tasks:'Задачи',
  ops:'Операции', lib:'Библиотека монтажа', shifts:'Смены', marks:'Отметки', plans:'Планы', takes:'Взятые задачи', kit:'Комплект', notes:'Заметки монтажа', buy:'Закупка', buyCat:'Справочник закупки', time:'Время', skills:'Навыки', pays:'Выплаты', skillLog:'Навыки — история' };
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
    remindClose: String(g('Напоминание закрыть', '20:00')), remindMorning: String(g('Напоминание о незакрытой', '08:00')), remindBuy: String(g('Напоминание о закупке', '09:30')), hoursDay: +g('Часов в рабочем дне', 8), dayOff: String(g('Выходной день', 'воскресенье')),
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

/* ============ BLOCK: API ============ */
function doGet(){ return ContentService.createTextOutput('Akrix Job API работает'); }
function doPost(e){
  let out;
  if (e && e.parameter && e.parameter.tg){   // вебхук Telegram: кнопки и команды в чате бота
    if (e.parameter.tg === tgSecret_()){ const lock = LockService.getScriptLock(); lock.waitLock(20000);
      try { handleTg_(JSON.parse(e.postData.contents)); } catch (err) {} finally { lock.releaseLock(); } }
    return HtmlService.createHtmlOutput('ok'); }   // HtmlService: без редиректа 302, иначе Telegram повторяет обновления
  try {
    const b = JSON.parse(e.postData.contents);
    const me = whoAmI_(verify_(b.init));
    const fn = API[b.action]; if (!fn) throw new Error('Нет действия ' + b.action);
    if (fn.boss && !me.boss) throw new Error('Только для руководителя');
    const lock = LockService.getScriptLock(); lock.waitLock(20000);
    try { out = { ok: true, data: fn(me, b) }; } finally { lock.releaseLock(); }
  } catch (err) { out = { ok: false, error: String(err && err.message || err) }; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}
function bossOnly_(f){ f.boss = true; return f; }

const API = {
  /* ---- загрузка всего для приложения ---- */
  boot(me){ ensureTriggers_(); ensureWebhook_();
    const o = sh_(SH.orders);
    return { me, params: params_(), today: today_(), now: hm_(),
      staff: read_(SH.staff, 2, 9).map(r => ({ id: String(r[0]), name: String(r[1]), role: String(r[4]).trim(), helperRate: r[5], active: String(r[6]).trim() !== 'нет', tg: !!r[3], payMode: String(r[8] || '').trim() === 'без лимита' ? 'free' : 'earned' })),
      pays: sh_(SH.pays) ? read_(SH.pays, 2, 9) : [],
      ops: read_(SH.ops, 2, 11),
      orderHead: o.getRange(1, 1, 1, 26).getValues()[0],
      orders: read_(SH.orders, 2, 26),
      extras: read_(SH.extras, 2, 5), modules: read_(SH.modules, 2, 5), tasks: read_(SH.tasks, 2, 5), lib: read_(SH.lib, 2, 2),
      shifts: read_(SH.shifts, 2, 12), marks: read_(SH.marks, 2, 12).filter(r => r[11] !== 'да'),
      plans: read_(SH.plans, 2, 6), takes: read_(SH.takes, 2, 5), kit: read_(SH.kit, 2, 7).filter(r => r[6] !== 'да'), notes: read_(SH.notes, 2, 5), buy: read_(SH.buy, 2, 8), buyCat: sh_(SH.buyCat) ? read_(SH.buyCat, 2, 2) : [], time: sh_(SH.time) ? read_(SH.time, 2, 7) : [], skills: skills_(), skillLog: sh_(SH.skillLog) ? read_(SH.skillLog, 2, 6) : [] };
  },
  /* ---- смена ---- */
  shiftStart(me, b){   // смена = одна строка в день; ушёл и вернулся — новый отрезок в колонке L «Отрезки»
    const t = today_(), rows = read_(SH.shifts, 2, 12), at = hm_();
    const day = rows.filter(r => String(r[0]).slice(0, 10) === t && String(r[1]) === me.id).pop();
    if (day && !day[3]) throw new Error('Смена уже начата');
    if (day){ const g = segs_(day).concat([{ s: at, e: '' }]); const s = sh_(SH.shifts);
      s.getRange(day[12], 4).setValue(''); s.getRange(day[12], 12).setValue("'" + segStr_(g)); return { at, late: '', again: true }; }
    const plan = latestPlan_(me.id, t);
    let late = ''; if (plan && plan.at && !plan.off){ const d = toMin_(at) - toMin_(plan.at); late = d > 0 ? d : 0; }
    append_(SH.shifts, [t, me.id, "'" + at, '', '', plan ? (plan.off ? 'не выходил' : "'" + plan.at) : 'не указан', late, b.geo || '', '', '', '', "'" + at + '–']);
    return { at, late, plan };
  },
  shiftEnd(me, b){ // b.date — закрыть смену прошлого дня с указанным временем ухода b.at
    const t = b.date || today_(), rows = read_(SH.shifts, 2, 12), r = rows.reverse().find(x => String(x[0]).slice(0, 10) === t && String(x[1]) === me.id && !x[3]);
    if (!r) throw new Error('Открытой смены нет');
    if (t !== today_() && !/^\d\d:\d\d$/.test(String(b.at || ''))) throw new Error('Укажи, во сколько ушёл');
    const at = t !== today_() ? b.at : hm_(), g = segs_(r); g[g.length - 1].e = at;
    const h = Math.round(segMin_(g) / 60 * 100) / 100;   // сумма отрезков, перерывы не считаются
    stopWork_(me.id); const s = sh_(SH.shifts); s.getRange(r[12], 4, 1, 2).setValues([["'" + at, h]]); s.getRange(r[12], 9, 1, 2).setValues([[b.geo || '', b.misc || '']]);
    s.getRange(r[12], 12).setValue("'" + segStr_(g));
    return { at, hours: h };
  },
  /* ---- счётчик времени: одна активная операция на человека ---- */
  workStart(me, b){ stopWork_(me.id); append_(SH.time, [now_(), me.id, b.order, b.op, '', '']); return {}; },
  workStop(me){ stopWork_(me.id); return {}; },
  timeAdd(me, b){ const m = Math.round(+b.minutes || 0); if (!(m > 0)) throw new Error('Впиши время');
    const t = today_(), days = read_(SH.shifts, 2, 12).filter(r => String(r[0]).slice(0, 10) === t && String(r[1]) === me.id);
    if (!days.length) throw new Error('Ручное время — только в свою смену сегодня');
    const shiftMin = days.reduce((a, d) => a + segMin_(segs_(d), hm_()), 0), nowMs = Date.now();   // все отрезки смены за день
    const used = read_(SH.time, 2, 6).filter(r => String(r[1]) === me.id && String(r[0]).slice(0, 10) === t).reduce((a, r) => a + (r[4] ? +r[5] || 0 : (nowMs - utcMs_(r[0])) / 6e4), 0);
    if (m > shiftMin - used + 1) throw new Error('Можно добавить не больше ' + Math.max(0, Math.floor(shiftMin - used)) + ' мин — столько осталось от твоей смены');
    append_(SH.time, [now_(), me.id, b.order, b.op, now_(), m, 'вручную']); return {}; },
  shiftLate(me){ // «работаю дальше» — вечерняя смена, больше не напоминать
    const t = today_(), r = read_(SH.shifts, 2, 11).reverse().find(x => String(x[0]).slice(0, 10) === t && String(x[1]) === me.id && !x[3]);
    if (r) sh_(SH.shifts).getRange(r[11], 11).setValue('да'); return {};
  },
  /* ---- отметки работы: галочка = запись в расчёт ---- */
  mark(me, b){
    const row = append_(SH.marks, [now_(), me.id, b.order, b.grp, b.op, b.unit, b.pct, b.amount, 0, b.partner || '', b.mode || '', '']);
    return { row, at: hm_() };
  },
  unmark(me, b){
    const s = sh_(SH.marks), r = s.getRange(b.row, 1, 1, 12).getValues()[0];
    if (String(r[1]) !== me.id && !me.boss) throw new Error('Можно снять только свою отметку');
    if (!me.boss && String(cell_(r[0])).slice(0, 10) !== today_()) throw new Error('Снять можно только сегодняшнюю отметку');
    s.getRange(b.row, 12).setValue('да'); return {};
  },
  take(me, b){ append_(SH.takes, [now_(), me.id, b.order, b.op, 'взял']); return {}; },
  untake(me, b){ append_(SH.takes, [now_(), me.id, b.order, b.op, 'отменил']); return {}; },
  unjoin(me, b){ append_(SH.takes, [now_(), b.who, b.order, b.op, 'отключён ' + me.id]); return {}; },
  /* доли участников: задаёт позвавший (взявший задачу) или руководитель; 'доли S1:70,S3:30' или 'доли сброс' */
  shareSet(me, b){ const e = Object.entries(b.shares || {}).filter(x => +x[1] > 0);
    if (e.length && Math.abs(e.reduce((a, x) => a + +x[1], 0) - 100) > 0.5) throw new Error('Доли должны давать 100%');
    append_(SH.takes, [now_(), me.id, b.order, b.op, 'доли ' + (e.length ? e.map(x => x[0] + ':' + Math.round(+x[1])).join(',') : 'сброс')]); return {}; },
  /* ученик просится на операцию: сообщение взявшему (если есть) или руководству и мастеру */
  askJoin(me, b){ const txt = me.name + ' просится помощником: ' + (b.opName || b.op) + ' · ' + b.order + '. Подключить — в списке участников задачи.';
    if (b.to) notifyOne_(String(b.to), txt); else { notifyBosses_(txt); const o = read_(SH.orders, 2, 26).find(r => String(r[0]).trim() === String(b.order)); if (o && o[24]) notifyOne_(String(o[24]).trim(), txt); }
    return {}; },
  join(me, b){ if (!b.who || b.who === me.id) throw new Error('Выбери сотрудника'); append_(SH.takes, [now_(), b.who, b.order, b.op, 'подключён ' + me.id]); return {}; },
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
    if (!me.boss) bossTgs_().forEach(t => tg_('sendMessage', { chat_id: t, text: 'Закупка: ' + n + (b.qty ? ' × ' + b.qty : '') + (b.order ? ' (заказ ' + b.order + ')' : '') + ' — добавил ' + me.name + '.',
      reply_markup: { inline_keyboard: [[{ text: '☐ Куплено', callback_data: 'b:' + row + ':g' }], [{ text: 'Весь список', callback_data: 'list' }]] } }));
    return { row }; },
  buySet: bossOnly_(function(me, b){
    const ok = ['нужно', 'заказано', 'получено', 'отменено']; if (ok.indexOf(b.status) < 0) throw new Error('Неизвестный статус');
    const s = sh_(SH.buy); s.getRange(b.row, 6, 1, 3).setValues([[b.status, now_(), me.id]]);
    if (b.status === 'получено') notifyBuy_(s.getRange(b.row, 1, 1, 8).getValues()[0]);
    return {}; }),
  /* ---- назначение задач: руководитель, администратор или мастер заказа ---- */
  taskAssign(me, b){ canAssign_(me, b.order); return { row: append_(SH.tasks, [b.order, b.op, b.who, b.due || '', 'назначил ' + me.id]) }; },
  taskUnassign(me, b){ const s = sh_(SH.tasks), ord = s.getRange(b.row, 1).getDisplayValue(); canAssign_(me, ord); s.getRange(b.row, 1, 1, 5).clearContent(); return {}; },
  /* ---- деньги: аванс просит сотрудник, выдаёт руководитель / администратор; зарплата — по закрытым заказам ---- */
  payRequest(me, b){ const a = Math.round(+b.amount || 0); if (!(a > 0)) throw new Error('Впиши сумму');
    if (read_(SH.pays, 2, 8).some(r => String(r[1]) === me.id && r[4] === 'запрос')) throw new Error('Предыдущий запрос ещё не рассмотрен');
    const row = append_(SH.pays, [now_(), me.id, 'аванс', a, 'запрос', '', '', String(b.note || '')]);
    notifyBosses_('Запрос аванса: ' + me.name + ' — ' + a + ' ₾' + (b.note ? ' (' + b.note + ')' : '') + '. Решение — в «Людях».');
    return { row }; },
  payCancel(me, b){ const s = sh_(SH.pays), r = s.getRange(b.row, 1, 1, 8).getValues()[0];
    if (String(r[1]) !== me.id || r[4] !== 'запрос') throw new Error('Отменить можно только свой нерассмотренный запрос');
    s.getRange(b.row, 5, 1, 3).setValues([['отменён', me.id, now_()]]); return {}; },
  payDecide: bossOnly_(function(me, b){ const ok = ['выдано', 'отклонено']; if (ok.indexOf(b.status) < 0) throw new Error('Неизвестное решение');
    const s = sh_(SH.pays), r = s.getRange(b.row, 1, 1, 8).getValues()[0]; if (r[4] !== 'запрос') throw new Error('Запрос уже рассмотрен');
    s.getRange(b.row, 5, 1, 3).setValues([[b.status, me.id, now_()]]);
    notifyOne_(String(r[1]), b.status === 'выдано' ? 'Аванс ' + r[3] + ' ₾ выдан.' : 'Запрос аванса ' + r[3] + ' ₾ отклонён.'); return {}; }),
  payAdd: bossOnly_(function(me, b){ const a = Math.round(+b.amount || 0); if (!(a > 0)) throw new Error('Впиши сумму');
    const type = b.type === 'аванс' ? 'аванс' : 'зарплата';
    const row = append_(SH.pays, [now_(), b.who, type, a, 'выдано', me.id, now_(), String(b.note || ''), b.order ? "'" + b.order : '']);
    notifyOne_(String(b.who), (type === 'аванс' ? 'Выдан аванс ' : 'Выплачена зарплата ') + a + ' ₾.'); return { row }; }),
  /* премия по заказу — отдельная отметка «премия»: входит в заработок по этому заказу */
  bonusAdd: bossOnly_(function(me, b){ const a = Math.round(+b.amount || 0); if (!(a > 0)) throw new Error('Впиши сумму');
    const row = append_(SH.marks, [now_(), b.who, "'" + b.order, 'korpus', 'premia', 'премия', 100, a, 0, '', '', '']);
    notifyOne_(String(b.who), 'Премия ' + a + ' ₾ по заказу ' + b.order + '.'); return { row }; }),
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
function stopWork_(who){ const s = sh_(SH.time); if (!s) return; const now = new Date();
  read_(SH.time, 2, 6).forEach(r => { if (String(r[1]) === who && !r[4]){ const st = utcMs_(r[0]); s.getRange(r[6], 5, 1, 2).setValues([[now_(), Math.max(0, Math.round((now - st) / 6e4))]]); } }); }
function utcMs_(s){ const p = String(s).split(/[- :]/).map(Number); return Date.UTC(p[0], p[1] - 1, p[2], p[3] || 0, p[4] || 0) - 4 * 3600e3; }   // время таблицы — Тбилиси (UTC+4)
function canAssign_(me, order){ if (me.boss) return;
  const m = sh_(SH.orders).getRange(findOrderRow_(order), ORD.master + 1).getDisplayValue().trim();
  if (m !== me.id) throw new Error('Назначать задачи может руководитель или мастер заказа'); }
function notifyBuy_(r){ // получено → тем, кто добавил позицию, и тем, кто работает по заказу
  const ids = {}; ids[String(r[1])] = 1; const ord = String(r[2]).trim();
  if (ord){ read_(SH.takes, 2, 5).forEach(x => { if (String(x[2]).trim() === ord) ids[String(x[1])] = 1; });
    read_(SH.tasks, 2, 5).forEach(x => { if (String(x[0]).trim() === ord && x[2]) ids[String(x[2]).trim()] = 1; }); }
  const text = 'Получено: ' + r[3] + (r[4] ? ' × ' + r[4] : '') + (ord ? ' · заказ ' + ord : '');
  staffTg_().filter(x => ids[x.id]).forEach(x => { try { send_(x.tg, text); } catch (e) {} }); }
function mountAt_(order){ try { return sh_(SH.orders).getRange(findOrderRow_(order), ORD.mountAt + 1).getDisplayValue(); } catch (e){ return ''; } }

/* ============ BLOCK: TELEGRAM BOT ============ */
function tg_(method, payload){
  const r = UrlFetchApp.fetch('https://api.telegram.org/bot' + token_() + '/' + method, { method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true });
  return JSON.parse(r.getContentText());
}
/* триггеры ставятся сами при первом запуске новой версии (без ручного setup) */
function ensureTriggers_(){ const pr = PropertiesService.getScriptProperties(); if (pr.getProperty('TRG') === 'v2') return;
  try { if (!ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'remindMorning930')){ const m = toMin_(params_().remindBuy);
      ScriptApp.newTrigger('remindMorning930').timeBased().atHour(Math.floor(m / 60)).nearMinute(m % 60).everyDays(1).inTimezone(TZ).create(); }
    pr.setProperty('TRG', 'v2'); } catch (e) {} }
/* утро: закупка, если список не закрыт; отставание заказов — мастеру (нет мастера — руководству) */
function remindMorning930(){
  const need = read_(SH.buy, 2, 8).filter(r => r[5] === 'нужно');
  if (need.length) bossTgs_().forEach(t => sendBuyList_(t, 'Закупка не закрыта'));
  let lag = null; try { lag = JSON.parse(PropertiesService.getScriptProperties().getProperty('LAG') || 'null'); } catch (e) {}
  if (!lag || !lag.items) return; const orders = read_(SH.orders, 2, 26);
  lag.items.filter(x => x.cls === 'bad').forEach(x => { const o = orders.find(r => String(r[0]).trim() === x.order); if (!o || String(o[11]).trim() === 'сдан') return;
    const txt = 'Заказ ' + x.label + ' отстаёт: ' + x.txt + ' до «' + x.dl + '» ' + x.date + '.';
    if (o[24]) notifyOne_(String(o[24]).trim(), txt); else notifyBosses_(txt); }); }
/* ============ BLOCK: BOT (вебхук: закупка галками в чате) ============ */
function tgSecret_(){ const pr = PropertiesService.getScriptProperties(); let s = pr.getProperty('TG_SECRET'); if (!s){ s = Utilities.getUuid().replace(/-/g, ''); pr.setProperty('TG_SECRET', s); } return s; }
function ensureWebhook_(){ const pr = PropertiesService.getScriptProperties(); if (pr.getProperty('HOOK') === 'v1') return;
  try { const url = ScriptApp.getService().getUrl(); if (!url || !/\/exec$/.test(url)) return;
    const r = tg_('setWebhook', { url: url + '?tg=' + tgSecret_(), allowed_updates: ['message', 'callback_query'], drop_pending_updates: true });
    if (r && r.ok) pr.setProperty('HOOK', 'v1'); } catch (e) {} }
function bossTgs_(){ const ids = read_(SH.staff, 2, 5).filter(r => BOSS_ROLES.indexOf(String(r[4]).trim()) >= 0).map(r => String(r[0]));
  return staffTg_().filter(x => ids.indexOf(x.id) >= 0).map(x => x.tg); }
function bossByTg_(tgId){ return read_(SH.staff, 2, 7).find(r => String(r[3]) === String(tgId) && BOSS_ROLES.indexOf(String(r[4]).trim()) >= 0 && String(r[6]).trim() !== 'нет'); }
function buyBtn_(r){ const got = r[5] === 'получено', ord = String(r[2]).trim();
  return [{ text: (got ? '✅ ' : '☐ ') + r[3] + (r[4] ? ' × ' + r[4] : '') + (ord ? ' · ' + ord : ''), callback_data: 'b:' + r[8] + ':' + (got ? 'n' : 'g') }]; }
/* список: строки текстом (ровно от левого края), галки — сетка номеров по 5 в ряд */
function buyKb_(rows){ const kb = []; rows.forEach((r, i) => { if (i % 5 === 0) kb.push([]); const got = r[5] === 'получено';
    kb[kb.length - 1].push({ text: (i + 1) + (got ? ' ✅' : ' ☐'), callback_data: 'b:' + r[8] + ':' + (got ? 'n' : 'g') }); });
  return { inline_keyboard: kb.concat([[{ text: 'Обновить список', callback_data: 'list' }]]) }; }
function esc_(t){ return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function buyText_(rows, title){ const left = rows.filter(r => r[5] !== 'получено').length;
  return '<b>' + esc_(title || 'Закупка') + '</b> — ' + (left ? 'осталось ' + left + ' из ' + rows.length : 'всё куплено ✅') + '\n\n' +
    rows.map((r, i) => (r[5] === 'получено' ? '✅ <s>' : '☐ ') + (i + 1) + '. ' + esc_(r[3]) + (r[4] ? ' × ' + esc_(r[4]) : '') + (String(r[2]).trim() ? ' · ' + esc_(String(r[2]).trim()) : '') + (r[5] === 'получено' ? '</s>' : '')).join('\n'); }
function sendBuyList_(chatId, title){ const need = read_(SH.buy, 2, 8).filter(r => r[5] === 'нужно' || r[5] === 'заказано').slice(0, 40);
  if (!need.length) return tg_('sendMessage', { chat_id: chatId, text: 'Закупка закрыта ✅' });
  return tg_('sendMessage', { chat_id: chatId, text: buyText_(need, title), parse_mode: 'HTML', reply_markup: buyKb_(need) }); }
function handleTg_(u){
  if (u.callback_query){ const q = u.callback_query, boss = bossByTg_(q.from.id), d = String(q.data || '');
    if (!boss){ tg_('answerCallbackQuery', { callback_query_id: q.id, text: 'Только для руководителя' }); return; }
    if (d === 'list'){ tg_('answerCallbackQuery', { callback_query_id: q.id }); sendBuyList_(q.message.chat.id); return; }
    const m = d.match(/^b:(\d+):([gn])$/); if (!m){ tg_('answerCallbackQuery', { callback_query_id: q.id }); return; }
    const s = sh_(SH.buy), row = +m[1], r = s.getRange(row, 1, 1, 8).getValues()[0], st = m[2] === 'g' ? 'получено' : 'нужно';
    if (r[5] !== st && r[3]){ s.getRange(row, 6, 1, 3).setValues([[st, now_(), String(boss[0])]]); if (st === 'получено') notifyBuy_(r.concat([row]).slice(0, 8)); }   // повтор того же нажатия ничего не меняет
    tg_('answerCallbackQuery', { callback_query_id: q.id, text: (st === 'получено' ? '✅ Куплено: ' : 'Вернул в список: ') + r[3] });
    const kb = (q.message.reply_markup && q.message.reply_markup.inline_keyboard) || [], all = read_(SH.buy, 2, 8);   // перерисовать по таблице
    const rows = [].concat.apply([], kb).map(b => { const mm = String(b.callback_data || '').match(/^b:(\d+):/); return mm ? all.find(x => x[8] === +mm[1]) : null; }).filter(Boolean);
    const single = !kb.some(rw => rw.some(b => b.callback_data === 'list' && b.text === 'Обновить список'));   // одиночное сообщение о новой закупке
    if (single && rows.length) tg_('editMessageReplyMarkup', { chat_id: q.message.chat.id, message_id: q.message.message_id, reply_markup: { inline_keyboard: rows.map(buyBtn_).concat([[{ text: 'Весь список', callback_data: 'list' }]]) } });
    else if (rows.length){ const title = String(q.message.text || '').split(' — ')[0] || 'Закупка';
      tg_('editMessageText', { chat_id: q.message.chat.id, message_id: q.message.message_id, text: buyText_(rows, title), parse_mode: 'HTML', reply_markup: buyKb_(rows) }); }
    return; }
  const msg = u.message; if (!msg || !msg.text) return; const t = msg.text.trim().toLowerCase();
  if (t === '/start' || t === '/buy' || t === 'закупка' || t === '/закупка'){
    if (bossByTg_(msg.from.id)) sendBuyList_(msg.chat.id); else tg_('sendMessage', { chat_id: msg.chat.id, text: 'Открой Akrix Job кнопкой меню внизу чата.' }); }
}
function notifyBosses_(text){ const ids = read_(SH.staff, 2, 5).filter(r => BOSS_ROLES.indexOf(String(r[4]).trim()) >= 0).map(r => String(r[0]));
  staffTg_().filter(x => ids.indexOf(x.id) >= 0).forEach(x => send_(x.tg, text, 'Открыть')); }
function notifyOne_(id, text){ const x = staffTg_().find(y => y.id === id); if (x) send_(x.tg, text, 'Открыть'); }
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
  staffTg_().filter(x => !x.boss).forEach(x => { if (!latestPlan_(x.id, d)) send_(x.tg, 'План на завтра не указан: во сколько выходишь и какие задачи берёшь. Указать до ' + to + '.', 'Указать план'); });
}
/* напоминание вечером: смена открыта — одно сообщение, «работаю дальше» = вечерняя смена, больше не трогаем */
function remindClose(){
  const t = today_(), open = read_(SH.shifts, 2, 11).filter(r => String(r[0]).slice(0, 10) === t && !r[3] && r[10] !== 'да');
  const tg = {}; staffTg_().forEach(x => tg[x.id] = x.tg);
  open.forEach(r => { if (tg[r[1]]) send_(tg[r[1]], 'Смена открыта с ' + r[2] + '. Ушёл — закрой смену. Задерживаешься — нажми «Работаю дальше».', [['Закрыть смену', 'close'], ['Работаю дальше', 'late']]); });
}
/* напоминание утром: вчерашняя (или более ранняя) смена так и не закрыта */
function remindMorning(){
  const t = today_(), tg = {}; staffTg_().forEach(x => tg[x.id] = x.tg);
  read_(SH.shifts, 2, 10).filter(r => String(r[0]).slice(0, 10) < t && !r[3]).forEach(r => {
    if (tg[r[1]]) send_(tg[r[1]], 'Смена ' + String(r[0]).slice(8, 10) + '.' + String(r[0]).slice(5, 7) + ' (с ' + r[2] + ') не закрыта. Укажи, во сколько ушёл.', [['Закрыть смену', 'close']]); });
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
