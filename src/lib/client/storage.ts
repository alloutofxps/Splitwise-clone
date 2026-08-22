/**
 * localStorage that cannot take the app down with it.
 *
 * Accessing `window.localStorage` *throws* rather than returning null in
 * several real situations: Safari with "block all cookies", an iframe under a
 * strict partitioning policy, Firefox with dom.storage disabled, and Chrome
 * when the origin's quota is exhausted. An unguarded read at the top of a
 * provider takes down everything rendered inside it, which for the theme
 * provider is the entire app - a white screen because somebody browses
 * privately.
 *
 * Every function here degrades to "no stored value", which is always a
 * survivable state: the theme falls back to the OS preference and the install
 * prompt simply forgets it was dismissed.
 */

export function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private mode or a full quota. The caller's feature is a convenience, so
    // losing the write is preferable to losing the render.
  }
}

export function removeStored(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // As above.
  }
}
