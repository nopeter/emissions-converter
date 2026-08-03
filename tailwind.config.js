/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // One accent, used only for interactive elements. #0f766e reaches
        // 5.0:1 against white as text and 5.0:1 as a background behind white
        // text, so it is safe in both directions at the 4.5:1 minimum.
        accent: {
          DEFAULT: '#0f766e',
          strong: '#115e59',
        },
      },
      fontFamily: {
        sans: [
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};
