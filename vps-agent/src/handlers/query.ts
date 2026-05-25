import { executeCommand } from '../executor.js';
import type { AgentResponse } from '../../../shared/types.js';

export async function handleDockerStatus(): Promise<AgentResponse<string>> {
  const result = await executeCommand(
    "docker ps --format 'table {{.ID}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}\t{{.Names}}'"
  );

  if (!result.success) {
    return { success: false, error: result.stderr || result.error || 'Failed to get docker status', duration_ms: result.duration_ms };
  }

  return { success: true, data: result.stdout, duration_ms: result.duration_ms };
}

export async function handleDockerLogs(container: string, lines: number = 100): Promise<AgentResponse<string>> {
  if (!/^[a-zA-Z0-9_-]+$/.test(container)) {
    return { success: false, error: 'Invalid container name: only alphanumeric, hyphens, and underscores allowed' };
  }

  const result = await executeCommand(`docker logs --tail ${lines} ${container}`);

  if (!result.success) {
    return { success: false, error: result.stderr || result.error || 'Failed to get logs', duration_ms: result.duration_ms };
  }

  // docker logs writes to both stdout and stderr
  return { success: true, data: result.stdout || result.stderr, duration_ms: result.duration_ms };
}

export async function handleDiskUsage(): Promise<AgentResponse<string>> {
  const dfResult = await executeCommand('df -h /');
  const duResult = await executeCommand('du -sh /local/data/scrath/docker-data/* 2>/dev/null | sort -rh | head -10');

  const output = [
    '=== Filesystem Usage ===',
    dfResult.success ? dfResult.stdout : `Error: ${dfResult.stderr}`,
    '',
    '=== Docker Data Directory ===',
    duResult.success ? duResult.stdout : `Error: ${duResult.stderr}`,
  ].join('\n');

  return {
    success: dfResult.success,
    data: output,
    duration_ms: (dfResult.duration_ms || 0) + (duResult.duration_ms || 0),
  };
}

export async function handleGitStatus(workingDirectory?: string): Promise<AgentResponse<string>> {
  const cwd = workingDirectory || process.env.WORKSPACE_DIR || '/local/data/scrath/docker-data';
  const opts = { cwd };

  const [branchResult, hashResult, statusResult] = await Promise.all([
    executeCommand('git branch --show-current', opts),
    executeCommand('git rev-parse --short HEAD', opts),
    executeCommand('git status --porcelain', opts),
  ]);

  if (!branchResult.success) {
    return { success: false, error: branchResult.stderr || 'Not a git repository' };
  }

  const branch = branchResult.stdout.trim();
  const hash = hashResult.stdout.trim();
  const changes = statusResult.stdout.trim();

  const output = [
    `Branch: ${branch}`,
    `Commit: ${hash}`,
    changes ? `Changes:\n${changes}` : 'Working tree clean',
  ].join('\n');

  return { success: true, data: output };
}

export async function handleServiceHealth(urls?: string[]): Promise<AgentResponse<string>> {
  const targets = urls || ['http://localhost:3000', 'http://localhost:8000/health'];

  const results = await Promise.all(
    targets.map(async (url) => {
      const result = await executeCommand(
        `curl -s -o /dev/null -w '%{http_code} %{time_total}s' --max-time 5 ${url}`
      );
      return { url, output: result.success ? result.stdout : 'UNREACHABLE', success: result.success };
    })
  );

  const output = results
    .map((r) => `${r.url}: ${r.output}`)
    .join('\n');

  return { success: true, data: output };
}
