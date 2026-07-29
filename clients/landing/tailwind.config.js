/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts}'],
  theme: {
    extend: {
      colors: {
        terminal: {
          bg: '#f5f5f7',
          surface: '#ffffff',
          border: '#d2d2d7',
          text: '#1d1d1f',
          'text-dim': '#6e6e73',
          accent: '#007aff',
          'accent-dim': '#0051d5',
        },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
        display: ['Orbitron', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['SF Mono', 'JetBrains Mono', 'Consolas', 'monospace'],
      },
      boxShadow: {
        aegis: '0 2px 8px rgba(0, 0, 0, 0.04)',
      },
    },
  },
  plugins: [],
}
