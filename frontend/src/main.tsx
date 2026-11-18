import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './index.css';

const Lab = lazy(() => import('./lab/Lab'));
const RobotLab = lazy(() => import('./lab/RobotLab'));
const path = window.location.pathname.replace(/\/$/, '');
const LabPage = path === '/lab' ? Lab : path === '/lab/robot' ? RobotLab : null;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {LabPage ? (
      <Suspense fallback={null}>
        <LabPage />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
);
