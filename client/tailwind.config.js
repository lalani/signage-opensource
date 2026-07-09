/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Outfit', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      colors: {
        base:    '#080B14',
        surface: '#0F1525',
        card:    '#141C30',
        border:  '#1E2940',
        teal:  { DEFAULT: '#26E4C8', dim: '#1A9E8E', glow: '#26E4C820' },
        coral: { DEFAULT: '#F25757', dim: '#A83C3C', glow: '#F2575720' },
        amber: { DEFAULT: '#F5A623', dim: '#A87018', glow: '#F5A62320' },
        txt:   { primary: '#E8EAF0', secondary: '#6B7A99', muted: '#3A4560' },
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4,0,0.6,1) infinite',
      },
    },
  },
}
