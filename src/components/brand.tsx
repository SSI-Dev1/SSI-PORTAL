import { cn } from '../lib/utils';

/** SSI GLOBAL mark: two overlapping rounded diamonds (brand orange over rust). */
export function LogoMark({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden>
      <rect x="15" y="3" width="34" height="34" rx="8" transform="rotate(45 32 20)" fill="#FBA51E" />
      <rect x="15" y="27" width="34" height="34" rx="8" transform="rotate(45 32 44)" fill="#B94A12" fillOpacity="0.92" />
      <rect x="23.5" y="23.5" width="17" height="17" rx="4" transform="rotate(45 32 32)" fill="#9A3C10" fillOpacity="0.55" />
    </svg>
  );
}

export function Logo({ dark, className, stacked = true }: { dark?: boolean; className?: string; stacked?: boolean }) {
  const color = dark ? 'text-white' : 'text-heading';
  return (
    <div className={cn('flex items-center gap-2.5', className)} aria-label="SSI GLOBAL">
      <LogoMark size={40} />
      {stacked ? (
        <div className={cn('font-display leading-[0.95]', color)}>
          <div className="text-[22px] font-bold tracking-tight">SSI</div>
          <div className="text-[17px] font-light tracking-wide">GLOBAL</div>
        </div>
      ) : (
        <div className={cn('font-display text-xl', color)}>
          <span className="font-bold">SSI</span> <span className="font-light">GLOBAL</span>
        </div>
      )}
    </div>
  );
}
