/** Opened as the home-screen app rather than in a browser tab. */
export function openedFromHomeScreen(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}
