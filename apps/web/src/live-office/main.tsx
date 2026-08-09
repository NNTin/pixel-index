import '../../../../vendor/pixel-agents/webview-ui/src/index.css';
import './viewer.css';

import { createRoot } from 'react-dom/client';

import { PreviewApp } from './PreviewApp';

createRoot(document.getElementById('root')!).render(<PreviewApp />);
