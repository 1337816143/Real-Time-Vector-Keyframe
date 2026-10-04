"""Actual shader pixel checks with SYNTHETIC streams. No webcam, model or phone claim."""
import json, os
from pathlib import Path
from playwright.sync_api import sync_playwright
out=Path('test-results/quad-gpu');out.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
    launch={'headless':True,'args':['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']}
    if os.environ.get('CHROMIUM_PATH'):launch['executable_path']=os.environ['CHROMIUM_PATH']
    browser=p.chromium.launch(**launch)
    page=browser.new_page(viewport={'width':800,'height':900})
    errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
    page.set_content('<html><body></body></html>')
    page.add_script_tag(content=Path('test-results/quad-gpu-fixture.js').read_text())
    report=page.evaluate('() => window.runQuadGpuTests()')
    assert not errors,errors
    page.screenshot(path=str(out/'quad-gpu.png'))
    (out/'report.json').write_text(json.dumps(report,indent=2))
    print(json.dumps(report));browser.close()
