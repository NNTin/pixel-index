import './viewer.css';

import { createRoot } from 'react-dom/client';

import { PreviewApp } from './PreviewApp';

// Duplicated from src/main.tsx on purpose — see the note there.
const root = document.getElementById('root');
if (!root) throw new Error('live-office.html is missing its #root element.');

createRoot(root).render(<PreviewApp />);
