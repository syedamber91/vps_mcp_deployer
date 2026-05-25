import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/executor.js', () => ({
  executeCommand: vi.fn(),
}));

import { executeCommand } from '../../src/executor.js';
import {
  handleDockerStatus,
  handleDockerLogs,
  handleDiskUsage,
  handleGitStatus,
  handleServiceHealth,
} from '../../src/handlers/query.js';

const mockExec = vi.mocked(executeCommand);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('handleDockerStatus', () => {
  it('returns success with docker ps output', async () => {
    mockExec.mockResolvedValueOnce({
      success: true,
      stdout: 'CONTAINER ID\tIMAGE\tSTATUS\nab12\tnginx\tUp 2 hours',
      stderr: '',
      duration_ms: 50,
    });

    const result = await handleDockerStatus();
    expect(result.success).toBe(true);
    expect(result.data).toContain('nginx');
    expect(mockExec).toHaveBeenCalledWith(
      expect.stringContaining('docker ps --format')
    );
  });
});

describe('handleDockerLogs', () => {
  it('returns logs for valid container', async () => {
    mockExec.mockResolvedValueOnce({
      success: true,
      stdout: 'log line 1\nlog line 2',
      stderr: '',
      duration_ms: 30,
    });

    const result = await handleDockerLogs('my-container_1', 50);
    expect(result.success).toBe(true);
    expect(result.data).toContain('log line 1');
  });

  it('rejects invalid container names', async () => {
    const result = await handleDockerLogs('rm -rf /');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/invalid container name/i);
    expect(mockExec).not.toHaveBeenCalled();
  });

  it('rejects container names with semicolons', async () => {
    const result = await handleDockerLogs('foo;bar');
    expect(result.success).toBe(false);
    expect(mockExec).not.toHaveBeenCalled();
  });
});

describe('handleDiskUsage', () => {
  it('returns success with disk info', async () => {
    mockExec.mockResolvedValueOnce({
      success: true,
      stdout: '/dev/sda1 50G 30G 20G 60% /',
      stderr: '',
      duration_ms: 40,
    });
    mockExec.mockResolvedValueOnce({
      success: true,
      stdout: '5G\t/local/data/scrath/docker-data/webapp',
      stderr: '',
      duration_ms: 60,
    });

    const result = await handleDiskUsage();
    expect(result.success).toBe(true);
    expect(result.data).toContain('/dev/sda1');
  });
});

describe('handleGitStatus', () => {
  it('returns git info for default directory', async () => {
    mockExec.mockResolvedValueOnce({ success: true, stdout: 'develop\n', stderr: '', duration_ms: 10 });
    mockExec.mockResolvedValueOnce({ success: true, stdout: 'abc1234\n', stderr: '', duration_ms: 10 });
    mockExec.mockResolvedValueOnce({ success: true, stdout: ' M file.ts\n', stderr: '', duration_ms: 10 });

    const result = await handleGitStatus();
    expect(result.success).toBe(true);
    expect(result.data).toContain('develop');
    expect(result.data).toContain('abc1234');
  });
});

describe('handleServiceHealth', () => {
  it('returns health status for default urls', async () => {
    mockExec.mockResolvedValueOnce({ success: true, stdout: '200 0.5s', stderr: '', duration_ms: 500 });
    mockExec.mockResolvedValueOnce({ success: true, stdout: '200 0.3s', stderr: '', duration_ms: 300 });

    const result = await handleServiceHealth();
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
  });

  it('returns health status for custom urls', async () => {
    mockExec.mockResolvedValueOnce({ success: true, stdout: '200 0.1s', stderr: '', duration_ms: 100 });

    const result = await handleServiceHealth(['http://example.com']);
    expect(result.success).toBe(true);
  });
});
