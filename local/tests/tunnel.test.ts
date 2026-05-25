import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import type { Socket } from "node:net";

// --- mocks ---

const mockKill = vi.fn();

function makeFakeProc(): ChildProcess {
  const emitter = new EventEmitter() as unknown as ChildProcess;
  (emitter as any).pid = 12345;
  (emitter as any).kill = mockKill;
  (emitter as any).stdin = new EventEmitter();
  (emitter as any).stdout = new EventEmitter();
  (emitter as any).stderr = new EventEmitter();
  return emitter;
}

const mockSpawn = vi.fn(() => makeFakeProc());

vi.mock("node:child_process", () => ({
  spawn: (...args: any[]) => mockSpawn(...args),
}));

const mockSocket = new EventEmitter() as unknown as Socket;
(mockSocket as any).destroy = vi.fn();

const mockCreateConnection = vi.fn((_opts: any, cb: () => void) => {
  // Simulate successful connect on next tick
  process.nextTick(cb);
  return mockSocket;
});

vi.mock("node:net", () => ({
  default: {
    createConnection: (...args: any[]) => mockCreateConnection(...args),
  },
}));

// --- import after mocks ---
const { TunnelManager } = await import("../src/tunnel.js");

const CONFIG = {
  host: "10.0.0.1",
  user: "deploy",
  keyPath: "/home/deploy/.ssh/id_ed25519",
  localPort: 9100,
  remotePort: 8000,
};

describe("TunnelManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("connect() spawns ssh with correct args", async () => {
    const tm = new TunnelManager(CONFIG);
    await tm.connect();

    expect(mockSpawn).toHaveBeenCalledOnce();
    const [cmd, args] = mockSpawn.mock.calls[0];
    expect(cmd).toBe("ssh");
    expect(args).toContain("-N");
    expect(args).toContain("9100:127.0.0.1:8000");
    expect(args).toContain("/home/deploy/.ssh/id_ed25519");
    expect(args).toContain("deploy@10.0.0.1");
    expect(args).toContain("ExitOnForwardFailure=yes");

    tm.close();
  });

  it("isAlive() returns true when socket connects", async () => {
    const tm = new TunnelManager(CONFIG);
    const alive = await tm.isAlive();
    expect(alive).toBe(true);
    expect(mockCreateConnection).toHaveBeenCalledOnce();

    tm.close();
  });

  it("close() kills the SSH process", async () => {
    const tm = new TunnelManager(CONFIG);
    await tm.connect();

    tm.close();
    expect(mockKill).toHaveBeenCalledOnce();
  });
});
