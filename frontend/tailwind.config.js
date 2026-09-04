/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      colors: {
        // Semantic, theme-aware tokens. Values live as CSS vars in index.css:
        // :root = light theme, .dark = dark theme (dark values match the
        // original hard-coded palette so dark mode is visually unchanged).
        app: 'rgb(var(--c-app) / <alpha-value>)',
        card: 'rgb(var(--c-card) / <alpha-value>)',
        panel: 'rgb(var(--c-panel) / <alpha-value>)',
        muted: 'rgb(var(--c-muted) / <alpha-value>)',
        line: 'rgb(var(--c-line) / <alpha-value>)',
        fg: {
          DEFAULT: 'rgb(var(--c-fg) / <alpha-value>)',
          soft: 'rgb(var(--c-fg-soft) / <alpha-value>)',
          muted: 'rgb(var(--c-fg-muted) / <alpha-value>)',
          faint: 'rgb(var(--c-fg-faint) / <alpha-value>)',
        },
        health: {
          50: '#f0fdfa',
          100: '#ccfbf1',
          200: '#99f6e4',
          300: '#5eead4',
          400: '#2dd4bf',
          500: '#14b8a6',
          600: '#0d9488',
          700: '#0f766e',
          800: '#115e59',
          900: '#134e4a',
          950: '#042f2e',
        },
        medical: {
          blue: '#0284c7',
          cyan: '#06b6d4',
          teal: '#0d9488',
          emerald: '#10b981',
          dark: '#080e1a',
          card: '#0c1628',
          border: 'rgba(255, 255, 255, 0.08)',
          glow: 'rgba(13, 148, 136, 0.15)',
        },
        vital: {
          50: '#fff1f2',
          100: '#ffe4e6',
          500: '#f43f5e',
          600: '#e11d48',
          700: '#be123c',
          900: '#881337',
        },
      },
      boxShadow: {
        'health-glow': '0 0 25px -5px rgba(13, 148, 136, 0.25)',
        'vital-glow': '0 0 25px -5px rgba(225, 29, 72, 0.3)',
        'card-soft': '0 10px 30px -10px rgba(0, 0, 0, 0.5)',
      },
      animation: {
        'pulse-subtle': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fadeIn 0.25s ease-out',
        'slide-up': 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}
