// Scaffolding entry point only. There is no user interface yet: this renders an
// empty root element so that `npm run build` produces a valid `dist`.
import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';

const container = document.getElementById('root');

if (container) {
  createRoot(container).render(React.createElement(React.Fragment));
}
