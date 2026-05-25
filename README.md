# VPS MCP Deployer

An MCP server that lets any Claude Code conversation deploy code, run jobs, and query state on a VPS.

## Architecture

- **Local MCP Proxy** (`local/`) — stdio MCP server that Claude Code launches. Forwards tool calls over SSH-tunneled HTTP.
- **VPS Agent** (`vps-agent/`) — Express HTTP server running in Docker on the VPS. Executes allowlisted operations.

## Setup

### 1. Configure environment

```bash
cp .env.example .env
# Edit .env — set AUTH_TOKEN to a random string (same value used on VPS)
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
      "args": ["tsx", "/Users/syedamberiqbal/Documents/workspace/Anti-Gravity/vps_mcp_deployer/local/src/index.ts"],
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

## How Deploy Works

When you call `deploy`, provide your project's CLAUDE.md content. The VPS agent:
1. Parses CLAUDE.md for deployment sections
2. Extracts bash commands from code blocks
3. Validates each command against the security allowlist
4. Executes commands sequentially on the VPS
5. Returns structured results with logs

This means different projects can have different deploy procedures — the agent adapts to each project's CLAUDE.md.

## Alternative: Direct curl via SSH Tunnel (No MCP)

If MCP registration isn't working or you prefer raw HTTP, any Claude Code conversation can call the VPS agent directly via curl through an SSH tunnel.

### 1. Open SSH tunnel

```bash
ssh -N -L 7847:127.0.0.1:7847 syamiq@187.77.185.22 &
```

### 2. Query endpoints (GET, no body)

```bash
AUTH="Authorization: Bearer <YOUR_AUTH_TOKEN>"

# Health check (no auth)
curl -s http://127.0.0.1:7847/health

# All containers
curl -s -H "$AUTH" http://127.0.0.1:7847/docker-status

# Container logs (last 50 lines)
curl -s -H "$AUTH" http://127.0.0.1:7847/docker-logs/docker-data-frontend-1?lines=50

# Disk usage
curl -s -H "$AUTH" http://127.0.0.1:7847/disk-usage

# Git status
curl -s -H "$AUTH" http://127.0.0.1:7847/git-status

# Database health
curl -s -H "$AUTH" http://127.0.0.1:7847/db-health

# Service health
curl -s -H "$AUTH" http://127.0.0.1:7847/service-health
```

### 3. Deploy (POST with CLAUDE.md context)

```bash
curl -s -X POST -H "$AUTH" -H "Content-Type: application/json" \
  http://127.0.0.1:7847/deploy \
  -d '{
    "repo_url": "https://github.com/user/repo",
    "branch": "develop",
    "claude_md": "<contents of your CLAUDE.md>",
    "operation": "frontend",
    "working_directory": "/local/data/scrath/docker-data"
  }'
```

### 4. Run a job (POST)

```bash
curl -s -X POST -H "$AUTH" -H "Content-Type: application/json" \
  http://127.0.0.1:7847/run-job \
  -d '{
    "repo_url": "https://github.com/user/repo",
    "branch": "develop",
    "claude_md": "<contents of your CLAUDE.md>",
    "job_name": "bash /workspace/run_e2e.sh",
    "job_args": ["company1:notebook_id1"]
  }'
```

### Using from Claude Code (Bash tool)

Other conversations can open the SSH tunnel and call curl directly via the Bash tool — no MCP server registration needed. The tunnel persists for the session.

## Development

```bash
cd local && npm install && npm test
cd vps-agent && npm install && npm test
```

## Security

- VPS agent binds to 127.0.0.1 only (not internet-accessible)
- All traffic goes through SSH tunnel
- Bearer token authentication on every request
- Commands validated against allowlist (no arbitrary execution)
- Blocked: rm, shutdown, reboot, writes outside /local/data/
