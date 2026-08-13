import { useState } from 'react';
import { ArrowRight, CircleDot, Hand, ShieldCheck, Sparkles, Video } from 'lucide-react';
import Studio from './components/Studio';

export default function App() {
  const [entered, setEntered] = useState(false);
  if (entered) return <Studio onExit={() => setEntered(false)} />;

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
        <p>Browser camera + hand landmarks + GPU vector masking. Pinch a portal, move it through space, distort the edge with velocity, then record the final composite.</p>
        <button className="enter-button" onClick={() => setEntered(true)}>
          Enter Studio <ArrowRight size={19} />
        </button>
        <div className="hero-instructions">
          <span><Hand size={16} /> Pinch to grab</span>
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
        <div className="gesture-hint"><span /> PINCH / DRAG</div>
      </section>

      <footer className="landing-footer">
        <span>WEBGL2 / MEDIAPIPE / LOCAL-FIRST</span>
        <span>v0.1 MVP FOUNDATION</span>
      </footer>
    </main>
  );
}
