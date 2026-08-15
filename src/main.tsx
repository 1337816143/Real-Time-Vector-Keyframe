import ReactDOM from 'react-dom/client';
import App from './App';
import { installCustomMaskRuntime } from './engine/customMaskRuntime';
import { installSceneGestureRuntime } from './engine/sceneGestureRuntime';
import { installSceneInteractionRuntime } from './engine/sceneInteractionRuntime';
import { installSceneMotionRuntime } from './engine/sceneMotionRuntime';
import { installSceneRuntime } from './engine/sceneRuntime';
import './styles.css';

installCustomMaskRuntime();
installSceneGestureRuntime();
installSceneRuntime();
installSceneInteractionRuntime();
installSceneMotionRuntime();

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
