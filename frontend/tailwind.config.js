/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        boutique: {
          50: '#FAF8F5',
          100: '#F5EFE6',
          200: '#E8DCCF',
          300: '#D5C1AE',
          400: '#BEA088',
          500: '#A47E64',
          600: '#8A634C',
          700: '#6E4D3B',
          800: '#53392C',
          900: '#3D281E',
        },
        sage: {
          50: '#F4F7F5',
          100: '#E5EDE7',
          200: '#C7D9CD',
          300: '#A3BFAC',
          400: '#7FA38B',
          500: '#587B6D',
          600: '#466257',
          700: '#354B43',
        },
        terracotta: {
          DEFAULT: '#C27D56',
          dark: '#A66540',
          light: '#DE9973',
        }
      },
      fontFamily: {
        serif: ['Playfair Display', 'Georgia', 'serif'],
        sans: ['Plus Jakarta Sans', 'Inter', 'system-ui', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
