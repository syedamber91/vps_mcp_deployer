# VPS MCP Deployer — Design Spec

**Date:** 2026-05-25
**Approach:** C — Thin MCP Proxy (local) + VPS-side HTTP Agent

## Problem

Claude Code conversations working on different projects need to deploy code to a shared VPS (`syamiq@187.77.185.22`), run jobs, and query VPS state. Today this requires manual SSH, remembering Docker commands, and copy-pasting deploy steps. There's no way for one conversation to trigger deployments programmatically or for different projects to share a common deploy interface.

## Architecture

Two components connected via an SSH tunnel:

```
┌─────────────────────────┐         SSH tunnel          ┌──────────────────────────┐
│  LOCAL (Mac)            │       (port forward)         │  VPS (187.77.185.22)     │
│                         │                              │                          │
│  Claude Code            │                              │  vps-agent (HTTP)        │
│    ↕ stdio              │                              │    ↕ Docker socket       │
│  mcp-proxy (TS)         │ ──── localhost:7847 ──────── │    ↕ filesystem          │
│    (MCP server)         │                              │    ↕ Neo4j / Postgres    │
│                         │                              │    ↕ git                 │
└─────────────────────────┘                              └──────────────────────────┘
```

**Local side — `mcp-proxy`**: TypeScript MCP stdio server. Claude Code launches it via `mcpServers` config. Forwards tool calls over HTTP to `localhost:7847` (SSH-tunneled to VPS). No business logic — pure proxy + tunnel management.

**VPS side — `vps-agent`**: Express HTTP server running in Docker on the VPS. Direct access to Docker socket, filesystem, databases. Executes allowlisted operations, returns structured results. Listens only on `127.0.0.1:7847` (not internet-exposed).

## Context-Aware Deployment

Calling conversations provide their repo context with every deploy/job tool call:

- **repo_url** — the GitHub repo being deployed
- **branch** — which branch to deploy
- **claude_md** — contents of the project's CLAUDE.md (or relevant deploy sections)
- **operation** — what to deploy (frontend, backend, full, custom)
- **working_directory** — optional override for VPS deploy path

The VPS agent parses CLAUDE.md for deploy-specific instructions (build args, env vars, Docker commands, special steps) and follows them. This means different projects can have different deploy procedures — the agent adapts to each project's instructions rather than running hardcoded scripts.

### Validation

Before executing parsed instructions, the VPS agent validates them against an allowlist:
- Allowed binaries: `git`, `docker`, `docker-compose`, `sudo docker`, `bash`, `curl`, `python3`
- Blocked patterns: `rm -rf /`, password/secret in args, writes outside `/local/data/`
- Blocked commands: `shutdown`, `reboot`, `mkfs`, `dd`, `iptables`

## Tools

### Deploy Operations

| Tool | Arguments | Description |
|------|-----------|-------------|
| `deploy` | `repo_url, branch, claude_md, operation, working_directory?` | Context-aware deploy: parses CLAUDE.md for instructions, executes on VPS |

### Job Execution

| Tool | Arguments | Description |
|------|-----------|-------------|
| `run_job` | `repo_url, branch, claude_md, job_name, job_args?` | Run a named job (e2e pipeline, macro pipeline, agent validation) using project context |

### Query Operations (no repo context needed)

| Tool | Arguments | Description |
|------|-----------|-------------|
| `docker_status` | — | `docker ps` formatted output for all containers |
| `docker_logs` | `container, lines?` | Tail logs from a named container (default 100 lines) |
| `disk_usage` | — | `df -h` + `du -sh` on key directories |
| `db_health` | — | Neo4j + Postgres connection check, row counts on key tables |
| `git_status` | `working_directory?` | Current branch, HEAD sha, uncommitted changes |
| `service_health` | `urls?` | HTTP health check on frontend + API endpoints |

## Security

