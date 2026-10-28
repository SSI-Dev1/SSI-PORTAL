// Visual panel for the login page: notched illustration panel with rotating
// highlights, a floating info card, and slide controls tucked into the notch.
import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Lock, ShieldCheck, Users } from 'lucide-react';
import { Logo } from './brand';
import { EducationIllustration } from './EducationIllustration';
import { cn } from '../lib/utils';

const SLIDES = [
  {
    title: (
      <>
        Empowering Global <span className="bg-gradient-to-r from-rust to-brand bg-clip-text text-transparent">Education</span> Journeys
      </>
    ),
    body: 'Streamline applications, manage students and collaborate with every partner — in one secure workspace.',
  },
  {
    title: (
      <>
        Every application, <span className="bg-gradient-to-r from-rust to-brand bg-clip-text text-transparent">one clear</span> view
      </>
    ),
    body: 'Track assessments, offers, visas and deadlines across your partner network as they happen.',
  },
  {
    title: (
      <>
        Private <span className="bg-gradient-to-r from-rust to-brand bg-clip-text text-transparent">by design</span>
      </>
    ),
    body: 'Two-step verification, encrypted records and strict partner-level privacy for every student file.',
  },
];

export function LoginShowcase() {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const go = (d: number) => setI((x) => (x + d + SLIDES.length) % SLIDES.length);

  useEffect(() => {
    if (paused || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t = window.setInterval(() => go(1), 7000);
    return () => window.clearInterval(t);
  }, [paused]);

  return (
    <section
      className="login-panel relative hidden min-h-[640px] overflow-hidden rounded-[26px] lg:flex lg:w-[52%] lg:flex-col xl:w-[54%]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      aria-roledescription="carousel"
      aria-label="SSI GLOBAL highlights"
    >
      <div className="login-dots pointer-events-none absolute inset-0" />

      {/* Top-left notch holds the logo */}
      <div className="notch notch-top absolute left-0 top-0 z-20 flex h-[76px] w-[208px] items-center rounded-br-[24px] bg-surface pl-4">
        <Logo />
      </div>

      {/* Floating info card */}
      <div className="absolute right-6 top-6 z-10 w-[230px] rounded-2xl bg-white/85 p-4 shadow-lift ring-1 ring-black/5 backdrop-blur-md dark:bg-[#0c2a35]/85 dark:ring-white/10">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-rust dark:text-brand">
          <span className="h-1.5 w-1.5 rounded-full bg-brand" /> Partner &amp; Admissions CRM
        </div>
        <ul className="mt-3 space-y-2 text-[12.5px] font-medium text-heading">
          {[
            [ShieldCheck, 'Two-step verification'],
            [Lock, 'Encrypted in transit & at rest'],
            [Users, 'Partner-level privacy'],
          ].map(([Icon, label]) => {
            const I = Icon as typeof Lock;
            return (
              <li key={label as string} className="flex items-center gap-2">
                <I className="h-3.5 w-3.5 text-rust dark:text-brand" />
                {label as string}
              </li>
            );
          })}
        </ul>
      </div>

      {/* Illustration */}
      <div className="relative z-0 flex flex-1 items-center justify-center px-10 pb-4 pt-28">
        <EducationIllustration className="h-auto max-h-[46vh] w-full max-w-[600px]" />
      </div>

      {/* Highlight text */}
      {/* Slides share one grid cell (bottom-aligned); the outgoing slide fades out
          before the incoming one fades in, so the text never overlaps. */}
      <div className="relative z-10 grid px-10 pb-24 xl:px-12" aria-live="polite">
        {SLIDES.map((s, idx) => (
          <div
            key={idx}
            className={cn(
              'self-end transition-[opacity,transform] [grid-area:1/1]',
              idx === i
                ? 'translate-y-0 opacity-100 delay-300 duration-500'
                : 'pointer-events-none translate-y-2 opacity-0 duration-300',
            )}
            aria-hidden={idx !== i}
          >
            <h1 className="max-w-xl font-display text-[38px] font-semibold leading-[1.1] tracking-tight text-heading xl:text-[44px]">{s.title}</h1>
            <p className="mt-3 max-w-md text-[15px] leading-relaxed text-ink-soft">{s.body}</p>
          </div>
        ))}
      </div>

      {/* Bottom-left notch holds the slide controls */}
      <div className="notch notch-bottom absolute bottom-0 left-0 z-20 flex h-[64px] w-[176px] items-center gap-2 rounded-tr-[24px] bg-surface pl-4">
        <button
          type="button"
          onClick={() => go(-1)}
          aria-label="Previous highlight"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-line text-ink-soft transition hover:border-rust hover:text-rust"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => go(1)}
          aria-label="Next highlight"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-navy text-white transition hover:bg-rust dark:bg-navy-500"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <div className="ml-2 flex gap-1.5" role="tablist" aria-label="Choose highlight">
          {SLIDES.map((_, idx) => (
            <button
              key={idx}
              type="button"
              role="tab"
              aria-selected={idx === i}
              aria-label={`Highlight ${idx + 1}`}
              onClick={() => setI(idx)}
              className={cn('h-1.5 rounded-full transition-all', idx === i ? 'w-5 bg-rust' : 'w-1.5 bg-line hover:bg-ink-mute')}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
