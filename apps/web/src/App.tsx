import { Route, Routes } from 'react-router-dom';

import { Layout } from './components/Layout';
import { RequireAuth } from './components/RequireAuth';
import { AdminPage } from './routes/AdminPage';
import { AuthorPage } from './routes/AuthorPage';
import { Home } from './routes/Home';
import { LayoutDetailPage } from './routes/LayoutDetailPage';
import { ModerationPage } from './routes/ModerationPage';
import { MyLayoutsPage } from './routes/MyLayoutsPage';
import { NotFound } from './routes/NotFound';
import { SubmitPage } from './routes/SubmitPage';

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="layouts/:slug" element={<LayoutDetailPage />} />
        <Route path="authors/:id" element={<AuthorPage />} />
        <Route path="submit" element={<SubmitPage />} />
        <Route
          path="me/layouts"
          element={
            <RequireAuth>
              <MyLayoutsPage />
            </RequireAuth>
          }
        />
        <Route
          path="moderation"
          element={
            <RequireAuth role="moderator">
              <ModerationPage />
            </RequireAuth>
          }
        />
        <Route
          path="admin"
          element={
            <RequireAuth role="admin">
              <AdminPage />
            </RequireAuth>
          }
        />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
