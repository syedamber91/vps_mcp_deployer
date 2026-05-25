import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export const TOOLS: Tool[] = [
  {
    name: "deploy",
    description:
      "Deploy a repository branch to the VPS. Runs the full deployment pipeline including git pull, build, and container restart.",
    inputSchema: {
      type: "object",
      properties: {
        repo_url: { type: "string", description: "Git repository URL to deploy" },
        branch: { type: "string", description: "Branch name to deploy" },
        claude_md: { type: "string", description: "CLAUDE.md content with deployment instructions" },
        operation: {
          type: "string",
          enum: ["frontend", "backend", "full", "custom"],
          description: "Type of deployment operation",
        },
        working_directory: { type: "string", description: "Working directory on the VPS" },
      },
      required: ["repo_url", "branch", "claude_md", "operation"],
    },
  },
  {
    name: "run_job",
    description:
      "Run a named job on the VPS (e.g. bhavcopy ingestion, macro pipeline, e2e script).",
    inputSchema: {
      type: "object",
      properties: {
        repo_url: { type: "string", description: "Git repository URL" },
        branch: { type: "string", description: "Branch to use" },
        claude_md: { type: "string", description: "CLAUDE.md content with job instructions" },
        job_name: { type: "string", description: "Name of the job to run" },
        job_args: {
          type: "array",
          items: { type: "string" },
          description: "Optional arguments for the job",
        },
      },
      required: ["repo_url", "branch", "claude_md", "job_name"],
    },
  },
  {
    name: "docker_status",
    description: "List all Docker containers on the VPS with their status, ports, and resource usage.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "docker_logs",
    description: "Fetch recent logs from a specific Docker container on the VPS.",
    inputSchema: {
      type: "object",
      properties: {
        container: { type: "string", description: "Container name or ID" },
        lines: { type: "number", description: "Number of log lines to retrieve (default: 100)" },
      },
      required: ["container"],
    },
  },
  {
    name: "disk_usage",
    description: "Check disk usage on the VPS, including Docker volumes and key directories.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "db_health",
    description: "Check health of PostgreSQL and Neo4j databases on the VPS (connectivity, row counts, replication status).",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "git_status",
    description: "Show git status on the VPS including current branch, uncommitted changes, and remote tracking info.",
    inputSchema: {
      type: "object",
      properties: {
        working_directory: { type: "string", description: "Git repository path on the VPS" },
      },
    },
  },
  {
    name: "service_health",
    description: "Check HTTP health of services by hitting their URLs and reporting status codes and response times.",
    inputSchema: {
      type: "object",
      properties: {
        urls: {
          type: "array",
          items: { type: "string" },
          description: "URLs to health-check (defaults to standard NauTabaq endpoints)",
        },
      },
    },
  },
];
