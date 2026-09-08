"""Offline Chromium regressions against the actual Vite production bundle.

Uses synthetic local MediaStreams and deliberately unavailable model requests.
Does not claim hardware webcam, mobile device or hand-landmark validation.
Run after npm run build: python tests/browser_smoke.py --require-gpu
"""
from __future__ import annotations

import argparse
import json
import os
import re
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

INSTRUMENT = """() => {
  window.__uiTest = {beats: 0, animationFrames: 0, observers: [], streams: [],
    gpuDraws: 0, pixels: null, shaderErrors: []};
  setInterval(() => window.__uiTest.beats++, 40);
  const tick = () => { window.__uiTest.animationFrames++; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  const Native = window.MutationObserver;
  window.MutationObserver = class extends Native {
    constructor(callback) {
      const stat = {calls: 0, burst: 0, maxBurst: 0, frame: -1, loop: false};
      window.__uiTest.observers.push(stat);
      super((records, observer) => {
        const frame = window.__uiTest.animationFrames;
        if (stat.frame !== frame) { stat.burst = 0; stat.frame = frame; }
        stat.calls++; stat.burst++; stat.maxBurst = Math.max(stat.maxBurst, stat.burst);
        if (stat.burst > 100) { stat.loop = true; observer.disconnect(); return; }
        callback(records, observer);
      });
    }
  };
  const proto = WebGL2RenderingContext.prototype;
  const shaderLog = proto.getShaderInfoLog;
  proto.getShaderInfoLog = function(shader) {
    const result = shaderLog.call(this, shader);
    if (result) window.__uiTest.shaderErrors.push(result);
    return result;
  };
  const draw = proto.drawArrays;
  proto.drawArrays = function(...args) {
    const result = draw.apply(this, args);
    const stat = window.__uiTest;
    if (this.canvas.classList?.contains('vfx-canvas') &&
        !this.getParameter(this.FRAMEBUFFER_BINDING) && this.drawingBufferWidth > 8) {
      stat.gpuDraws++;
      if (stat.gpuDraws % 15 === 1) {
        // Read before the default buffer is presented/discarded, outside the central mask.
        const sample = (x) => {
          const pixel = new Uint8Array(4);
          this.readPixels(Math.floor(this.drawingBufferWidth * x),
            Math.floor(this.drawingBufferHeight * .8), 1, 1, this.RGBA, this.UNSIGNED_BYTE, pixel);
          return Array.from(pixel);
        };
        stat.pixels = {left: sample(.1), right: sample(.9)};
      }
    }
    return result;
  };
}"""

MEDIA = """(deny) => {
  const source = document.createElement('canvas'); source.width = 640; source.height = 360;
  const ctx = source.getContext('2d');
  let frame = 0;
  const draw = () => {
    ctx.fillStyle = '#b73434'; ctx.fillRect(0, 0, 320, 360);
    ctx.fillStyle = '#245fc8'; ctx.fillRect(320, 0, 320, 360);
    ctx.fillStyle = 'white'; ctx.fillRect((frame++ * 6) % 600, 140, 40, 80);
  };
  draw(); setInterval(draw, 33);
  Object.defineProperty(navigator, 'mediaDevices', {configurable: true, value: {
    getUserMedia: async () => {
      if (deny) throw new DOMException('Test permission denial', 'NotAllowedError');
      const stream = source.captureStream(30); window.__uiTest.streams.push(stream); return stream;
    }
  }});
}"""


