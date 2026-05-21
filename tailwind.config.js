/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#F5C400',
          dark:    '#C99E00',
          light:   '#FFD400',
        },
        surface: {
          DEFAULT: '#0f0f0f',
          card:    '#1a1a1f',
          border:  '#2a2a30',
          input:   '#1a1a1f',
        },
      },
      fontFamily: {
        sans: ['Montserrat', 'Inter', 'sans-serif'],
      },
    },
  },
  plugins: [],
}

