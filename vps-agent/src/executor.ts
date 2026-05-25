import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface ExecOptions {
  timeout_ms?: number;
  cwd?: string;
}

export interface CommandResult {
  success: boolean;
  stdout: string;
  stderr: string;
  error?: string;
  duration_ms: number;
}

export interface SequenceResult {
  steps_executed: number;
  steps_total: number;
  final_status: 'success' | 'failed';
  failed_step?: { index: number; command: string; stderr: string };
  logs: string[];
}

interface AuditEntry {
  timestamp: string;
  command: string;
  success: boolean;
  duration_ms: number;
}

const auditLog: AuditEntry[] = [];

export function getAuditLog(): AuditEntry[] {
  return auditLog;
}

export async function executeCommand(command: string, options?: ExecOptions): Promise<CommandResult> {
  const timeout = options?.timeout_ms ?? 300_000;
  const start = Date.now();

  try {
    const { stdout, stderr } = await execAsync(command, {
      timeout,
      maxBuffer: 10 * 1024 * 1024,
      cwd: options?.cwd,
    });
    const duration_ms = Date.now() - start;
    auditLog.push({ timestamp: new Date().toISOString(), command, success: true, duration_ms });
    return { success: true, stdout, stderr, duration_ms };
  } catch (err: any) {
    const duration_ms = Date.now() - start;
    let error: string | undefined;

    if (err.killed || err.signal === 'SIGTERM') {
      error = `Command timeout after ${timeout}ms`;
    }

    auditLog.push({ timestamp: new Date().toISOString(), command, success: false, duration_ms });
    return {
      success: false,
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? '',
      error,
      duration_ms,
    };
  }
}

export async function executeSequence(commands: string[], options?: ExecOptions): Promise<SequenceResult> {
  const logs: string[] = [];
  let stepsExecuted = 0;

  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i];
    logs.push(`[Step ${i + 1}] $ ${cmd}`);
    stepsExecuted++;

    const result = await executeCommand(cmd, options);

    if (!result.success) {
      return {
        steps_executed: stepsExecuted,
        steps_total: commands.length,
        final_status: 'failed',
        failed_step: { index: i, command: cmd, stderr: result.stderr },
        logs,
      };
    }
  }

  return {
    steps_executed: stepsExecuted,
    steps_total: commands.length,
    final_status: 'success',
    logs,
  };
}
