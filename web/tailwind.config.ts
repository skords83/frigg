import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        'surface-raised': 'var(--surface-raised)',
        foreground: 'var(--text)',
        muted: 'var(--text-dim)',
        accent: {
          DEFAULT: 'var(--accent)',
          dim: 'var(--accent-dim)',
        },
        sage: 'var(--sage)',
        divider: {
          DEFAULT: 'var(--divider)',
          soft: 'var(--divider-soft)',
        },
      },
      fontFamily: {
        fraunces: ['Fraunces', 'serif'],
        plex: ['"IBM Plex Sans"', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
