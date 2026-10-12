import React from 'react';
import { createRoot } from 'react-dom/client';
import '../../styles.css';
import { CompanionApp } from './App';

const root = createRoot(document.getElementById('root')!);
root.render(
  <React.StrictMode>
    <CompanionApp />
  </React.StrictMode>,
);
