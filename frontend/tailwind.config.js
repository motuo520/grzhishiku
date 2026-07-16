/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        'bg-primary': 'rgb(var(--bg-primary) / <alpha-value>)',
        'bg-secondary': 'rgb(var(--bg-secondary) / <alpha-value>)',
        'bg-tertiary': 'rgb(var(--bg-tertiary) / <alpha-value>)',
        'bg-hover': 'rgb(var(--bg-hover) / <alpha-value>)',
        'bg-active': 'rgb(var(--bg-active) / <alpha-value>)',
        'text-primary': 'rgb(var(--text-primary) / <alpha-value>)',
        'text-secondary': 'rgb(var(--text-secondary) / <alpha-value>)',
        'text-muted': 'rgb(var(--text-muted) / <alpha-value>)',
        'border-color': 'rgb(var(--border-color) / <alpha-value>)',
        'border-light': 'rgb(var(--border-light) / <alpha-value>)',
        'personal-primary': '#d29922',
        'personal-secondary': '#e3b341',
        'network-primary': '#58a6ff',
        'network-secondary': '#79b8ff',
        'fusion-primary': '#a371f7',
        'fusion-secondary': '#bc8cff',
        'success': '#238636',
        'warning': '#d29922',
        'danger': '#f85149',
        'info': '#c8956c',
        'admin-bg': '#000000',
        'admin-sidebar': '#000000',
        'admin-border': 'rgba(255,255,255,0.08)',
        'admin-text': '#e8e8e8',
        'admin-muted': '#999999',
        'admin-hover': 'rgba(255,255,255,0.05)',
        'admin-primary': '#58a6ff',
        'accent': '#c8956c',
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Noto Sans SC',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'pulse-slow': 'pulse 3s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
};
