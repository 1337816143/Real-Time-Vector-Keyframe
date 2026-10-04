"""Production UI lifecycle with a fake Face Worker and synthetic camera, no real media."""
import functools,json,os,threading
from pathlib import Path
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from playwright.sync_api import sync_playwright,expect
from browser_smoke import INSTRUMENT,MEDIA
out=Path('test-results/face-ui');out.mkdir(parents=True,exist_ok=True)
handler=functools.partial(SimpleHTTPRequestHandler,directory=str(Path('dist').resolve()))
server=ThreadingHTTPServer(('127.0.0.1',0),handler);threading.Thread(target=server.serve_forever,daemon=True).start()
base=f'http://127.0.0.1:{server.server_port}'
reports=[]
with sync_playwright() as p:
    launch={'headless':True,'args':['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']}
    if os.environ.get('CHROMIUM_PATH'):launch['executable_path']=os.environ['CHROMIUM_PATH']
    browser=p.chromium.launch(**launch)
    try:
        for viewport in [{'width':1280,'height':800},{'width':390,'height':844}]:
            page=browser.new_page(viewport=viewport);errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
            page.route('https://**/*',lambda route:route.abort())
            page.add_init_script('('+INSTRUMENT+')()');page.add_init_script('('+MEDIA+')(false)')
            page.add_init_script('''window.__faceWorkers=[];window.Worker=class {
              constructor(url,options){this.url=String(url);this.options=options;this.terminated=false;window.__faceWorkers.push(this);}
              postMessage(m){if(m.type==='init')queueMicrotask(()=>this.onmessage?.({data:{type:'ready',delegate:'SYNTHETIC'}}));}
              terminate(){this.terminated=true;}
            };''')
            try:
                page.goto(base+'/');page.locator('.enter-button').click();expect(page.locator('.studio-shell')).to_be_visible()
                page.wait_for_function("document.querySelector('.studio-shell > video')?.currentTime > .1")
                assert page.evaluate('window.__faceWorkers.length')==0
                page.get_by_role('button',name='高级蒙版 / 原有功能',exact=True).click()
                carousel=page.locator('.toggle-row').filter(has_text='自动轮播').locator('input')
                selected=page.locator('.preset-button.selected').inner_text()
                carousel.check()
                page.wait_for_function('(previous)=>document.querySelector(".preset-button.selected")?.innerText!==previous',arg=selected,timeout=10000)
                assert page.evaluate('window.__faceWorkers.length')==0,'Carousel opted into face tracking'
                expect(page.get_by_role('button',name='高级蒙版 / 原有功能',exact=True)).to_have_class('selected')
                carousel.uncheck()
                page.locator('.preset-button').filter(has_text='蜘蛛英雄面罩').click()
                page.wait_for_function('window.__faceWorkers.length===1')
                expect(page.get_by_role('button',name='双手四指尖窗口',exact=True)).to_have_class('selected')
                expect(page.locator('.face-status')).to_contain_text('请让单人脸进入四指尖窗口')
                expect(page.locator('.panel-note').filter(has_text='MediaPipe')).to_contain_text('可能发送性能/使用统计')
                assert page.locator('a',has_text='SDK隐私说明').get_attribute('href').endswith('#privacy-notice')
                page.locator('.preset-button').filter(has_text='蜘蛛英雄面罩').click()
                assert page.evaluate('window.__faceWorkers.length')==1,'Repeated selection duplicated Worker'
                page.evaluate("window.__faceWorkers[0].onmessage({data:{type:'error',message:'合成模型失败'}})")
                expect(page.locator('.face-status')).to_contain_text('合成模型失败')
                assert page.evaluate('window.__faceWorkers[0].terminated')
                page.get_by_role('button',name='重试人脸追踪',exact=True).click()
                page.wait_for_function('window.__faceWorkers.length===2')
                expect(page.locator('.face-status')).to_contain_text('请让单人脸进入四指尖窗口')
                page.screenshot(path=str(out/f"face-{viewport['width']}.png"))
                page.get_by_role('button',name='高级蒙版 / 原有功能',exact=True).click()
                page.wait_for_function('window.__faceWorkers.every(w=>w.terminated)')
                expect(page.locator('.face-status')).to_have_count(0)
                page.locator('.preset-button').filter(has_text='蜘蛛英雄面罩').click()
                page.wait_for_function('window.__faceWorkers.length===3')
                page.locator('.brand-button').click();expect(page.locator('.enter-button')).to_be_visible()
                assert page.evaluate('window.__faceWorkers.every(w=>w.terminated)')
                assert page.evaluate('window.__uiTest.streams.every(s=>s.getTracks().every(t=>t.readyState==="ended"))')
                assert not errors,errors
                reports.append({'viewport':viewport,'pass':True,'workersCreated':3,'allWorkersTerminated':True,'advancedCarouselPreserved':True,'pageErrors':errors})
            except Exception as error:
                (out/'failure.json').write_text(json.dumps({'error':str(error),'viewport':viewport,'pageErrors':errors},indent=2));page.screenshot(path=str(out/'failure.png'));raise
            finally:page.close()
    finally:browser.close();server.shutdown()
(out/'report.json').write_text(json.dumps(reports,indent=2));print(json.dumps(reports))
