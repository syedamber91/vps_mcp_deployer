import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleRunJob } from "../../src/handlers/jobs.js";

vi.mock("../../src/executor.js", () => ({
  executeCommand: vi.fn(),
}));

vi.mock("../../src/allowlist.js", () => ({
  validateCommand: vi.fn(),
}));

import { executeCommand } from "../../src/executor.js";
import { validateCommand } from "../../src/allowlist.js";

const mockExecute = vi.mocked(executeCommand);
const mockValidate = vi.mocked(validateCommand);

beforeEach(() => {
  vi.clearAllMocks();
  mockValidate.mockReturnValue({ valid: true });
  mockExecute.mockResolvedValue({
    success: true,
    stdout: "done",
    stderr: "",
    duration_ms: 100,
  });
});

describe("handleRunJob", () => {
  it("runs a named job found in CLAUDE.md", async () => {
    const claudeMd = `# Deploy Frontend\n\n\`\`\`bash\ndocker build -t app .\n\`\`\`\n`;

    const result = await handleRunJob({
      repo_url: "https://github.com/test/repo",
      branch: "main",
      claude_md: claudeMd,
      job_name: "Deploy Frontend",
    });

    expect(result.success).toBe(true);
    expect(mockExecute).toHaveBeenCalledWith(
      "docker build -t app .",
      expect.objectContaining({ timeout_ms: 600_000 })
    );
  });

  it("runs a direct command when no CLAUDE.md job section matches", async () => {
    const result = await handleRunJob({
      repo_url: "https://github.com/test/repo",
      branch: "main",
      claude_md: "# Unrelated\n\nSome text",
      job_name: "echo hello",
      job_args: ["world"],
    });

    expect(result.success).toBe(true);
    expect(mockExecute).toHaveBeenCalledWith(
      "echo hello world",
      expect.objectContaining({ timeout_ms: 600_000 })
    );
  });

  it("returns error for empty job_name", async () => {
    const result = await handleRunJob({
      repo_url: "https://github.com/test/repo",
      branch: "main",
      claude_md: "",
      job_name: "",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("job_name is required");
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("rejects commands blocked by allowlist", async () => {
    mockValidate.mockReturnValue({ valid: false, reason: "not allowed" });

    const result = await handleRunJob({
      repo_url: "https://github.com/test/repo",
      branch: "main",
      claude_md: "",
      job_name: "rm -rf /",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Blocked command");
  });
});
