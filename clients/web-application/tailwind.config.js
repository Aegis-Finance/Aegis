/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Apple-inspired palette — aligned with frontend-token-distribution
        terminal: {
          bg: '#f5f5f7',
          surface: '#ffffff',
          border: '#d2d2d7',
          muted: '#e8e8ed',
          text: '#1d1d1f',
          'text-dim': '#6e6e73',
          accent: '#007aff',
          'accent-dim': '#0051d5',
          warning: '#ff9500',
          error: '#ff3b30',
          success: '#34c759',
        },
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
        mono: ['SF Mono', 'JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
        display: ['Orbitron', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        aegis: '0 2px 8px rgba(0, 0, 0, 0.04)',
        'aegis-lg': '0 4px 16px rgba(0, 0, 0, 0.08)',
        'aegis-accent': '0 4px 12px rgba(0, 122, 255, 0.3)',
      },
      borderRadius: {
        xl: '1rem',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [],
}
