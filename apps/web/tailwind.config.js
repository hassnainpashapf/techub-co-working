/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx}', './components/**/*.{js,jsx}'],
  theme: {
    extend: {
      // 4K-ready breakpoints: keep all defaults, add large screens
      screens: {
        '3xl': '1920px',
        '4xl': '2560px',
      },
    },
  },
  plugins: [],
};
