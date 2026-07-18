/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  darkMode: 'class',
  /* 动态拼接（replace('text-','bg-')）的类名需要 safelist 保底 */
  safelist: [
    'bg-personal-primary', 'bg-network-primary', 'bg-fusion-primary',
    'text-personal-primary', 'text-network-primary', 'text-fusion-primary',
  ],
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
        /* 编辑杂志风语义色：朱砂 / 靛蓝 / 松绿 */
        'personal-primary': '#bd4a2e',
        'personal-secondary': '#d4694a',
        'network-primary': '#5b7c99',
        'network-secondary': '#7a97ad',
        'fusion-primary': '#7d8f6a',
        'fusion-secondary': '#98a983',
        'success': '#7d8f6a',
        'warning': '#b08a3e',
        'danger': '#b03a2e',
        'info': '#bd4a2e',
        'admin-bg': '#000000',
        'admin-sidebar': '#000000',
        'admin-border': 'rgba(255,255,255,0.08)',
        'admin-text': '#e8e8e8',
        'admin-muted': '#999999',
        'admin-hover': 'rgba(255,255,255,0.05)',
        'admin-primary': '#58a6ff',
        'accent': '#bd4a2e',
      },
      fontFamily: {
        serif: [
          'Noto Serif SC',
          'Source Han Serif SC',
          'Songti SC',
          'STSong',
          'STZhongsong',
          'SimSun',
          'serif',
        ],
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
