import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";

/**
 * A fetch stub that never settles on its own but honours its AbortSignal — the
 * same contract the real fetch follows. This lets us drive the timeout (SER-221)
 * and external-abort (SER-222) paths deterministically.
 */
function hangingFetch() {
  return vi.fn((_url: string, init?: RequestInit) => {
    const signal = init?.signal ?? undefined;
    if (signal?.aborted) {
      return Promise.reject(new DOMException("aborted", "AbortError"));
    }
    return new Promise<Response>((_resolve, reject) => {
      signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("api request lifecycle", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("resolves with the parsed JSON body for a fast response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(jsonResponse({ ok: true, value: 42 }))),
    );
    await expect(api<{ ok: boolean; value: number }>("/fast")).resolves.toEqual({
      ok: true,
      value: 42,
    });
  });

  it("rejects with a clear timeout error when the request never settles (SER-221)", async () => {
    vi.stubGlobal("fetch", hangingFetch());
    await expect(api("/slow", { timeoutMs: 20 })).rejects.toThrow(/timed out after/i);
  });

  it("aborts in flight when the caller signal fires, without a timeout message (SER-222)", async () => {
    vi.stubGlobal("fetch", hangingFetch());
    const controller = new AbortController();
    const pending = api("/cancellable", { signal: controller.signal, timeoutMs: 5000 });
    controller.abort();
    await expect(pending).rejects.toThrow(/aborted/i);
    await expect(pending).rejects.not.toThrow(/timed out/i);
  });

  it("surfaces the server error message on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(jsonResponse({ error: "policy blocked" }, 403))),
    );
    await expect(api("/blocked")).rejects.toThrow(/403 policy blocked/);
  });
});
