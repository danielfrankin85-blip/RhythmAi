/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        game: {
          bg: '#0b0f14',
          surface: '#111827',
          panel: '#1f2937',
          border: '#374151',
          accent: '#38bdf8',
          accentStrong: '#0ea5e9',
          text: '#f8fafc',
          muted: '#9ca3af'
        }
      },
      boxShadow: {
        glow: '0 0 0 2px rgba(56, 189, 248, 0.25)',
      }
    }
  },
  plugins: []
};
