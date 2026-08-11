import './index.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import { PreviewSourceProvider } from './api/PreviewSourceProvider';
import { App } from './App';
import { AuthProvider } from './auth/AuthProvider';
import { ThemeProvider } from './theme/ThemeProvider';

// Deliberately not shared with live-office/main.tsx, which does the same
// three lines: the two files are in different TypeScript projects
// (tsconfig.app.json excludes src/live-office, which compiles vendored sources
// at reduced strictness), and src/live-office imports nothing outside itself
// except vendor/. A shared helper would be the first crossing of that boundary.
const root = document.getElementById('root');
if (!root) throw new Error('index.html is missing its #root element.');

createRoot(root).render(
  <StrictMode>
    {/* basename matches vite.config.ts's `base` — the router has to agree
        with the asset base path, or a GitHub Pages project-site deploy
        would resolve every route one level too shallow. */}
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <ThemeProvider>
        <AuthProvider>
          <PreviewSourceProvider>
            <App />
          </PreviewSourceProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
);
