/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Arial','Helvetica','sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
        display: ['Arial', 'Helvetica', 'sans-serif'],
      },
      colors: {
        ink: {
          50: '#F7F7F8',
          100: '#EDEDEF',
          200: '#D9DADE',
          300: '#A8AAB2',
          400: '#717480',
          500: '#4B4E59',
          600: '#33353D',
          700: '#22242A',
          800: '#16181C',
          900: '#0C0D10',
          950: '#070709',
        },
        accent: {
          DEFAULT: '#7C5CFF',
          soft: '#9F87FF',
          dim: '#5B3FD1',
        },
      },
      boxShadow: {
        panel: '0 1px 0 0 rgba(255,255,255,0.04) inset, 0 0 0 1px rgba(255,255,255,0.06)',
      },
    },
  },
  plugins: [],
};
