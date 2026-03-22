/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['Outfit', 'system-ui', 'sans-serif'],
        sans: ['"DM Sans"', 'system-ui', 'sans-serif'],
      },
      colors: {
        ink: { 900: '#0f172a' },
      },
      boxShadow: {
        card: '0 8px 30px rgba(15, 23, 42, 0.08)',
        lift: '0 12px 40px rgba(79, 70, 229, 0.15)',
      },
    },
  },
  plugins: [],
};
