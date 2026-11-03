/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#252a25',
        muted: '#666f65',
        paper: '#f7f7f2',
        moss: '#37664d',
        mint: '#e5eee6',
        line: '#e5e8e0',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 16px 45px rgba(40, 54, 43, 0.07)',
      },
    },
  },
  plugins: [],
}
