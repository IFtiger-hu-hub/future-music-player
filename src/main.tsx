import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { DesktopLyricStandaloneWindow } from './components/DesktopLyricOverlay';
import './index.css';

const isDesktopLyricWindow =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('window') === 'desktop-lyric';

if (isDesktopLyricWindow) {
  document.documentElement.classList.add('desktop-lyric-window');
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    {isDesktopLyricWindow ? <DesktopLyricStandaloneWindow /> : <App />}
  </React.StrictMode>
);
