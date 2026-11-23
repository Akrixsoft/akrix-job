import sys, json
from playwright.sync_api import sync_playwright
P = sys.argv[1]; res=[]
def ck(n, c, x=''): res.append(bool(c)); print(('OK ' if c else 'FAIL ') + n, '' if c else x)
ST={'title':'Автоприсадка не идёт','can':{'go':True,'pause':True,'stop':True},'ai':{}}
N=[0]; SENT=[]
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={'width':412,'height':800}); errs=[]
    pg.on('pageerror', lambda e: errs.append(str(e)))
    def h(route):
        d=json.loads(route.request.post_data or '{}'); N[0]+=1; SENT.extend(d.get('cmds') or [])
        st=dict(ST); st['title']='Этап '+str(N[0]%3)   # состояние меняется каждый опрос
        log=[{'t':N[0],'w':'ai','x':'ответ '+str(N[0])}] if N[0]%2 else []
        route.fulfill(status=200, content_type='application/json', body=json.dumps({'ok':True,'data':{'me':{'id':'s1','name':'Дмитрий'},'machines':['ceh1'],'state':st,'age':500,'log':log}}))
    pg.route('https://script.google.com/**', h)
    pg.add_init_script("localStorage.setItem('pult_key','k');localStorage.setItem('pult_pc','ceh1');")
    pg.goto('file://'+P); pg.wait_for_timeout(1500)
    pg.evaluate("() => { window._I = document.getElementById('pi'); _I.focus(); _I.value = 'Собир'; _I.setSelectionRange(2,4); _I.dispatchEvent(new Event('input')); }")
    pg.wait_for_timeout(5000)
    r=pg.evaluate("() => ({ same: document.getElementById('pi') === _I, foc: document.activeElement === _I, v: _I.value, s: _I.selectionStart, e: _I.selectionEnd, logs: document.querySelectorAll('#lg .mm').length, title: document.querySelector('#pv .tt').textContent })")
    ck('опросов за 5 с ≥ 4', N[0]>=4, N[0])
    ck('поле ввода — тот же элемент (не пересоздано)', r['same'], r)
    ck('фокус в поле сохранён', r['foc'], r)
    ck('текст и выделение не тронуты (2–4)', r['v']=='Собир' and r['s']==2 and r['e']==4, r)
    ck('лента помощника и состояние обновляются', r['logs']>=2 and r['title'].startswith('Этап'), r)
    pg.keyboard.press('End'); pg.keyboard.type('аю'); pg.keyboard.press('Enter'); pg.wait_for_timeout(1500)
    ck('Enter — сообщение ушло, поле очищено', any(c['k']=='say' and c['v']=='Собираю' for c in SENT) and pg.evaluate("_I.value")=='', SENT)
    pg.click('[data-k=go]'); pg.wait_for_timeout(1200)
    ck('кнопка ▶ Пуск работает после перерисовок', any(c['k']=='go' for c in SENT), SENT)
    pg.fill('#pi','тест'); pg.click('#pg'); pg.wait_for_timeout(1200)
    ck('➤ отправляет', any(c['k']=='say' and c['v']=='тест' for c in SENT))
    pg.click('#mn'); pg.wait_for_timeout(800)
    ck('☰ → выбор станка, обратно — каркас заново, поле работает', pg.locator('[data-pc]').count()==1)
    pg.click('[data-pc]'); pg.wait_for_timeout(1500)
    ck('после возврата поле есть, кнопки живые', pg.locator('#pi').count()==1 and pg.locator('[data-k=go]').count()==1)
    ck('без ошибок страницы', not errs, errs)
    b.close()
print('ИТОГ', sum(res), '/', len(res)); sys.exit(0 if all(res) else 1)
