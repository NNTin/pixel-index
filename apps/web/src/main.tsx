import './index.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import { PreviewSourceProvider } from './api/PreviewSourceContext';
import { App } from './App';
import { AuthProvider } from './auth/AuthContext';
import { ThemeProvider } from './theme/ThemeContext';

createRoot(document.getElementById('root')!).render(
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
