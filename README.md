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
