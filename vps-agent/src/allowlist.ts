export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

const ALLOWED_BINARIES = new Set([
  'git', 'docker', 'docker-compose', 'sudo', 'bash', 'curl',
  'python3', 'sh', 'npm', 'node', 'echo', 'cat',
]);

const BLOCKED_BINARIES = new Set([
  'shutdown', 'reboot', 'mkfs', 'dd', 'iptables',
  'rm', 'wget', 'nc', 'ncat',
]);

const BLOCKED_PATH_PATTERNS = [/\/dev\//, /\/etc\//];

function splitChainedCommands(command: string): string[] {
  // Split on ;, |, &&, || but not inside quotes
  // Simple approach: split on these operators
  return command.split(/\s*(?:;|\|{1,2}|&&)\s*/).filter(Boolean);
}

function validateSingleCommand(cmd: string): ValidationResult {
  const trimmed = cmd.trim();
  if (!trimmed) return { valid: true };

  // Check for redirect writes outside /local/data/
  const redirectMatch = trimmed.match(/>\s*(\S+)/);
  if (redirectMatch) {
    const target = redirectMatch[1];
    if (target.startsWith('/') && !target.startsWith('/local/data/')) {
      return { valid: false, reason: 'Writes via redirect are only allowed under /local/data/' };
    }
  }

  // Check for blocked path patterns in the full command
  for (const pattern of BLOCKED_PATH_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { valid: false, reason: `Access to ${pattern} paths is blocked` };
    }
  }

  // Extract binary
  const parts = trimmed.split(/\s+/);
  let binary = parts[0];

  // Normalize binaries that start with mkfs. (e.g. mkfs.ext4)
  if (binary.startsWith('mkfs')) binary = 'mkfs';

  // Check blocked first
  if (BLOCKED_BINARIES.has(binary)) {
    return { valid: false, reason: `Binary '${binary}' is blocked` };
  }

  // Handle sudo: validate the sub-command
  if (binary === 'sudo') {
    if (parts.length < 2) {
      return { valid: false, reason: 'sudo with no sub-command' };
    }
    const subCmd = parts.slice(1).join(' ');
    return validateSingleCommand(subCmd);
  }

  if (!ALLOWED_BINARIES.has(binary)) {
    return { valid: false, reason: `Binary '${binary}' is not in allowlist` };
  }

  return { valid: true };
}

export function validateCommand(command: string): ValidationResult {
  const parts = splitChainedCommands(command);
  for (const part of parts) {
    const result = validateSingleCommand(part);
    if (!result.valid) return result;
  }
  return { valid: true };
}
