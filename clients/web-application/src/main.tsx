import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
// Latin subset only — smaller bundle than full unicode ranges (add latin-ext-* if you need extended Latin glyphs)
import '@fontsource/jetbrains-mono/latin-400.css'
import '@fontsource/jetbrains-mono/latin-500.css'
import '@fontsource/jetbrains-mono/latin-600.css'
import '@fontsource/jetbrains-mono/latin-700.css'
import './index.css'
import { registerServiceWorker } from './utils/serviceWorker'

// Register Service Worker early for DDoS protection
if (import.meta.env.PROD) {
  registerServiceWorker().catch((error) => {
    console.error('[Main] Service Worker registration failed:', error)
  })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

