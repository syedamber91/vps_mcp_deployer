import { describe, test, expect, beforeEach } from 'vitest';
import { executeCommand, executeSequence, getAuditLog } from '../src/executor.js';

describe('executeCommand', () => {
  test('runs a simple command and returns stdout', async () => {
    const result = await executeCommand('echo hello');
    expect(result.success).toBe(true);
    expect(result.stdout.trim()).toBe('hello');
    expect(result.stderr).toBe('');
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
  });

  test('returns success false for failing command', async () => {
    const result = await executeCommand('false');
    expect(result.success).toBe(false);
  });

  test('handles timeout', async () => {
    const result = await executeCommand('sleep 10', { timeout_ms: 100 });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/timeout/i);
  });

  test('respects cwd option', async () => {
    const result = await executeCommand('pwd', { cwd: '/tmp' });
    expect(result.success).toBe(true);
    expect(result.stdout.trim()).toBe('/private/tmp');
  });
});

describe('executeSequence', () => {
  test('runs all commands in order on success', async () => {
    const result = await executeSequence(['echo one', 'echo two', 'echo three']);
    expect(result.steps_executed).toBe(3);
    expect(result.steps_total).toBe(3);
    expect(result.final_status).toBe('success');
    expect(result.failed_step).toBeUndefined();
    expect(result.logs).toHaveLength(3);
  });

  test('stops on first failure and reports failed_step', async () => {
    const result = await executeSequence(['echo ok', 'false', 'echo never']);
    expect(result.steps_executed).toBe(2);
    expect(result.steps_total).toBe(3);
    expect(result.final_status).toBe('failed');
    expect(result.failed_step).toEqual({
      index: 1,
      command: 'false',
      stderr: '',
    });
  });
});

describe('getAuditLog', () => {
  test('records executed commands', async () => {
    const before = getAuditLog().length;
    await executeCommand('echo audit');
    const log = getAuditLog();
    expect(log.length).toBeGreaterThan(before);
    const last = log[log.length - 1];
    expect(last.command).toBe('echo audit');
    expect(last.success).toBe(true);
    expect(last.duration_ms).toBeGreaterThanOrEqual(0);
    expect(last.timestamp).toBeTruthy();
  });
});
