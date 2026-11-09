import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';

const rootEl = document.getElementById('root') as HTMLElement;
const isDesktopLyricWindow =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('window') === 'desktop-lyric';

if (isDesktopLyricWindow) {
  document.documentElement.classList.add('desktop-lyric-window');
  import('./components/DesktopLyricStandaloneWindow').then(
    ({ DesktopLyricStandaloneWindow }) => {
      ReactDOM.createRoot(rootEl).render(
        <React.StrictMode>
          <DesktopLyricStandaloneWindow />
        </React.StrictMode>
      );
    }
  );
} else {
  import('./App').then(({ App }) => {
    ReactDOM.createRoot(rootEl).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  });
}