1. **VPS agent binds to 127.0.0.1 only** — not reachable from the internet
2. **SSH tunnel required** — all traffic goes through authenticated SSH
3. **Shared secret token** — `.env` file on both sides, verified on every request
4. **Allowlisted operations** — no arbitrary command execution
5. **CLAUDE.md instruction validation** — parsed deploy commands checked against allowlist before execution
6. **Audit log** — every operation logged with timestamp, caller context, command, result

## SSH Tunnel Management

The local MCP proxy manages the SSH tunnel lifecycle:
- Spawns `ssh -N -L 7847:127.0.0.1:7847 syamiq@187.77.185.22` on startup
- Health-checks tunnel before each request (TCP connect to localhost:7847)
- Auto-reconnects if tunnel drops (with exponential backoff, max 3 retries)
- Cleans up tunnel process on MCP server shutdown

## Project Structure

```
vps_mcp_deployer/
├── local/                        # MCP proxy (runs on Mac)
│   ├── src/
│   │   ├── index.ts             # MCP server entry (stdio transport)
│   │   ├── tunnel.ts            # SSH tunnel lifecycle manager
│   │   ├── proxy.ts             # HTTP client to VPS agent
│   │   └── tools.ts             # MCP tool definitions
│   ├── package.json
│   └── tsconfig.json
├── vps-agent/                    # Runs on VPS in Docker
│   ├── src/
│   │   ├── index.ts             # Express server on :7847
│   │   ├── auth.ts              # Token verification middleware
│   │   ├── allowlist.ts         # Command validation rules
│   │   ├── claude-md-parser.ts  # Extract deploy instructions from CLAUDE.md
│   │   ├── executor.ts          # Safe command execution with logging
│   │   └── handlers/
│   │       ├── deploy.ts        # Context-aware deploy handler
│   │       ├── jobs.ts          # Job execution handler
│   │       └── query.ts         # Status/health/logs handlers
│   ├── Dockerfile
│   ├── package.json
│   └── tsconfig.json
├── deploy-vps-agent.sh           # Script to deploy the VPS agent itself
├── .env.example                  # AUTH_TOKEN, VPS_HOST, SSH_KEY_PATH
└── README.md
```

## Claude Code Integration

Add to any project's `.claude/settings.local.json`:

```json
{
  "mcpServers": {
    "vps-deployer": {
      "command": "npx",
      "args": ["tsx", "/Users/syedamberiqbal/Documents/workspace/Anti-Gravity/vps_mcp_deployer/local/src/index.ts"],
      "env": {
        "VPS_AUTH_TOKEN": "...",
        "VPS_HOST": "187.77.185.22",
        "VPS_USER": "syamiq",
        "SSH_KEY_PATH": "~/.ssh/id_ed25519"
      }
    }
  }
}
```

Any Claude Code conversation with this config can call `vps-deployer:deploy`, `vps-deployer:docker_status`, etc.

## VPS Agent Deployment

The VPS agent itself runs as a Docker container on the VPS:

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY dist/ ./dist/
EXPOSE 7847
CMD ["node", "dist/index.js"]
```

Docker run with socket mount:
```bash
docker run -d --name vps-agent --restart unless-stopped \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /local/data/scrath/docker-data:/workspace \
  -p 127.0.0.1:7847:7847 \
  --env-file .env \
  vps-agent
```

## Error Handling

- **Tunnel down**: Proxy returns MCP error with "VPS unreachable — SSH tunnel failed" message
- **Agent down**: Proxy returns MCP error with "VPS agent not responding on :7847"
- **Allowlist violation**: Agent returns 403 with the blocked command pattern
- **Deploy failure**: Agent returns full stdout/stderr from the failed step, plus the step index in the sequence
- **Timeout**: 5 min timeout on deploy operations, 30s on query operations

## Testing Strategy

- **Local proxy**: Unit tests for tunnel management, tool schema validation
- **VPS agent**: Unit tests for allowlist validation, CLAUDE.md parsing, handler logic
- **Integration**: Test script that calls each MCP tool against a running VPS agent
- **CLAUDE.md parser**: Fixture files with various CLAUDE.md formats to ensure correct extraction
