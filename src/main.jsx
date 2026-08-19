// PATCH: Wymuszamy preserveDrawingBuffer: true dla WebGL, żeby toDataURL() na mapie Google 3D
// zwracał aktualny kadr, a nie pusty bufor. Musi być PRZED załadowaniem Google Maps.
const _origGetContext = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function (type, attrs) {
  if (type === 'webgl' || type === 'webgl2') {
    attrs = Object.assign({}, attrs, { preserveDrawingBuffer: true });
  }
  return _origGetContext.call(this, type, attrs);
};

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

// Initialize Firebase (side-effect import to ensure it's loaded)
import './lib/firebase.js';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
