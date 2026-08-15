import ReactDOM from 'react-dom/client';
import App from './App';
import { installCustomMaskRuntime } from './engine/customMaskRuntime';
import './styles.css';

installCustomMaskRuntime();

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
