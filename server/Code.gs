/* =====================================================================
   Akrix Job — серверная часть (Google Apps Script, привязан к таблице «Akrix Job — база»)
   Вставить целиком в Расширения → Apps Script → Code.gs
   Токен бота: Настройки проекта → Свойства скрипта → BOT_TOKEN
   ===================================================================== */

/* ============ BLOCK: CONFIG ============ */
const APP_URL = 'https://akrixsoft.github.io/akrix-job/';   // адрес мини-приложения (GitHub Pages)
const TZ = 'Asia/Tbilisi';
const SH = { params:'Параметры', staff:'Сотрудники', orders:'Заказы', extras:'Доп. обработки', modules:'Модули', tasks:'Задачи',
  ops:'Операции', lib:'Библиотека монтажа', shifts:'Смены', marks:'Отметки', plans:'Планы', takes:'Взятые задачи', kit:'Комплект', notes:'Заметки монтажа', buy:'Закупка', buyCat:'Справочник закупки' };
const ORD = { id:0, client:1, product:2, sys:3, kind:4, cost:5, term:6, ship:7, ceh:8, done:9, team:10, status:11, mat0:12, matN:21, off:21, mountAt:22, prisManual:23, master:24 };
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
    remindClose: String(g('Напоминание закрыть', '20:00')), remindMorning: String(g('Напоминание о незакрытой', '08:00')), hoursDay: +g('Часов в рабочем дне', 8), dayOff: String(g('Выходной день', 'воскресенье')),
    helperRate: +g('Ставка помощника', 9), korpusOther: +g('Ставка корпуса «Прочее»', 25), botName: String(g('Имя бота', '')) };
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
  boot(me){
    const o = sh_(SH.orders);
    return { me, params: params_(), today: today_(), now: hm_(),
      staff: read_(SH.staff, 2, 7).map(r => ({ id: String(r[0]), name: String(r[1]), role: String(r[4]).trim(), helperRate: r[5], active: String(r[6]).trim() !== 'нет', tg: !!r[3] })),
      ops: read_(SH.ops, 2, 9),
      orderHead: o.getRange(1, 1, 1, 25).getValues()[0],
      orders: read_(SH.orders, 2, 25),
      extras: read_(SH.extras, 2, 5), modules: read_(SH.modules, 2, 5), tasks: read_(SH.tasks, 2, 5), lib: read_(SH.lib, 2, 2),
      shifts: read_(SH.shifts, 2, 10), marks: read_(SH.marks, 2, 12).filter(r => r[11] !== 'да'),
      plans: read_(SH.plans, 2, 6), takes: read_(SH.takes, 2, 5), kit: read_(SH.kit, 2, 7).filter(r => r[6] !== 'да'), notes: read_(SH.notes, 2, 5), buy: read_(SH.buy, 2, 8), buyCat: sh_(SH.buyCat) ? read_(SH.buyCat, 2, 2) : [] };
  },
  /* ---- смена ---- */
  shiftStart(me, b){
    const t = today_(), rows = read_(SH.shifts, 2, 10);
    if (rows.some(r => String(r[0]).slice(0, 10) === t && String(r[1]) === me.id && !r[3])) throw new Error('Смена уже начата');
    const plan = latestPlan_(me.id, t), at = hm_();
    let late = ''; if (plan && plan.at && !plan.off){ const d = toMin_(at) - toMin_(plan.at); late = d > 0 ? d : 0; }
    append_(SH.shifts, [t, me.id, "'" + at, '', '', plan ? (plan.off ? 'не выходил' : "'" + plan.at) : 'не указан', late, b.geo || '', '', '']);
    return { at, late, plan };
  },
  shiftEnd(me, b){ // b.date — закрыть смену прошлого дня с указанным временем ухода b.at
    const t = b.date || today_(), rows = read_(SH.shifts, 2, 10), r = rows.reverse().find(x => String(x[0]).slice(0, 10) === t && String(x[1]) === me.id && !x[3]);
    if (!r) throw new Error('Открытой смены нет');
    if (t !== today_() && !/^\d\d:\d\d$/.test(String(b.at || ''))) throw new Error('Укажи, во сколько ушёл');
    const at = t !== today_() ? b.at : hm_(); let mins = toMin_(at) - toMin_(r[2]); if (mins < 0) mins += 1440;   // ушёл после полуночи
    const h = Math.round(mins / 60 * 100) / 100;
    const s = sh_(SH.shifts); s.getRange(r[10], 4, 1, 2).setValues([["'" + at, h]]); s.getRange(r[10], 9, 1, 2).setValues([[b.geo || '', b.misc || '']]);
    return { at, hours: h };
  },
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
    const allowed = [ORD.ship + 1, ORD.ceh + 1, ORD.done + 1, ORD.off + 1, ORD.prisManual + 1, ORD.team + 1, ORD.status + 1, ORD.master + 1];
    for (let c = ORD.mat0 + 1; c <= ORD.mat0 + 9; c++) allowed.push(c);
    if (allowed.indexOf(+b.col) < 0) throw new Error('Колонка не редактируется из приложения');
    const r = findOrderRow_(b.order), v = b.value;
    sh_(SH.orders).getRange(r, +b.col).setValue(v); return {};
  }),
  /* ---- закупка: добавляют все, статус ведёт руководитель / администратор ---- */
  buyAdd(me, b){ const n = String(b.name || '').trim(); if (!n) throw new Error('Впиши позицию');
    const cat = sh_(SH.buyCat); if (cat && !read_(SH.buyCat, 2, 1).some(r => String(r[0]).trim().toLowerCase() === n.toLowerCase())) cat.appendRow([n, '', 'добавлено из приложения']);
    return { row: append_(SH.buy, [now_(), me.id, b.order || '', b.name, b.qty ? "'" + b.qty : '', 'нужно', now_(), me.id]) }; },
  buySet: bossOnly_(function(me, b){
    const ok = ['нужно', 'заказано', 'получено', 'отменено']; if (ok.indexOf(b.status) < 0) throw new Error('Неизвестный статус');
    const s = sh_(SH.buy); s.getRange(b.row, 6, 1, 3).setValues([[b.status, now_(), me.id]]);
    if (b.status === 'получено') notifyBuy_(s.getRange(b.row, 1, 1, 8).getValues()[0]);
    return {}; }),
  /* ---- назначение задач: руководитель, администратор или мастер заказа ---- */
  taskAssign(me, b){ canAssign_(me, b.order); return { row: append_(SH.tasks, [b.order, b.op, b.who, b.due || '', 'назначил ' + me.id]) }; },
  taskUnassign(me, b){ const s = sh_(SH.tasks), ord = s.getRange(b.row, 1).getDisplayValue(); canAssign_(me, ord); s.getRange(b.row, 1, 1, 5).clearContent(); return {}; },
  extraAdd: bossOnly_(function(me, b){ return { row: append_(SH.extras, [b.order, b.grp, b.name, b.pct === null || b.pct === '' ? '' : +b.pct, '']) }; }),
  extraDel: bossOnly_(function(me, b){ sh_(SH.extras).getRange(b.row, 1, 1, 5).clearContent(); return {}; })
};

