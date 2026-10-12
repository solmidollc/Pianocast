import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

/**
 * The desktop app has two views inside one renderer bundle:
 *   - Editor  (default)         — the composing UI
 *   - Output  (?view=output)    — fullscreen ProgramOutput, mounted into a
 *                                 hidden offscreen BrowserWindow whose pixels
 *                                 main captures for the virtual camera.
 *
 * Splitting on a URL parameter lets Electron load the second window with the
 * same bundle, avoiding a second Vite build and keeping the two views in
 * lock-step on every code change.
 */
const params = new URLSearchParams(window.location.search);
const view = params.get('view');
const root = createRoot(document.getElementById('root')!);

if (view === 'output') {
  import('./output/OutputView').then(({ OutputView }) => {
    root.render(
      <React.StrictMode>
        <OutputView />
      </React.StrictMode>,
    );
  });
} else {
  import('./App').then(({ App }) => {
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  });
}
