// Тест BLOCK PULT (сервер Job, 23.11.2026, записка job/TO_JOB_pult.md): pultPhone / pultMachine на настоящем Code.gs — без общей блокировки и без поднятия VER,
//  станки на связи, команда телефона → станок (op / opName из ключа), seen, длинный опрос (wait), состояние и сообщения помощника → телефон. node test/tpult_job.js server/Code.gs
const { ctx, BOOK, props, env } = require('./mock.js'); const res = [];
const ck = (n, c, d) => { res.push(!!c); console.log((c ? 'OK   ' : 'FAIL ') + n, c ? '' : JSON.stringify(d)); };
const st = BOOK.insertSheet('Сотрудники'); st.appendRow(['id', 'имя', 'tg', 'tgid', 'роль', '', 'доступ']); st.appendRow(['s1', 'Дмитрий', '', '', 'руководитель', '', 'да']); st.appendRow(['s2', 'Гия', '', '', 'сборщик', '', 'да']);
const KM = 'a'.repeat(48), KP = 'b'.repeat(48); props['AK_' + KM] = 's1'; props['AK_' + KP] = 's2'; props.VER = '5';
let locks = 0; env.LockService.getScriptLock = () => ({ waitLock(){ locks++; }, releaseLock(){} });
const call = b => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(b) }, parameter: {} }).t);
let r = call({ action: 'pultPhone', key: KP }); ck('телефон без станка: me (Гия), станков нет', r.ok && r.data.me.name === 'Гия' && r.data.machines.length === 0, r);
r = call({ action: 'pultMachine', key: KM }); ck('станок без имени ПК — ошибка', !r.ok && /имени ПК/.test(r.error), r);
r = call({ action: 'pultMachine', key: KM, pc: 'stanok', state: { stg: 'Головы', step: 2 }, out: [{ w: 'ai', x: 'Поставь деталь к упору X' }] });
ck('станок: состояние принято, команд нет, телефона не было', r.ok && r.data.cmds.length === 0 && r.data.phone === null, r);
r = call({ action: 'pultPhone', key: KP }); ck('телефон: станок stanok на связи', r.data.machines.includes('stanok'), r);
r = call({ action: 'pultPhone', key: KP, pc: 'stanok', cmds: [{ id: 'c1', k: 'go' }] });
ck('телефон → команда; получает состояние (этап Головы) и сообщение помощника', r.ok && r.data.state.stg === 'Головы' && r.data.log.length === 1 && /упору X/.test(r.data.log[0].x), r);
r = call({ action: 'pultMachine', key: KM, pc: 'stanok', state: {} });
ck('станок забирает команду go с op / opName из ключа телефона; телефон был только что', r.data.cmds.length === 1 && r.data.cmds[0].k === 'go' && r.data.cmds[0].op === 's2' && r.data.cmds[0].opName === 'Гия' && r.data.phone != null && r.data.phone < 5000, r);
r = call({ action: 'pultMachine', key: KM, pc: 'stanok', state: {}, seen: ['c1'] }); ck('seen — выполненная не отдаётся снова', r.data.cmds.length === 0, r);
const t0 = Date.now(); r = call({ action: 'pultMachine', key: KM, pc: 'stanok', state: {}, seen: ['c1'], wait: 600 }); const dt = Date.now() - t0;
ck('длинный опрос: без команды ждёт wait (600 мс)', r.ok && r.data.cmds.length === 0 && dt >= 550 && dt < 2000, dt);
ck('ни одной общей блокировки и VER не поднят', locks === 0 && props.VER === '5', { locks, VER: props.VER });
r = call({ action: 'pultPhone', key: 'c'.repeat(48), pc: 'stanok' }); ck('чужой ключ — отказ', !r.ok, r);
r = call({ action: 'ver' }); ck('прочее API работает (ver)', r.ok && r.ver === 5, r);
console.log(res.filter(Boolean).length + '/' + res.length); process.exit(res.every(Boolean) ? 0 : 1);
