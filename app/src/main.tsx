import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import './styles/global.css';
import App from './App';
import { applyAppearance } from '@/lib/appearance';
import { useStore } from '@/store/useStore';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Root element #root not found');
}

applyAppearance(useStore.getState().appearance);

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
