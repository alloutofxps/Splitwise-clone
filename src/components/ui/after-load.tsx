"use client";

import * as React from "react";

/**
 * A piece of the app fetched once the page has finished loading, rather than
 * with it, so it isn't part of what a screen downloads before it can show
 * itself (MOTION-SPEC 7). The fetch starts by itself once the page has loaded,
 * or at once if something asks for it sooner. One fetch, shared; a failed one
 * (offline before it ever arrived) is tried again the next time it's asked for.
 */
export function afterLoad<T>(load: () => Promise<T>): () => Promise<T> {
  let loading: Promise<T> | null = null;
  const get = () =>
    (loading ??= load().catch((error: unknown) => {
      loading = null;
      throw error;
    }));
  if (typeof window !== "undefined") {
    const fetchIt = () => void get().catch(() => {});
    if (document.readyState === "complete") fetchIt();
    else window.addEventListener("load", fetchIt, { once: true });
  }
  return get;
}

/**
 * A component fetched with `afterLoad`: a panel or tab nobody sees until they
 * tap something. It draws nothing until its code has arrived, which by the
 * time anyone taps it almost always has; a tap before the page has finished
 * loading asks for it at once, and it appears as soon as it lands.
 */
export function lazyAfterLoad<P extends object>(
  load: () => Promise<React.ComponentType<P>>,
): React.ComponentType<P> {
  let arrived: React.ComponentType<P> | null = null;
  const get = afterLoad(() => load().then((component) => (arrived = component)));

  function AfterLoad(props: P) {
    const [Component, setComponent] = React.useState(() => arrived);
    React.useEffect(() => {
      if (Component) return;
      let live = true;
      get().then(
        (component) => live && setComponent(() => component),
        () => {},
      );
      return () => {
        live = false;
      };
    }, [Component]);
    return Component ? <Component {...props} /> : null;
  }
  return AfterLoad;
}
