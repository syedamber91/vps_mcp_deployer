import type { AgentResponse } from "../../shared/types.js";

export interface ProxyConfig {
  port: number;
  authToken: string;
}

export class VpsProxy {
  private baseUrl: string;
  private authToken: string;

  constructor(config: ProxyConfig) {
    this.baseUrl = `http://127.0.0.1:${config.port}`;
    this.authToken = config.authToken;
  }

  async post<T = unknown>(path: string, body: unknown): Promise<AgentResponse<T>> {
    const timeout = path.includes("/deploy") ? 300_000 : 30_000;
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.authToken}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeout),
      });
      return (await res.json()) as AgentResponse<T>;
    } catch (err: unknown) {
      return { success: false, error: (err as Error).message };
    }
  }

  async get<T = unknown>(path: string, query?: Record<string, string>): Promise<AgentResponse<T>> {
    try {
      const url = new URL(`${this.baseUrl}${path}`);
      if (query) {
        for (const [k, v] of Object.entries(query)) {
          url.searchParams.set(k, v);
        }
      }
      const res = await fetch(url.toString(), {
        method: "GET",
        headers: { Authorization: `Bearer ${this.authToken}` },
        signal: AbortSignal.timeout(30_000),
      });
      return (await res.json()) as AgentResponse<T>;
    } catch (err: unknown) {
      return { success: false, error: (err as Error).message };
    }
  }
}
