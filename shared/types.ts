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

export interface AgentResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  logs?: string[];
  duration_ms?: number;
}

export interface DeployResult {
  steps_executed: number;
  steps_total: number;
  final_status: "success" | "failed";
  failed_step?: {
    index: number;
    command: string;
    stderr: string;
  };
  logs: string[];
}
