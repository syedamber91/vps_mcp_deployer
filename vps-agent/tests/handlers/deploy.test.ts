import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/claude-md-parser.js", () => ({
  parseDeployInstructions: vi.fn(),
}));
vi.mock("../../src/allowlist.js", () => ({
  validateCommand: vi.fn(),
}));
vi.mock("../../src/executor.js", () => ({
  executeSequence: vi.fn(),
}));

import { handleDeploy } from "../../src/handlers/deploy.js";
import { parseDeployInstructions } from "../../src/claude-md-parser.js";
import { validateCommand } from "../../src/allowlist.js";
import { executeSequence } from "../../src/executor.js";

const mockParse = vi.mocked(parseDeployInstructions);
const mockValidate = vi.mocked(validateCommand);
const mockExecute = vi.mocked(executeSequence);

describe("handleDeploy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parses CLAUDE.md and executes deploy commands successfully", async () => {
    mockParse.mockReturnValue({ commands: ["docker build -t app .", "docker restart app"] });
    mockValidate.mockReturnValue({ valid: true });
    mockExecute.mockResolvedValue({
      steps_executed: 2,
      steps_total: 2,
      final_status: "success",
      logs: ["ok", "ok"],
    });

    const result = await handleDeploy({
      repo_url: "https://github.com/test/repo",
      branch: "develop",
      claude_md: "# Deploy\n```bash\ndocker build\n```",
      operation: "deploy",
    });

    expect(result.success).toBe(true);
    expect(result.data?.final_status).toBe("success");
    expect(mockParse).toHaveBeenCalledWith(expect.any(String), "deploy");
  });

  it("returns error when no deploy instructions found", async () => {
    mockParse.mockReturnValue({ commands: [], error: "No deploy section found" });

    const result = await handleDeploy({
      repo_url: "https://github.com/test/repo",
      branch: "develop",
      claude_md: "# Nothing here",
      operation: "deploy",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("No deploy section found");
  });

  it("rejects commands that fail allowlist", async () => {
    mockParse.mockReturnValue({ commands: ["rm -rf /", "docker build ."] });
    mockValidate.mockReturnValueOnce({ valid: false, reason: "destructive command" });

    const result = await handleDeploy({
      repo_url: "https://github.com/test/repo",
      branch: "develop",
      claude_md: "# Deploy",
      operation: "deploy",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("rm -rf /");
    expect(result.error).toContain("destructive command");
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("uses working_directory override when provided", async () => {
    mockParse.mockReturnValue({ commands: ["echo hi"], working_directory: "/parsed/dir" });
    mockValidate.mockReturnValue({ valid: true });
    mockExecute.mockResolvedValue({
      steps_executed: 1,
      steps_total: 1,
      final_status: "success",
      logs: ["hi"],
    });

    await handleDeploy({
      repo_url: "https://github.com/test/repo",
      branch: "develop",
      claude_md: "# Deploy",
      operation: "deploy",
      working_directory: "/custom/override",
    });

    expect(mockExecute).toHaveBeenCalledWith(["echo hi"], { cwd: "/custom/override" });
  });
});
