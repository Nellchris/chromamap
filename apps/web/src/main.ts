import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';

import { startApp } from './app';

const root = document.querySelector<HTMLDivElement>('#app');
if (root === null) {
  throw new Error('#app is missing from the page');
}

void startApp(root).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  const panel = document.querySelector<HTMLElement>('#sidebar-scroll');
  if (panel !== null) {
    panel.textContent = `The demo failed to start: ${message}`;
    panel.className = 'sidebar-scroll error';
  }
  console.error(error);
});
