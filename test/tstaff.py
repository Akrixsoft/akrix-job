#!/usr/bin/env python3
# tstaff: Akrix Job — «Люди» → «👤 Доступ сотрудников» (руководитель, 23.11.2026). Сервер — НАСТОЯЩИЙ Code.gs в браузере (мок из tjob_reg.py). Экран 412 px.
#  python3 test/tstaff.py [index.html] [server/Code.gs]
import sys, pathlib, json, re
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path(__file__).resolve().parent.parent
PAGE = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / 'index.html').resolve()
GS = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else ROOT / 'server/Code.gs').read_text(encoding='utf-8'); res = []
def ck(n, c, d=''): res.append(bool(c)); print(('OK   ' if c else 'FAIL ') + n, '' if c else d)
SRC = (ROOT / 'test' / 'tjob_reg.py').read_text(encoding='utf-8')
INIT = re.search(r'INIT = r"""(.*?)""" % json\.dumps\(GS\)', SRC, re.S).group(1) % json.dumps(GS)
INIT = INIT.replace("REQ.length = 0; })();", "window.OPENED = []; window.open = u => { OPENED.push(u); }; REQ.length = 0; })();")
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 412, 'height': 900}, device_scale_factor=2); ctx.add_init_script(INIT); pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e))); E = pg.evaluate
    pg.goto(PAGE.as_uri()); pg.wait_for_timeout(1500)
    pg.click('#tabs [data-tab=staff]'); pg.wait_for_timeout(400)
    ck('«Люди»: кнопка «👤 Доступ сотрудников · добавить человека»', pg.locator('[data-act=stOpen]').count() == 1)
    pg.click('[data-act=stOpen]'); pg.wait_for_timeout(800)
    t = pg.inner_text('#view'); ck('раскрыто: форма и список (Дмитрий — «это ты», Гия, Ника)', 'новый сотрудник' in t.lower() and 'это ты' in t and 'Гия' in t and 'Ника' in t, t[-400:])
    pg.fill('#st-n', 'Лука'); pg.fill('#st-t', '@luka_m'); pg.select_option('#st-r', 'помощник'); pg.click('[data-act=stAdd]'); pg.wait_for_timeout(900)
    row = E("() => BOOK.s['Сотрудники'].d.find(r => r[1] === 'Лука')")
    ck('добавлен в лист: @luka_m, помощник, доступ да', row and row[2] == '@luka_m' and row[4] == 'помощник' and row[6] == 'да', row)
    t = pg.inner_text('#view'); ck('сообщение «добавлен… открой бота @AkrixJob_bot», Лука в списке «ждёт входа»', 'Лука добавлен' in t and '@AkrixJob_bot' in t and 'ждёт входа' in t.lower(), t[:500])
    pg.click('[data-act=stShare]'); pg.wait_for_timeout(200); ck('«Отправить ссылку на бота» → поделиться t.me/AkrixJob_bot', any('t.me/share/url' in u and 'AkrixJob_bot' in u for u in E('OPENED')), E('OPENED'))
    pg.fill('#st-n', 'Двойник'); pg.fill('#st-t', 'LUKA_M'); pg.click('[data-act=stAdd]'); pg.wait_for_timeout(800)
    ck('дубль ника — ⚠ и введённое не стёрто', 'уже есть' in pg.inner_text('#view') and pg.input_value('#st-n') == 'Двойник')
    sid = E("() => BOOK.s['Сотрудники'].d.find(r => r[1] === 'Гия')[0]")
    pg.click(f'[data-act=stOff][data-p="{sid}"]'); pg.wait_for_timeout(300)
    ck('«Выключить» — первое нажатие только спрашивает', E("() => BOOK.s['Сотрудники'].d.find(r => r[1] === 'Гия')[6]") == 'да' and 'Точно выключить' in pg.inner_text('#view'))
    pg.click(f'[data-act=stOff][data-p="{sid}"]'); pg.wait_for_timeout(900)
    ck('второе нажатие → доступ «нет», «выключен» + «Включить»', E("() => BOOK.s['Сотрудники'].d.find(r => r[1] === 'Гия')[6]") == 'нет' and pg.locator(f'[data-act=stOn][data-p="{sid}"]').count() == 1)
    pg.select_option(f'[data-strole="{sid}"]', 'помощник'); pg.wait_for_timeout(900)
    ck('роль из списка → лист', E("() => BOOK.s['Сотрудники'].d.find(r => r[1] === 'Гия')[4]") == 'помощник')
    ck('экран телефона: без горизонтальной прокрутки', E("() => document.documentElement.scrollWidth <= window.innerWidth + 1"))
    pg.screenshot(path='/tmp/tstaff.png', full_page=True)
    ck('без ошибок', not errs, errs[:3])
    b.close()
print('ИТОГ', sum(res), '/', len(res)); sys.exit(0 if all(res) else 1)
