import type { Announcement, AppStatus, DerivedUpdateStatus, Student } from '../data/types';

export { clsx as cn } from 'clsx';

export const uid = (prefix = 'id') => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export const fullName = (s?: Pick<Student, 'firstName' | 'lastName'>) => (s ? `${s.firstName} ${s.lastName}` : '—');

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');

export const formatDate = (iso?: string, opts: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', year: 'numeric' }) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', opts) : '—';

export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const abs = Math.abs(diff);
  const m = Math.round(abs / 60000);
  const suffix = diff >= 0 ? 'ago' : 'from now';
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ${suffix}`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ${suffix}`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ${suffix}`;
  return formatDate(iso);
}

export const daysUntil = (iso: string) => Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);

export const money = (n: number, currency = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);

export const fileSize = (bytes: number) =>
  bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export const toDateInput = (iso?: string) => (iso ? new Date(iso).toISOString().slice(0, 10) : '');
export const fromDateInput = (v: string, hour = 9) => {
  const d = new Date(v + 'T00:00:00');
  d.setHours(hour);
  return d.toISOString();
};

export function updateStatus(a: Announcement, now = Date.now()): DerivedUpdateStatus {
  if (!a.published) return 'Draft';
  if (new Date(a.publishAt).getTime() > now) return 'Scheduled';
  if (new Date(a.expiresAt).getTime() < now) return 'Expired';
  return 'Active';
}

// Tone keys are consumed by <Badge tone=...>
export type Tone = 'navy' | 'orange' | 'rust' | 'green' | 'red' | 'blue' | 'violet' | 'slate' | 'amber' | 'teal';

export const appStatusTone: Record<AppStatus, Tone> = {
  Draft: 'slate',
  'Pending Assessment': 'amber',
  Submitted: 'blue',
  'Offer Pending': 'violet',
  'Conditional Offer': 'orange',
  'Unconditional Offer': 'teal',
  'Visa Lodged': 'navy',
  'Visa Granted': 'green',
  'Visa Refused': 'red',
};

export const appStatusColor: Record<AppStatus, string> = {
  Draft: '#94A3B8',
  'Pending Assessment': '#F5B83D',
  Submitted: '#3B82F6',
  'Offer Pending': '#8B5CF6',
  'Conditional Offer': '#FBA51E',
  'Unconditional Offer': '#14B8A6',
  'Visa Lodged': '#3E6B7C',
  'Visa Granted': '#16A34A',
  'Visa Refused': '#DC2626',
};

export const countryFlag: Record<string, string> = {
  Australia: '🇦🇺',
  'United Kingdom': '🇬🇧',
  Canada: '🇨🇦',
  'United States': '🇺🇸',
  'New Zealand': '🇳🇿',
  Germany: '🇩🇪',
  Ireland: '🇮🇪',
  India: '🇮🇳',
  UAE: '🇦🇪',
  'Sri Lanka': '🇱🇰',
  Nepal: '🇳🇵',
};

const avatarPalette = ['#FBA51E', '#B94A12', '#164A5C', '#2A4F5C', '#E58A0E', '#7A3012', '#4F7380'];
export const avatarColor = (seed: string) => {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return avatarPalette[h % avatarPalette.length];
};

export const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};

export const matches = (q: string, ...fields: (string | undefined)[]) => {
  const n = q.trim().toLowerCase();
  if (!n) return true;
  return fields.some((f) => f?.toLowerCase().includes(n));
};
