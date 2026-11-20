// The signed-in user's own sidebar section order (0057 user_preferences). Presentation only: the
// sections themselves come from the user's role and permissions (navFor); a saved order can only sort
// them. Shown instantly from this device's cache, then confirmed from the server, so it follows the
// user to other browsers and devices.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../auth/auth';

type Orders = Record<string, string[]>;
const cacheKey = (userId: string) => `ssi-sidebar-order:${userId}`;

function readCache(userId?: string): Orders {
  if (!userId) return {};
  try {
    const v = JSON.parse(localStorage.getItem(cacheKey(userId)) ?? '{}');
    return v && typeof v === 'object' ? (v as Orders) : {};
  } catch {
    return {};
  }
}
function writeCache(userId: string, o: Orders) {
  try { localStorage.setItem(cacheKey(userId), JSON.stringify(o)); } catch { /* private mode: server copy still applies */ }
}

export function useSidebarOrder(userId?: string) {
  const [orders, setOrders] = useState<Orders>(() => readCache(userId));
  useEffect(() => {
    setOrders(readCache(userId));
    if (!userId || !supabase) return;
    let alive = true;
    void supabase.from('user_preferences').select('sidebar_order').eq('user_id', userId).maybeSingle().then(({ data, error }) => {
      if (!alive || error) return;
      const o = ((data?.sidebar_order ?? {}) as Orders);
      setOrders(o);
      writeCache(userId, o);
    });
    return () => { alive = false; };
  }, [userId]);

  /** Saves one navigation set's order; null resets it to the default. Returns false if it was not saved. */
  const save = useCallback(async (set: string, ids: string[] | null): Promise<boolean> => {
    if (!userId) return false;
    const before = orders;
    const next = { ...orders };
    if (ids?.length) next[set] = ids; else delete next[set];
    setOrders(next);
    writeCache(userId, next);
    if (!supabase) return true;
    const { data, error } = await supabase.rpc('save_sidebar_order', { p_set: set, p_order: ids ?? [] });
    if (error) {
      setOrders(before);
      writeCache(userId, before);
      return false;
    }
    if (data && typeof data === 'object') { setOrders(data as Orders); writeCache(userId, data as Orders); }
    return true;
  }, [orders, userId]);

  return { orders, save };
}

export { orderSections } from './navOrder';
