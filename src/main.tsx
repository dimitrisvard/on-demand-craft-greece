import './i18n';
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import './styles/blog-content.css'

createRoot(document.getElementById("root")!).render(<App />);
