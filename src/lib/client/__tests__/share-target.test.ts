import { afterEach, describe, expect, it, vi } from "vitest";
import { takeSharedPayload } from "../share-target";

/**
 * The share relay is one-shot on purpose, and these tests exist to hold it to
 * that. The failure it guards against is not an exception - it is a receipt
 * that attaches itself to a second expense because a refresh replayed the
 * handshake, or one that reappears on a launch two days later with no context.
 */

const INDEX = "/__shared/index.json";

function stubCache(entries: Record<string, Response>) {
  const store = new Map(Object.entries(entries));
  const deleted: string[] = [];

  const cache = {
    match: (key: string) => Promise.resolve(store.get(key)),
    delete: (key: string) => Promise.resolve(store.delete(key)),
  };

  vi.stubGlobal("caches", {
    open: () => Promise.resolve(cache),
    delete: (name: string) => {
      deleted.push(name);
      store.clear();
      return Promise.resolve(true);
    },
  });

  return { store, deleted };
}

function index(files: { key: string; name: string; type: string }[], at = Date.now()) {
  return new Response(JSON.stringify({ files, title: "Dinner", text: "", url: "", at }), {
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("takeSharedPayload", () => {
  it("returns the parked files and their note", async () => {
    stubCache({
      [INDEX]: index([{ key: "/__shared/file-0", name: "receipt.jpg", type: "image/jpeg" }]),
      "/__shared/file-0": new Response("bytes", {
        headers: { "Content-Type": "image/jpeg" },
      }),
    });

    const payload = await takeSharedPayload();

    expect(payload?.files).toHaveLength(1);
    expect(payload?.files[0]?.name).toBe("receipt.jpg");
    expect(payload?.files[0]?.type).toBe("image/jpeg");
    expect(payload?.note).toBe("Dinner");
  });

  it("clears the stash, so a refresh cannot attach the same receipt twice", async () => {
    const { deleted } = stubCache({
      [INDEX]: index([{ key: "/__shared/file-0", name: "a.jpg", type: "image/jpeg" }]),
      "/__shared/file-0": new Response("bytes"),
    });

    expect(await takeSharedPayload()).not.toBeNull();
    expect(deleted).toContain("divvy-share");
    expect(await takeSharedPayload()).toBeNull();
  });

  it("discards a stash older than the handshake window", async () => {
    const hourAgo = Date.now() - 60 * 60 * 1000;
    const { deleted } = stubCache({
      [INDEX]: index([{ key: "/__shared/file-0", name: "a.jpg", type: "image/jpeg" }], hourAgo),
      "/__shared/file-0": new Response("bytes"),
    });

    // The note is dropped with the files: a share the user abandoned an hour
    // ago must not turn up pre-filled on an unrelated launch.
    expect(await takeSharedPayload()).toBeNull();
    expect(deleted).toContain("divvy-share");
  });

  it("clears a corrupt stash instead of retrying it forever", async () => {
    const { deleted } = stubCache({ [INDEX]: new Response("{ not json") });

    expect(await takeSharedPayload()).toBeNull();
    expect(deleted).toContain("divvy-share");
  });

  it("salvages the note when a file named in the index is missing", async () => {
    stubCache({
      [INDEX]: index([{ key: "/__shared/file-0", name: "gone.jpg", type: "image/jpeg" }]),
    });

    // The write was interrupted or the entry evicted. Losing the photo is bad;
    // losing the share as well, when there is still a usable description, is
    // gratuitous.
    const payload = await takeSharedPayload();
    expect(payload?.files).toEqual([]);
    expect(payload?.note).toBe("Dinner");
  });

  it("returns null when there is neither a file nor any text", async () => {
    stubCache({
      [INDEX]: new Response(JSON.stringify({ files: [], title: "", text: "", at: Date.now() })),
    });

    expect(await takeSharedPayload()).toBeNull();
  });

  it("returns null when nothing was ever parked", async () => {
    stubCache({});
    expect(await takeSharedPayload()).toBeNull();
  });

  it("returns null where the Cache API does not exist", async () => {
    vi.stubGlobal("caches", undefined);
    expect(await takeSharedPayload()).toBeNull();
  });
});
