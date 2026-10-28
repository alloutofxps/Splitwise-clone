import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../api";

/**
 * Which answers count as "Divvy can't be reached", so a change is kept on
 * the phone and sent again (RULES.md D6), and which are real refusals.
 */

const answer = (status: number, body: string, type = "application/json") =>
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(body, { status, headers: { "content-type": type } }));

afterEach(() => vi.restoreAllMocks());

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    return error as ApiError;
  }
  throw new Error("expected the request to fail");
}

describe("an answer Divvy couldn't give itself", () => {
  it.each([
    [502, "<html>Application failed to respond</html>", "text/html"],
    [503, '{"error":"The database is busy. Try again in a moment."}', "application/json"],
    [504, "Gateway timeout", "text/plain"],
  ])("%i counts as unreachable", async (status, body, type) => {
    answer(status, body, type);
    const error = await failure(api.post("/api/expenses", {}));
    expect(error).toBeInstanceOf(ApiError);
    expect(error.isOffline).toBe(true);
  });

  it("a dropped connection counts as unreachable", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    expect((await failure(api.post("/api/expenses", {}))).isOffline).toBe(true);
  });
});

describe("a real answer", () => {
  it("a server error is shown, not resent", async () => {
    answer(500, '{"error":"Something went wrong."}');
    const error = await failure(api.post("/api/expenses", {}));
    expect(error.isOffline).toBe(false);
    expect(error.status).toBe(500);
  });

  it("a refusal keeps the server's words", async () => {
    answer(422, '{"error":"Pick a group or a friend for this expense.","code":"invalid"}');
    const error = await failure(api.post("/api/expenses", {}));
    expect(error.isOffline).toBe(false);
    expect(error.message).toBe("Pick a group or a friend for this expense.");
  });
});
