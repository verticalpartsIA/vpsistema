/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#F59E0B',
          dark:    '#D97706',
          light:   '#FCD34D',
        },
        surface: {
          DEFAULT: '#0F172A',
          card:    '#1E293B',
          border:  '#334155',
          input:   '#1E293B',
        },
      },
      fontFamily: {
        sans: ['Montserrat', 'Inter', 'sans-serif'],
      },
    },
  },
  plugins: [],
}

