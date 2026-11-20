// Pure sidebar ordering (no imports), shared by the app and its tests.

/**
 * Applies a saved order to the sections the user may see. The first section (Dashboard) stays first;
 * saved sections follow in the saved order; sections not in the saved order (newly permitted, or added
 * later) keep their default position. Saved ids the user can no longer see are ignored.
 */
export function orderSections<T extends { id: string }>(sections: T[], saved?: string[] | null): T[] {
  if (!saved?.length || sections.length < 3) return sections;
  const [first, ...rest] = sections;
  const pos = new Map(saved.map((id, i) => [id, i]));
  const out = rest.filter((s) => pos.has(s.id)).sort((a, b) => pos.get(a.id)! - pos.get(b.id)!);
  rest.forEach((s, defaultIndex) => { if (!pos.has(s.id)) out.splice(Math.min(defaultIndex, out.length), 0, s); });
  return [first, ...out];
}
