import colors from 'tailwindcss/colors';

const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;

// Light tints (50–200) and 700 text shades of the default palette become theme
// variables so badges, icon chips and alerts read well in dark mode too.
const tint = (name, shades) => ({
  ...colors[name],
  ...Object.fromEntries(shades.map((s) => [s, v(`${name}-${s}`)])),
});
const tints = {
  emerald: tint('emerald', [50, 100, 200, 700]),
  red: tint('red', [50, 100, 200, 700]),
  amber: tint('amber', [50, 100, 200, 700]),
  blue: tint('blue', [50, 100, 200, 700]),
  violet: tint('violet', [50, 100, 200, 700]),
  teal: tint('teal', [50, 100, 200, 700]),
  slate: tint('slate', [100, 200, 600]),
  rose: tint('rose', [100]),
  pink: tint('pink', [50]),
  sky: tint('sky', [50]),
  indigo: tint('indigo', [50]),
  orange: tint('orange', [50]),
};

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Theme-aware tokens resolve to CSS variables defined in src/index.css
        // (light values on :root, dark values on .dark).
        navy: {
          DEFAULT: '#06242F',
          50: v('navy-50'), 100: v('navy-100'), 200: v('navy-200'), 300: '#7F9DA8',
          400: '#4F7380', 500: '#2A4F5C', 600: '#163A47', 700: '#0D2E3A', 800: '#06242F', 900: '#041A22',
        },
        brand: {
          DEFAULT: '#FBA51E',
          50: v('brand-50'), 100: v('brand-100'), 200: v('brand-200'), 300: '#FCC566', 400: '#FBA51E',
          500: '#E58A0E', 600: '#B94A12', 700: v('brand-700'), 800: '#7A3012',
        },
        rust: { DEFAULT: v('rust'), 50: v('rust-50'), 100: v('rust-100') },
        ink: { DEFAULT: v('ink'), soft: v('ink-soft'), mute: v('ink-mute') },
        heading: v('heading'),
        surface: v('surface'),
        line: v('line'),
        canvas: v('canvas'),
        ...tints,
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['Lexend', '"Plus Jakarta Sans"', 'sans-serif'],
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        lift: 'var(--shadow-lift)',
        glow: '0 8px 24px -8px rgba(185,74,18,0.55)',
      },
      borderRadius: { xl2: '1.125rem' },
      keyframes: {
        'fade-up': { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'none' } },
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-in-left': { from: { transform: 'translateX(-100%)' }, to: { transform: 'none' } },
        'scale-in': { from: { opacity: '0', transform: 'scale(.96) translateY(6px)' }, to: { opacity: '1', transform: 'none' } },
        'slide-in': { from: { transform: 'translateX(100%)' }, to: { transform: 'none' } },
        float: { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-10px)' } },
        dash: { to: { strokeDashoffset: '-40' } },
        'pop-in': { from: { opacity: '0', transform: 'scale(.96) translateY(-4px)' }, to: { opacity: '1', transform: 'none' } },
        'pop-out': { from: { opacity: '1', transform: 'none' }, to: { opacity: '0', transform: 'scale(.96) translateY(-4px)' } },
      },
      animation: {
        'fade-up': 'fade-up .45s cubic-bezier(.2,.8,.2,1) both',
        'fade-in': 'fade-in .25s ease both',
        'slide-in-left': 'slide-in-left .3s cubic-bezier(.2,.8,.2,1) both',
        'scale-in': 'scale-in .25s cubic-bezier(.2,.8,.2,1) both',
        'slide-in': 'slide-in .32s cubic-bezier(.2,.8,.2,1) both',
        float: 'float 6s ease-in-out infinite',
        dash: 'dash 2s linear infinite',
        'pop-in': 'pop-in .16s cubic-bezier(.2,.8,.2,1) both',
        'pop-out': 'pop-out .12s ease-in both',
      },
    },
  },
  plugins: [],
};
