import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { Button, Modal } from './ui';
import { cn } from '../lib/utils';

/* ------------------------------------------------------------------ Toasts */

type ToastKind = 'success' | 'error' | 'info' | 'warning';
interface ToastItem {
  id: number;
  kind: ToastKind;
  title: string;
  message?: string;
}

const ToastCtx = createContext<(t: Omit<ToastItem, 'id'>) => void>(() => {});

export function useToast() {
  const push = useContext(ToastCtx);
  return {
    success: (title: string, message?: string) => push({ kind: 'success', title, message }),
    error: (title: string, message?: string) => push({ kind: 'error', title, message }),
    info: (title: string, message?: string) => push({ kind: 'info', title, message }),
    warning: (title: string, message?: string) => push({ kind: 'warning', title, message }),
  };
}

/* ---------------------------------------------------------------- Confirm */

interface ConfirmOpts {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
}
const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<boolean>>(async () => false);
export const useConfirm = () => useContext(ConfirmCtx);

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  // Same behaviour on every browser and OS: in-page toasts (no native alerts). Reading time grows
  // with the text and severity; a toast stays while hovered or focused; an identical toast shown
  // again within a few seconds (double click, realtime echo) is not repeated.
  const timers = useRef(new Map<number, number>());
  const recent = useRef(new Map<string, number>());
  const dismiss = useCallback((id: number) => {
    window.clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((ts) => ts.filter((x) => x.id !== id));
  }, []);
  const schedule = useCallback((t: ToastItem) => {
    const words = `${t.title} ${t.message ?? ''}`.trim().split(/\s+/).length;
    const base = t.kind === 'error' ? 7000 : t.kind === 'warning' ? 6000 : t.kind === 'info' ? 5000 : 4000;
    window.clearTimeout(timers.current.get(t.id));
    timers.current.set(t.id, window.setTimeout(() => dismiss(t.id), Math.min(15000, base + words * 250)));
  }, [dismiss]);
  const push = useCallback((t: Omit<ToastItem, 'id'>) => {
    const key = `${t.kind}|${t.title}|${t.message ?? ''}`;
    const now = Date.now();
    if ((recent.current.get(key) ?? 0) > now - 3000) return;
    recent.current.set(key, now);
    const id = nextId.current++;
    const item = { ...t, id };
    setToasts((ts) => [...ts.slice(-3), item]);
    schedule(item);
  }, [schedule]);
  const hold = (id: number) => { window.clearTimeout(timers.current.get(id)); timers.current.delete(id); };

  const [confirmState, setConfirmState] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const confirm = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => setConfirmState({ ...o, resolve })), []);
  const close = (v: boolean) => {
    confirmState?.resolve(v);
    setConfirmState(null);
  };

  const icons = { success: CheckCircle2, error: XCircle, info: Info, warning: AlertTriangle };
  const colors = { success: 'text-emerald-500', error: 'text-red-500', info: 'text-brand', warning: 'text-amber-500' };

  return (
    <ToastCtx.Provider value={push}>
      <ConfirmCtx.Provider value={confirm}>
        {children}
        <div className="pointer-events-none fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 z-[80] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2.5" aria-live="polite">
          {toasts.map((t) => {
            const Icon = icons[t.kind];
            return (
              <div key={t.id} role={t.kind === 'error' || t.kind === 'warning' ? 'alert' : 'status'}
                onMouseEnter={() => hold(t.id)} onMouseLeave={() => schedule(t)} onFocus={() => hold(t.id)} onBlur={() => schedule(t)}
                className="pointer-events-auto flex animate-fade-up items-start gap-3 rounded-2xl border border-line bg-surface p-4 shadow-lift">
                <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', colors[t.kind])} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-heading">{t.title}</div>
                  {t.message && <div className="mt-0.5 text-[13px] text-ink-soft">{t.message}</div>}
                </div>
                <button type="button" aria-label="Dismiss notification" className="-m-2 rounded-lg p-2 text-ink-mute hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300" onClick={() => dismiss(t.id)}>
                  <X className="h-4 w-4" />
                </button>
              </div>
            );
          })}
        </div>
        <Modal
          open={!!confirmState}
          onClose={() => close(false)}
          size="sm"
          title={
            <span className="flex items-center gap-2.5">
              <span className={cn('flex h-9 w-9 items-center justify-center rounded-xl', confirmState?.danger ? 'bg-red-50 text-red-600' : 'bg-brand-50 text-rust')}>
                <AlertTriangle className="h-[18px] w-[18px]" />
              </span>
              {confirmState?.title}
            </span>
          }
          footer={
            <>
              <Button variant="secondary" onClick={() => close(false)}>
                Cancel
              </Button>
              <Button variant={confirmState?.danger ? 'danger' : 'primary'} onClick={() => close(true)} autoFocus>
                {confirmState?.confirmLabel ?? 'Confirm'}
              </Button>
            </>
          }
        >
          <p className="text-sm leading-relaxed text-ink-soft">{confirmState?.message}</p>
        </Modal>
      </ConfirmCtx.Provider>
    </ToastCtx.Provider>
  );
}
