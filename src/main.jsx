import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

// Anti-clickjacking runtime guard (defends hosts that don't enforce X-Frame-Options / CSP headers)
let isCrossOriginFramed = false;
try {
  if (window.self !== window.top && window.top?.location?.origin !== window.location.origin) {
    isCrossOriginFramed = true;
  }
} catch {
  isCrossOriginFramed = true;
}

const rootEl = document.getElementById('root');
if (isCrossOriginFramed) {
  rootEl.textContent = 'Blocked: embedding in external frames is not allowed.';
} else {
  createRoot(rootEl).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}
