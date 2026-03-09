import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}'
  ],
  theme: {
    extend: {
      colors: {
        background: '#080B10',
        'background-elevated': '#0C1018',
        panel: '#0F1520',
        'panel-elevated': '#131A27',
        accent: '#23F7DD',
        'accent-strong': '#1BD4BE',
        success: '#22E56A',
        danger: '#FF4D6A',
        gold: '#F0C040',
        blue: '#3B82F6',
        ink: '#E8EDF5',
        muted: '#5A6478',
        sub: '#8896AA'
      },
      fontFamily: {
        display: ['var(--font-display)'],
        mono: ['var(--font-mono)']
      },
      boxShadow: {
        panel: '0 24px 72px rgba(0, 0, 0, 0.38)',
        accent: '0 0 0 1px rgba(35, 247, 221, 0.18), 0 0 40px rgba(35, 247, 221, 0.06)'
      },
      keyframes: {
        marquee: {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' }
        },
        fadeSlideUp: {
          '0%': { opacity: '0', transform: 'translateY(18px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' }
        }
      },
      animation: {
        marquee: 'marquee 24s linear infinite',
        fadeSlideUp: 'fadeSlideUp 0.55s ease forwards'
      }
    }
  },
  plugins: []
};

export default config;
