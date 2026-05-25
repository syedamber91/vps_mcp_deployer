import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { TunnelManager } from "./tunnel.js";
import { VpsProxy } from "./proxy.js";
import { TOOLS } from "./tools.js";
import { z } from "zod";

// --- Config from env ---
const VPS_HOST = process.env.VPS_HOST ?? "187.77.185.22";
const VPS_USER = process.env.VPS_USER ?? "syamiq";
const SSH_KEY_PATH = process.env.SSH_KEY_PATH ?? `${process.env.HOME}/.ssh/id_rsa`;
const VPS_AGENT_PORT = parseInt(process.env.VPS_AGENT_PORT ?? "7847", 10);
const VPS_AUTH_TOKEN = process.env.VPS_AUTH_TOKEN;

if (!VPS_AUTH_TOKEN) {
  console.error("FATAL: VPS_AUTH_TOKEN env var is required");
  process.exit(1);
}

// --- Instances ---
const tunnel = new TunnelManager({
  host: VPS_HOST,
  user: VPS_USER,
  keyPath: SSH_KEY_PATH,
  localPort: VPS_AGENT_PORT,
  remotePort: VPS_AGENT_PORT,
});

const proxy = new VpsProxy({
  port: VPS_AGENT_PORT,
  authToken: VPS_AUTH_TOKEN,
});

// --- MCP Server ---
const server = new McpServer({ name: "vps-deployer", version: "1.0.0" });

// Helper: ensure tunnel is up, return error content if not
async function withTunnel<T>(fn: () => Promise<T>): Promise<T | { content: Array<{ type: "text"; text: string }>; isError: true }> {
  try {
    await tunnel.ensureConnected();
  } catch {
    return { content: [{ type: "text", text: "Error: VPS unreachable" }], isError: true };
  }
  return fn();
}

function successResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function errorResult(msg: string) {
  return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true as const };
}

// --- Tool registration ---

server.tool(
  "deploy",
  "Deploy a repository branch to the VPS",
  {
    repo_url: z.string(),
    branch: z.string(),
    claude_md: z.string(),
    operation: z.enum(["frontend", "backend", "full", "custom"]),
    working_directory: z.string().optional(),
  },
  async (args) => {
    const result = await withTunnel(() => proxy.post("/deploy", args));
    if ("isError" in result) return result;
    return result.success ? successResult(result.data) : errorResult(result.error ?? "Unknown error");
  },
);

server.tool(
  "run_job",
  "Run a named job on the VPS",
  {
    repo_url: z.string(),
    branch: z.string(),
    claude_md: z.string(),
    job_name: z.string(),
    job_args: z.array(z.string()).optional(),
  },
  async (args) => {
    const result = await withTunnel(() => proxy.post("/run-job", args));
    if ("isError" in result) return result;
    return result.success ? successResult(result.data) : errorResult(result.error ?? "Unknown error");
  },
);

server.tool(
  "docker_status",
  "List all Docker containers on the VPS",
  {},
  async () => {
    const result = await withTunnel(() => proxy.get("/docker-status"));
    if ("isError" in result) return result;
    return result.success ? successResult(result.data) : errorResult(result.error ?? "Unknown error");
  },
);

server.tool(
  "docker_logs",
  "Fetch recent logs from a Docker container",
  {
    container: z.string(),
    lines: z.number().optional(),
  },
  async (args) => {
    const query: Record<string, string> = {};
    if (args.lines) query.lines = String(args.lines);
    const result = await withTunnel(() => proxy.get(`/docker-logs/${args.container}`, query));
    if ("isError" in result) return result;
    return result.success ? successResult(result.data) : errorResult(result.error ?? "Unknown error");
  },
);

server.tool(
  "disk_usage",
  "Check disk usage on the VPS",
  {},
  async () => {
    const result = await withTunnel(() => proxy.get("/disk-usage"));
    if ("isError" in result) return result;
    return result.success ? successResult(result.data) : errorResult(result.error ?? "Unknown error");
  },
);

server.tool(
  "db_health",
  "Check health of PostgreSQL and Neo4j databases",
  {},
  async () => {
    const result = await withTunnel(() => proxy.get("/db-health"));
    if ("isError" in result) return result;
    return result.success ? successResult(result.data) : errorResult(result.error ?? "Unknown error");
  },
);

server.tool(
  "git_status",
  "Show git status on the VPS",
  {
    working_directory: z.string().optional(),
  },
  async (args) => {
    const query: Record<string, string> = {};
    if (args.working_directory) query.working_directory = args.working_directory;
    const result = await withTunnel(() => proxy.get("/git-status", query));
    if ("isError" in result) return result;
    return result.success ? successResult(result.data) : errorResult(result.error ?? "Unknown error");
  },
);

server.tool(
  "service_health",
  "Check HTTP health of services",
  {
    urls: z.array(z.string()).optional(),
  },
  async (args) => {
    const query: Record<string, string> = {};
    if (args.urls && args.urls.length > 0) query.urls = args.urls.join(",");
    const result = await withTunnel(() => proxy.get("/service-health", query));
    if ("isError" in result) return result;
    return result.success ? successResult(result.data) : errorResult(result.error ?? "Unknown error");
  },
);

// --- Main ---
async function main() {
  // NOTE: Do NOT await tunnel.connect() here — it blocks the MCP stdio
  // handshake. The tunnel connects lazily on first tool call via ensureConnected().
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

process.on("SIGINT", () => {
  tunnel.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  tunnel.close();
  process.exit(0);
});

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
