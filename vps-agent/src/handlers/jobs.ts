import { executeCommand } from "../executor.js";
import { validateCommand } from "../allowlist.js";
import type { RunJobRequest, AgentResponse } from "../../../shared/types.js";

/**
 * Extract a bash code block from CLAUDE.md under a heading matching job_name.
 */
function findJobInClaudeMd(claudeMd: string, jobName: string): string | null {
  const lines = claudeMd.split("\n");
  let found = false;
  let inCodeBlock = false;
  let code = "";

  for (const line of lines) {
    if (!found) {
      // Match heading containing job_name (case-insensitive)
      const headingMatch = line.match(/^#{1,6}\s+(.+)/);
      if (headingMatch && headingMatch[1].toLowerCase().includes(jobName.toLowerCase())) {
        found = true;
      }
      continue;
    }

    // After finding heading, look for bash code block
    if (!inCodeBlock) {
      if (line.match(/^```(bash|sh)?/)) {
        inCodeBlock = true;
        continue;
      }
      // If we hit another heading before a code block, stop
      if (line.match(/^#{1,6}\s+/)) {
        break;
      }
    } else {
      if (line.startsWith("```")) {
        break;
      }
      code += (code ? "\n" : "") + line;
    }
  }

  return code || null;
}

export async function handleRunJob(req: RunJobRequest): Promise<AgentResponse<string>> {
  if (!req.job_name || req.job_name.trim() === "") {
    return { success: false, error: "job_name is required" };
  }

  // Try to find job in CLAUDE.md
  let command: string | null = null;

  if (req.claude_md) {
    command = findJobInClaudeMd(req.claude_md, req.job_name);
  }

  // If not found, use job_name as direct command
  if (!command) {
    command = req.job_name;
  }

  // Append job_args if provided
  if (req.job_args && req.job_args.length > 0) {
    command += " " + req.job_args.join(" ");
  }

  // Validate against allowlist
  const validation = validateCommand(command);
  if (!validation.valid) {
    return { success: false, error: `Blocked command: ${command} — ${validation.reason}` };
  }

  const cwd = process.env.WORKSPACE_DIR || "/local/data/scrath/docker-data";

  const result = await executeCommand(command, { timeout_ms: 600_000, cwd });

  const output = [result.stdout, result.stderr].filter(Boolean).join("\n");

  return {
    success: result.success,
    data: output,
    error: result.success ? undefined : result.error,
    duration_ms: result.duration_ms,
  };
}
