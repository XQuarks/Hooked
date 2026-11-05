import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

// 游戏类单页：不用 StrictMode，避免开发态双挂载导致 WebGL 上下文被创建两次
createRoot(root).render(<App />);
