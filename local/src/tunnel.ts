import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";

export interface TunnelConfig {
  host: string;
  user: string;
  keyPath: string;
  localPort: number;
  remotePort: number;
}

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const ESTABLISH_DELAY_MS = 500;
const ALIVE_TIMEOUT_MS = 2000;

export class TunnelManager {
  private proc: ChildProcess | null = null;
  private retries = 0;
  private closed = false;

  constructor(private config: TunnelConfig) {}

  async connect(): Promise<void> {
    this.closed = false;
    this.spawnSsh();
    await this.delay(ESTABLISH_DELAY_MS);
  }

  async isAlive(): Promise<boolean> {
    return new Promise((resolve) => {
      const sock = net.createConnection(
        { host: "127.0.0.1", port: this.config.localPort, timeout: ALIVE_TIMEOUT_MS },
        () => {
          sock.destroy();
          resolve(true);
        },
      );
      sock.on("error", () => resolve(false));
      sock.on("timeout", () => {
        sock.destroy();
        resolve(false);
      });
    });
  }

  async ensureConnected(): Promise<void> {
    if (await this.isAlive()) return;
    this.close();
    this.retries = 0;
    await this.connect();
    if (!(await this.isAlive())) {
      throw new Error("Tunnel failed to establish after reconnect");
    }
  }

  close(): void {
    this.closed = true;
    if (this.proc) {
      this.proc.kill();
      this.proc = null;
    }
  }

  // --- internals ---

  private spawnSsh(): void {
    const { host, user, keyPath, localPort, remotePort } = this.config;
    this.proc = spawn("ssh", [
      "-N",
      "-L", `${localPort}:127.0.0.1:${remotePort}`,
      "-i", keyPath,
      "-o", "StrictHostKeyChecking=no",
      "-o", "ServerAliveInterval=30",
      "-o", "ServerAliveCountMax=3",
      "-o", "ExitOnForwardFailure=yes",
      `${user}@${host}`,
    ]);

    this.proc.on("exit", () => {
      if (this.closed) return;
      this.autoReconnect();
    });
  }

  private autoReconnect(): void {
    if (this.retries >= MAX_RETRIES) return;
    this.retries++;
    const delayMs = BASE_DELAY_MS * 2 ** (this.retries - 1);
    setTimeout(() => {
      if (this.closed) return;
      this.spawnSsh();
    }, delayMs);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
