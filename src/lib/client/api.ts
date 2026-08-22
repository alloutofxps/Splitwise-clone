"use client";

/**
 * The client's single door to the server.
 *
 * Everything goes through `request`, which gives one place to attach the
 * offline behaviour, normalise errors into something showable, and keep the
 * BigInt-as-string convention from leaking into components.
 */

export class ApiError extends Error {
  status: number;
  details: string[];
  code?: string;

  constructor(status: number, message: string, details: string[] = [], code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
    this.code = code;
  }

  /** True when the request never reached the server. */
  get isOffline(): boolean {
    return this.status === 0;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, signal } = options;

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      signal,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body === undefined ? undefined : JSON.stringify(body),
      // The identity cookie is httpOnly; without this it is not sent at all.
      credentials: "same-origin",
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(0, "You're offline. This will sync when you're back.");
  }

  if (response.status === 204) return undefined as T;

  const isJson = response.headers
    .get("content-type")
    ?.includes("application/json");

  if (!response.ok) {
    if (isJson) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; details?: string[]; code?: string }
        | null;
      throw new ApiError(
        response.status,
        payload?.error ?? "Something went wrong.",
        payload?.details ?? [],
        payload?.code,
      );
    }
    throw new ApiError(response.status, `Request failed (${response.status}).`);
  }

  return isJson ? ((await response.json()) as T) : (undefined as T);
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>(path, { signal }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: "PUT", body }),
  del: <T>(path: string, body?: unknown) => request<T>(path, { method: "DELETE", body }),
};
