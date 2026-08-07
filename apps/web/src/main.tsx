import './index.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import { App } from './App';
import { AuthProvider } from './auth/AuthContext';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* basename matches vite.config.ts's `base` — the router has to agree
        with the asset base path, or a GitHub Pages project-site deploy
        would resolve every route one level too shallow. */}
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
