import { createRoot } from 'react-dom/client';
import './styles.css';
import { telegramReady } from './lib/telegram';
import { App } from './App';

// Call ready()/expand() BEFORE first paint, so there is no visible layout
// jump once Telegram's WebView expands the sheet (04.1-UI-SPEC.md's
// platform integration requirements).
telegramReady();

const container = document.getElementById('root');
if (!container) {
  throw new Error('#root element not found in mini-app/index.html');
}

// Deliberately not wrapped in React's development-only double-invocation
// wrapper — its double-invocation of effects would fire the draft fetch
// twice on mount, which is noise in a WebView talking to a real server, not
// a local-only dev concern worth the tradeoff here.
createRoot(container).render(<App />);
