// ════════════════════════════════════════════════════════════
// FE-9.11 Debounce utility
// Usage: debounce((val) => search(val), 300)
// ════════════════════════════════════════════════════════════
export function debounce<T extends (...args: any[]) => void>(fn: T, ms = 300): T {
  let timer: ReturnType<typeof setTimeout>;
  return ((...args: any[]) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  }) as T;
}

// ════════════════════════════════════════════════════════════
// FE-9.10 Simple in-memory cache
// Usage: const cache = new SimpleCache<User[]>(60000);
//        cache.set('users', data);
//        const users = cache.get('users');
// ════════════════════════════════════════════════════════════
export class SimpleCache<T> {
  private store = new Map<string, { value: T; expiresAt: number }>();

  constructor(private ttl = 60_000) {}

  set(key: string, value: T, ttl = this.ttl): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttl });
  }

  get(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) { this.store.delete(key); return null; }
    return entry.value;
  }

  invalidate(key: string): void { this.store.delete(key); }
  clear(): void { this.store.clear(); }
}

// ════════════════════════════════════════════════════════════
// FE-9.12 Virtual scroll helper
// Usage in component:
//   visibleItems = computed(() => virtualScroll(allItems(), scrollTop, itemHeight, containerHeight));
// ════════════════════════════════════════════════════════════
export function virtualScroll<T>(
  items: T[],
  scrollTop: number,
  itemHeight: number,
  containerHeight: number,
  overscan = 3
): { items: T[]; startIndex: number; totalHeight: number } {
  const totalHeight = items.length * itemHeight;
  const startIndex  = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const visibleCount = Math.ceil(containerHeight / itemHeight) + overscan * 2;
  const endIndex    = Math.min(items.length, startIndex + visibleCount);
  return { items: items.slice(startIndex, endIndex), startIndex, totalHeight };
}