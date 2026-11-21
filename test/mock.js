// Мок Apps Script для тестов сервера Job: node <тест>.js server/Code.gs. Лист — массив строк; '…' в начале текста при чтении снимается (как в таблице).
const fs = require('fs'), path = require('path');
const GS = fs.readFileSync(process.argv[2] || path.join(__dirname, '../server/Code.gs'), 'utf8');
function Sheet(name){ this.name = name; this.d = []; }
Sheet.prototype = { appendRow(r){ this.d.push(r.slice()); }, setFrozenRows(){}, getLastRow(){ return this.d.length; }, getLastColumn(){ return Math.max(0, ...this.d.map(r => r.length)); },
  getRange(r, c, nr = 1, nc = 1){ const s = this; return {
    getValues(){ const o = []; for (let i = 0; i < nr; i++){ const row = []; for (let j = 0; j < nc; j++){ const v = (s.d[r - 1 + i] || [])[c - 1 + j] ?? ''; row.push(typeof v === 'string' ? v.replace(/^'/, '') : v); } o.push(row); } return o; },
    getDisplayValues(){ return this.getValues().map(x => x.map(v => String(v))); },
    setValue(v){ (s.d[r - 1] = s.d[r - 1] || [])[c - 1] = v; }, setValues(V){ V.forEach((row, i) => row.forEach((v, j) => { (s.d[r - 1 + i] = s.d[r - 1 + i] || [])[c - 1 + j] = v; })); },
    setNumberFormat(){ return this; }, setFontWeight(){ return this; }, setBackground(){ return this; } }; } };
const BOOK = { s: {}, getSheetByName(n){ return this.s[n] || null; }, insertSheet(n){ return this.s[n] = new Sheet(n); } }, props = {};
const env = { SpreadsheetApp: { getActiveSpreadsheet: () => BOOK }, PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] ?? null, setProperty: (k, v) => { props[k] = v; }, deleteProperty: k => { delete props[k]; } }) },
  LockService: { getScriptLock: () => ({ waitLock(){}, releaseLock(){} }) }, ContentService: { createTextOutput: t => ({ t, setMimeType(){ return this; } }), MimeType: { JSON: 1 } }, HtmlService: { createHtmlOutput: t => t },
  Utilities: { formatDate: (d, tz, f) => { const z = n => String(n).padStart(2, '0'); return f.replace('yyyy', d.getFullYear()).replace('yy', String(d.getFullYear()).slice(2)).replace('MM', z(d.getMonth() + 1)).replace('dd', z(d.getDate())).replace('HH', z(d.getHours())).replace('mm', z(d.getMinutes())).replace('ss', z(d.getSeconds())); },
    getUuid: () => 'x', computeHmacSha256Signature: () => [], newBlob: () => ({ getBytes: () => [] }) }, ScriptApp: { getProjectTriggers: () => [] }, Logger: { log(){} }, UrlFetchApp: {} };
const ctx = new Function(...Object.keys(env), GS + '\n;return { doPost, SH, API, RO_ };')(...Object.values(env));
module.exports = { ctx, BOOK, props };
