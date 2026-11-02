import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import { PresentationProvider, initializePresentation } from './i18n';
async function start() {
  const result = await window.journey.presentation();
  if (!result.ok) throw new Error(result.message);
  initializePresentation(result.value);
  createRoot(document.getElementById('root')!).render(<React.StrictMode><PresentationProvider initial={result.value}><App /></PresentationProvider></React.StrictMode>);
}
void start().catch(() => { document.getElementById('root')!.textContent = 'JourneyHub could not load its language settings. Please restart the app. / Não foi possível carregar o idioma. Reinicie o aplicativo.'; });
