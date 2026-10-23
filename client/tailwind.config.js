/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['Outfit', 'system-ui', 'sans-serif'],
        sans: ['"DM Sans"', 'system-ui', 'sans-serif'],
      },
      colors: {
        ink: { 900: '#0f172a' },
        // The brand moved from indigo to the gauge blue; existing indigo classes follow it.
        indigo: {
          50: '#eef3fe',
          100: '#dde7fd',
          200: '#c2d3fb',
          300: '#9bb6f8',
          400: '#6f93f4',
          500: '#4a78f2',
          600: '#2f5fee',
          700: '#2450d6',
          800: '#1f43ad',
          900: '#1f3d88',
          950: '#172654',
        },
      },
      boxShadow: {
        card: '0 8px 30px rgba(15, 23, 42, 0.08)',
        lift: '0 12px 40px rgba(47, 95, 238, 0.15)',
      },
    },
  },
  plugins: [],
};
