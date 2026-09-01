import { afterEach, describe, expect, it, vi } from "vitest";
import { clearBadge, badgingSupported, setBadge } from "../badge";

/**
 * The badge is decoration, and the contract that matters is that it can never
 * take the app down with it - not that any particular number reaches the OS.
 * Every test here is really asking the same question: does a hostile
 * implementation of this API break anything?
 */

function stubBadging(overrides: Record<string, unknown> = {}) {
  const setAppBadge = vi.fn(() => Promise.resolve());
  const clearAppBadge = vi.fn(() => Promise.resolve());
  vi.stubGlobal("navigator", { setAppBadge, clearAppBadge, ...overrides });
  return { setAppBadge, clearAppBadge };
}

afterEach(() => vi.unstubAllGlobals());

describe("setBadge", () => {
  it("sets a positive count", () => {
    const { setAppBadge, clearAppBadge } = stubBadging();
    setBadge(3);
    expect(setAppBadge).toHaveBeenCalledWith(3);
    expect(clearAppBadge).not.toHaveBeenCalled();
  });

  it("clears at zero rather than setting a zero badge", () => {
    // Chrome renders setAppBadge(0) as a dot with no number, which reads as
    // "something is waiting" on an app where nothing is.
    const { setAppBadge, clearAppBadge } = stubBadging();
    setBadge(0);
    expect(setAppBadge).not.toHaveBeenCalled();
    expect(clearAppBadge).toHaveBeenCalled();
  });

  it("treats a negative or fractional count as a real number", () => {
    const { setAppBadge, clearAppBadge } = stubBadging();
    setBadge(-4);
    expect(clearAppBadge).toHaveBeenCalled();
    setBadge(2.7);
    expect(setAppBadge).toHaveBeenCalledWith(2);
  });

  it("survives NaN", () => {
    const { setAppBadge, clearAppBadge } = stubBadging();
    setBadge(Number.NaN);
    expect(setAppBadge).not.toHaveBeenCalled();
    expect(clearAppBadge).toHaveBeenCalled();
  });

  it("does nothing where the API is absent", () => {
    vi.stubGlobal("navigator", {});
    expect(badgingSupported()).toBe(false);
    expect(() => setBadge(2)).not.toThrow();
  });

  it("swallows a rejected promise", async () => {
    // iOS rejects when the app is not installed to the home screen, which is a
    // normal state. An unhandled rejection here would surface as an error.
    stubBadging({ setAppBadge: () => Promise.reject(new Error("not installed")) });
    expect(() => setBadge(1)).not.toThrow();
    await Promise.resolve();
  });

  it("swallows a synchronous throw", () => {
    stubBadging({
      setAppBadge: () => {
        throw new Error("webview");
      },
    });
    expect(() => setBadge(1)).not.toThrow();
  });

  it("clears through the same path", () => {
    const { clearAppBadge } = stubBadging();
    clearBadge();
    expect(clearAppBadge).toHaveBeenCalled();
  });
});
