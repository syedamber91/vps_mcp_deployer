import { describe, it, expect, vi, beforeEach } from "vitest";
import { VpsProxy } from "../src/proxy.js";

const mockFetch = vi.fn();
global.fetch = mockFetch;

const proxy = new VpsProxy({ port: 9000, authToken: "test-token" });

beforeEach(() => {
  mockFetch.mockReset();
});

describe("VpsProxy.post", () => {
  it("sends correct URL, method, auth header, and body", async () => {
    mockFetch.mockResolvedValue({
      json: async () => ({ success: true, data: { ok: 1 } }),
    });

    const result = await proxy.post("/deploy", { repo_url: "https://gh.com/r" });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:9000/deploy");
    expect(opts.method).toBe("POST");
    expect(opts.headers.Authorization).toBe("Bearer test-token");
    expect(opts.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(opts.body)).toEqual({ repo_url: "https://gh.com/r" });
    expect(result).toEqual({ success: true, data: { ok: 1 } });
  });
});

describe("VpsProxy.get", () => {
  it("sends correct URL with query params", async () => {
    mockFetch.mockResolvedValue({
      json: async () => ({ success: true, data: [] }),
    });

    const result = await proxy.get("/status", { container: "frontend", lines: "50" });

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:9000/status?container=frontend&lines=50");
    expect(opts.method).toBe("GET");
    expect(opts.headers.Authorization).toBe("Bearer test-token");
    expect(result).toEqual({ success: true, data: [] });
  });
});

describe("error handling", () => {
  it("returns error when fetch throws", async () => {
    mockFetch.mockRejectedValue(new Error("Connection refused"));

    const result = await proxy.post("/deploy", {});

    expect(result).toEqual({ success: false, error: "Connection refused" });
  });
});
