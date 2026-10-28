import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type ThemePref = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

// Same key is read by the inline script in index.html to avoid a flash on load.
export const THEME_KEY = 'ssi-theme';

const media = () => window.matchMedia('(prefers-color-scheme: dark)');

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    /* storage unavailable */
  }
  return 'system';
}

function apply(resolved: ResolvedTheme, animate: boolean) {
  const root = document.documentElement;
  if (animate) {
    root.classList.add('theme-transition');
    window.setTimeout(() => root.classList.remove('theme-transition'), 400);
  }
  root.classList.toggle('dark', resolved === 'dark');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'dark' ? '#06171E' : '#FFFFFF');
}

interface ThemeValue {
  pref: ThemePref;
  resolved: ResolvedTheme;
  setPref: (p: ThemePref) => void;
}

const ThemeCtx = createContext<ThemeValue>({ pref: 'system', resolved: 'light', setPref: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<ThemePref>(readPref);
  const [systemDark, setSystemDark] = useState(() => media().matches);
  const resolved: ResolvedTheme = pref === 'system' ? (systemDark ? 'dark' : 'light') : pref;

  useEffect(() => {
    const m = media();
    const h = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    m.addEventListener('change', h);
    return () => m.removeEventListener('change', h);
  }, []);

  useEffect(() => apply(resolved, document.documentElement.dataset.themeReady === '1'), [resolved]);
  useEffect(() => {
    document.documentElement.dataset.themeReady = '1';
  }, []);

  const setPref = useCallback((p: ThemePref) => {
    setPrefState(p);
    try {
      localStorage.setItem(THEME_KEY, p);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo(() => ({ pref, resolved, setPref }), [pref, resolved, setPref]);
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export const useTheme = () => useContext(ThemeCtx);

/** Colours for Recharts, which writes SVG attributes and so cannot read CSS variables. */
export function useChartColors() {
  const { resolved } = useTheme();
  return useMemo(
    () =>
      resolved === 'dark'
        ? {
            grid: '#1D3844',
            tick: '#A6B8C0',
            tickMute: '#708892',
            navy: '#9FC2CF',
            cursor: 'rgba(251,165,30,0.08)',
            dot: '#0C242E',
            tooltip: { background: '#0C242E', border: '1px solid #1D3844', color: '#E2EAEE' },
          }
        : {
            grid: '#EDEEF2',
            tick: '#64748B',
            tickMute: '#94A3B8',
            navy: '#06242F',
            cursor: '#FFF8EC',
            dot: '#FFFFFF',
            tooltip: { background: '#FFFFFF', border: '1px solid #EDEEF2', color: '#0F172A' },
          },
    [resolved],
  );
}
