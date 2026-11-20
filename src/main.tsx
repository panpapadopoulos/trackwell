import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import './index.css';
import { ThemeProvider } from './app/providers/theme';
import { DataProvider } from './app/providers/data';
import { createRouter } from './app/router';
import { NoticeProvider } from './app/ui/forms';

const router = createRouter();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <DataProvider>
        <NoticeProvider>
          <RouterProvider router={router} />
        </NoticeProvider>
      </DataProvider>
    </ThemeProvider>
  </StrictMode>,
);
