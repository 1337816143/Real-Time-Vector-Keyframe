import { useCallback, useState } from 'react';
import { ArrowRight, CircleDot, Hand, ShieldCheck, Sparkles, Video } from 'lucide-react';
import CustomMaskOverlay from './components/CustomMaskOverlay';
import ScenePanel from './components/ScenePanel';
import Studio from './components/Studio';

export default function App() {
  const [entered, setEntered] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const onModeChange = useCallback((value: boolean) => setAdvanced(value), []);
  if (entered) {
    return (
      <>
        <Studio onExit={() => setEntered(false)} onModeChange={onModeChange} />
        {advanced && <ScenePanel />}
        {advanced && <CustomMaskOverlay />}
      </>
    );
  }

  return (
    <main className="landing">
      <div className="landing-grid" />
      <header className="landing-nav">
        <div className="landing-brand"><span><CircleDot size={18} /></span> VECTOR KEYFRAME</div>
        <div className="privacy-copy"><ShieldCheck size={15} /> Camera frames stay local</div>
      </header>

      <section className="hero">
        <div className="hero-kicker"><i /> REALTIME GESTURE VFX</div>
        <h1>Grab the visual world<br />with your hand.</h1>
        <p>张开双手食指与拇指，四个指尖围出实时变化的窗口。窗口内显示特效，外面保留摄像头；可录制最终画面，原有高级蒙版仍可切换使用。</p>
        <button className="enter-button" onClick={() => setEntered(true)}>
          Enter Studio <ArrowRight size={19} />
        </button>
        <div className="hero-instructions">
          <span><Hand size={16} /> 四指尖围出窗口</span>
          <span><Sparkles size={16} /> Move to morph</span>
          <span><Video size={16} /> Record canvas</span>
        </div>
      </section>

      <section className="hero-visual" aria-hidden="true">
        <div className="portal-orbit orbit-one" />
        <div className="portal-orbit orbit-two" />
        <div className="hero-portal">
          <div className="portal-noise" />
          <div className="portal-core" />
        </div>
        <div className="gesture-hint"><span /> LI → RI → RT → LT</div>
      </section>

      <footer className="landing-footer">
        <span>WEBGL2 / MEDIAPIPE / LOCAL-FIRST</span>
        <span>四指尖 GPU 蒙版 · 本地处理</span>
      </footer>
    </main>
  );
}