def snapshot(page):
    return page.evaluate("""() => ({...window.__uiTest,
      streams: window.__uiTest.streams.map(s => s.getTracks().map(t => t.readyState)),
      message: document.querySelector('.status-pill')?.textContent,
      recovery: document.querySelector('.camera-recovery-note')?.textContent,
      canvasLive: document.querySelector('.vfx-canvas')?.dataset.vfxLive,
      videoTime: document.querySelector('.studio-shell > video')?.currentTime
    })""")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--dist', default='dist')
    parser.add_argument('--out', default='test-results/browser')
    parser.add_argument('--require-gpu', action='store_true')
    args = parser.parse_args()
    dist, out = Path(args.dist), Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    entries = list((dist / 'assets').glob('index-*.js'))
    if len(entries) != 1:
        raise RuntimeError('Expected one Vite entry bundle; update harness for code splitting.')
    script = entries[0].read_text(encoding='utf-8')
    styles = '\n'.join(p.read_text(encoding='utf-8') for p in (dist / 'assets').glob('*.css'))
    reports = []
    with sync_playwright() as p:
        launch = dict(headless=True, args=['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        if os.environ.get('CHROMIUM_PATH'):
            launch['executable_path'] = os.environ['CHROMIUM_PATH']
        browser = p.chromium.launch(**launch)
        page = None
        scenario = 'initialization'
        errors, console = [], []
        try:
            for scenario, viewport, deny, no_gpu in [
                ('desktop-video', {'width': 1280, 'height': 800}, False, False),
                ('mobile-video', {'width': 390, 'height': 844}, False, False),
                ('camera-denied', {'width': 1280, 'height': 800}, True, False),
                ('webgl-unavailable', {'width': 1280, 'height': 800}, False, True),
            ]:
                page = browser.new_page(viewport=viewport)
                page.set_default_timeout(10000)
                page.route('https://**/*', lambda route: route.abort())
                errors, console = [], []
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.on('console', lambda message: console.append(message.text) if len(console) < 30 and message.type in ['error', 'warning'] else None)
                page.set_content('<!doctype html><html lang="zh-CN"><body><div id="root"></div></body></html>')
                page.evaluate(INSTRUMENT)
                page.evaluate(MEDIA, deny)
                if no_gpu:
                    page.evaluate("""() => {
                      const get = HTMLCanvasElement.prototype.getContext;
                      HTMLCanvasElement.prototype.getContext = function(type, ...args) {
                        return type.startsWith('webgl') ? null : get.call(this, type, ...args);
                      };
                    }""")
                page.add_style_tag(content=styles)
                page.add_script_tag(content=script, type='module')
                expect(page.locator('.enter-button')).to_have_text(re.compile('进入工作室'))
                page.locator('.enter-button').click()
                expect(page.locator('.studio-shell')).to_be_visible()
                expect(page.locator('button[title="镜像已固定开启"]')).to_be_disabled()
                for title in ['设置', '蒙版', '运动', '录制', '特效']:
                    page.locator('.studio-dock .dock-button').filter(has_text=title).click()
                    expect(page.locator('.panel-heading h2')).to_contain_text('手势' if title == '运动' else title)
                gpu = page.evaluate("!!document.querySelector('.vfx-canvas').getContext('webgl2')")
                if args.require_gpu and not no_gpu:
                    assert gpu, 'GPU path required but unavailable'
                if deny:
                    expect(page.locator('.fatal-card')).to_contain_text('摄像头权限被拒绝')
                else:
                    video = page.locator('.studio-shell > video').first
                    page.wait_for_function("document.querySelector('.studio-shell > video')?.currentTime > 0.15")
                    expect(video).to_have_css('transform', 'matrix(-1, 0, 0, 1, 0, 0)')
                    start = video.evaluate('(v) => v.currentTime')
                    page.wait_for_function('(previous) => document.querySelector(".studio-shell > video").currentTime > previous + .1', arg=start, timeout=3000)
                    if gpu:
                        expect(page.locator('.vfx-canvas')).to_have_attribute('data-vfx-live', 'true', timeout=10000)
                        page.wait_for_function("""() => {
                          const p = window.__uiTest.pixels;
                          return window.__uiTest.gpuDraws > 2 && p &&
                            p.left[2] > p.left[0] + 60 && p.right[0] > p.right[2] + 60;
                        }""", timeout=10000)
                        page.screenshot(path=str(out / f'{scenario}-gpu.png'))
                        page.locator('.camera-mode-toggle').click()
                        expect(page.locator('.camera-mode-toggle')).to_contain_text('原始摄像头')
                        page.evaluate("window.__modeHeading = document.querySelector('.camera-mode-toggle strong')")
                        page.wait_for_timeout(450)
                        assert page.evaluate("window.__modeHeading === document.querySelector('.camera-mode-toggle strong')")
                        page.screenshot(path=str(out / f'{scenario}-raw.png'))
                        page.locator('.camera-mode-toggle').click()
                        expect(page.locator('.camera-mode-toggle')).to_contain_text('特效自动')
                    else:
                        page.screenshot(path=str(out / f'{scenario}-raw-fallback.png'))
                    page.locator('.panel-heading button').click()
                    if viewport['width'] > 720:
                        expect(page.locator('.panel-reopen')).to_be_visible()
                        page.locator('.panel-reopen').click()
                    else:
                        page.locator('.studio-dock .dock-button').filter(has_text='特效').click()
                    expect(page.locator('.studio-panel')).to_have_class(re.compile('open'))

                page.evaluate("document.querySelector('button[title=\"镜像已固定开启\"]').setAttribute('title', '镜像已固定开启')")
                before = page.evaluate('window.__uiTest.beats')
                # Verify event-loop progress, not a 350 ms hardware-GPU performance target.
                page.wait_for_function('(previous) => window.__uiTest.beats >= previous + 2', arg=before, timeout=3000)
                stat = snapshot(page)
                assert not any(o['loop'] for o in stat['observers']), stat
                assert not stat['shaderErrors'], stat['shaderErrors']
                assert not errors, errors
                page.locator('.brand-button').click()
                expect(page.locator('.enter-button')).to_have_text(re.compile('进入工作室'))
                page.locator('.enter-button').click()
                expect(page.locator('.studio-shell')).to_be_visible()
                expect(page.locator('button[title="镜像已固定开启"]')).to_be_disabled()
                page.locator('.brand-button').click()
                expect(page.locator('.enter-button')).to_be_visible()
                assert not errors, errors
                reports.append({'scenario': scenario, 'pass': True, 'gpuAvailable': gpu, 'state': stat, 'pageErrors': errors})
                print('PASS', scenario, flush=True)
                page.close()
                page = None
        except Exception as error:
            if page:
                detail = {'scenario': scenario, 'failure': str(error), 'state': snapshot(page), 'pageErrors': errors, 'console': console}
                (out / 'failure.json').write_text(json.dumps(detail, ensure_ascii=False, indent=2), encoding='utf-8')
                print(json.dumps(detail, ensure_ascii=False), flush=True)
                page.screenshot(path=str(out / 'failure.png'))
            raise
        finally:
            browser.close()
    (out / 'report.json').write_text(json.dumps(reports, ensure_ascii=False, indent=2), encoding='utf-8')
    print('All Studio startup regressions passed.', flush=True)


if __name__ == '__main__':
    main()
