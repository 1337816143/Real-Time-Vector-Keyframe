import ReactDOM from 'react-dom/client';
import App from './App';
import { installCustomMaskRuntime } from './engine/customMaskRuntime';
import { installSceneGestureRuntime } from './engine/sceneGestureRuntime';
import { installSceneInteractionRuntime } from './engine/sceneInteractionRuntime';
import { installSceneRuntime } from './engine/sceneRuntime';
import './styles.css';

installCustomMaskRuntime();
installSceneGestureRuntime();
installSceneRuntime();
installSceneInteractionRuntime();

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
