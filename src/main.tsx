import ReactDOM from 'react-dom/client';
import App from './App';
import PerformanceProfiler from './components/PerformanceProfiler';
import { installAdaptiveQualityRuntime } from './engine/adaptiveQualityRuntime';
import { installCameraRecoveryRuntime } from './engine/cameraRecoveryRuntime';
import { installCustomMaskRuntime } from './engine/customMaskRuntime';
import { installEdgeFxRuntime } from './engine/edgeFxRuntime';
import { installGpuProfilerRuntime } from './engine/gpuProfiler';
import { installSceneGestureRuntime } from './engine/sceneGestureRuntime';
import { installSceneInteractionRuntime } from './engine/sceneInteractionRuntime';
import { installSceneMotionRuntime } from './engine/sceneMotionRuntime';
import { installSceneRuntime } from './engine/sceneRuntime';
import { installSceneTrailRuntime } from './engine/sceneTrailRuntime';
import './styles.css';
import './camera-recovery.css';

installCustomMaskRuntime();
installSceneGestureRuntime();
installSceneRuntime();
installSceneInteractionRuntime();
installSceneTrailRuntime();
installSceneMotionRuntime();
installEdgeFxRuntime();
installGpuProfilerRuntime();
installAdaptiveQualityRuntime();
installCameraRecoveryRuntime();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <>
    <App />
    <PerformanceProfiler />
  </>,
);
