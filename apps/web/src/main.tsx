import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { LocaleProvider } from './i18n';
import '@fontsource/golos-text/400.css';
import '@fontsource/golos-text/500.css';
import '@fontsource/golos-text/600.css';
import '@fontsource/fira-sans-condensed/500.css';
import '@fontsource/fira-sans-condensed/600.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import './styles.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode><LocaleProvider><App /></LocaleProvider></React.StrictMode>);