/* ============ BLOCK: DOMAIN HELPERS ============ */
function toMin_(s){ const p = String(s).split(':').map(Number); return p[0] * 60 + (p[1] || 0); }
function latestPlan_(who, date){
  let best = null; read_(SH.plans, 2, 6).forEach(r => { if (String(r[0]).slice(0, 10) === date && String(r[1]) === who) best = r; });
  if (!best || best[4] === 'очищено') return null; return { at: String(best[2]), off: best[3] === 'да', reason: best[4] };
}
function canEditPlan_(d){ const p = params_(), t = today_();
  const diff = dayDiff_(d, t); return diff > 1 || (diff === 1 && toMin_(hm_()) < toMin_(p.planTo)); }
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
function send_(chatId, text, btn){ // btn: 'Текст' или [['Текст', 'go-параметр'], …]
  const p = { chat_id: chatId, text };
  const list = !btn ? [] : Array.isArray(btn) ? btn : [[btn, '']];
  if (list.length) p.reply_markup = { inline_keyboard: list.map(x => [{ text: x[0], web_app: { url: appUrl_() + (x[1] ? '&go=' + x[1] : '') } }]) };
  return tg_('sendMessage', p);
}
function staffTg_(){ return read_(SH.staff, 2, 7).filter(r => r[3] && String(r[6]).trim() !== 'нет').map(r => ({ id: String(r[0]), tg: String(r[3]), boss: String(r[4]).trim() === 'руководитель' })); }
const DAYS_ = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
function isWorkday_(iso){ const off = params_().dayOff.toLowerCase(); return off.indexOf(DAYS_[utc_(iso).getUTCDay()]) < 0; }

/* напоминание: план на завтра не указан */
function remindPlan(){
  const d = addDays_(today_(), 1), to = params_().planTo; if (!isWorkday_(d)) return;
  staffTg_().filter(x => !x.boss).forEach(x => { if (!latestPlan_(x.id, d)) send_(x.tg, 'План на завтра не указан. Во сколько выходишь? Указать до ' + to + '.', 'Указать план'); });
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
  const mo = toMin_(p.remindMorning); ScriptApp.newTrigger('remindMorning').timeBased().atHour(Math.floor(mo / 60)).nearMinute(mo % 60).everyDays(1).inTimezone(TZ).create();
  const r = tg_('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Akrix Job', web_app: { url: appUrl_() } } });
  Logger.log('Кнопка меню: ' + JSON.stringify(r));
  Logger.log('Триггеры: ' + ScriptApp.getProjectTriggers().length);
}
/* проверка бота: пишет руководителю */
function testBot(){ const b = staffTg_().find(x => x.boss); if (!b) throw new Error('Откройте приложение хотя бы раз — бот запомнит ваш Telegram ID'); Logger.log(JSON.stringify(send_(b.tg, 'Akrix Job: бот работает ✅', 'Открыть Akrix Job'))); }
