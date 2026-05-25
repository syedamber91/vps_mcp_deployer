import { parseDeployInstructions } from "../claude-md-parser.js";
import { validateCommand } from "../allowlist.js";
import { executeSequence } from "../executor.js";
import type { DeployRequest, AgentResponse, DeployResult } from "../../../shared/types.js";

export async function handleDeploy(req: DeployRequest): Promise<AgentResponse<DeployResult>> {
  const parsed = parseDeployInstructions(req.claude_md, req.operation);

  if (parsed.error || !parsed.commands || parsed.commands.length === 0) {
    return { success: false, error: parsed.error || "No deploy instructions found" };
  }

  for (const cmd of parsed.commands) {
    const validation = validateCommand(cmd);
    if (!validation.valid) {
      return { success: false, error: `Blocked command: ${cmd} — ${validation.reason}` };
    }
  }

  const cwd =
    req.working_directory ||
    parsed.working_directory ||
    process.env.WORKSPACE_DIR ||
    "/local/data/scrath/docker-data";

  const result = await executeSequence(parsed.commands, { cwd });

  return {
    success: result.final_status === "success",
    data: result,
    error: result.final_status === "failed" ? result.failed_step?.stderr : undefined,
  };
}
