import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseDeployInstructions } from '../src/claude-md-parser.js';

const fixturesDir = join(import.meta.dirname, 'fixtures');
const nautabaq = readFileSync(join(fixturesDir, 'nautabaq-claude.md'), 'utf-8');
const simple = readFileSync(join(fixturesDir, 'simple-claude.md'), 'utf-8');

describe('parseDeployInstructions', () => {
  it('extracts frontend deploy commands from NauTabaq CLAUDE.md', () => {
    const result = parseDeployInstructions(nautabaq, 'frontend');
    expect(result.commands.length).toBeGreaterThanOrEqual(2);
    expect(result.commands.some(c => c.includes('docker build'))).toBe(true);
    expect(result.commands.some(c => c.includes('docker run'))).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('extracts git pull commands for "full" operation', () => {
    const result = parseDeployInstructions(nautabaq, 'full');
    expect(result.commands.some(c => c.includes('git pull'))).toBe(true);
    expect(result.commands.some(c => c.includes('docker build'))).toBe(true);
  });

  it('extracts all 4 commands from simple CLAUDE.md', () => {
    const result = parseDeployInstructions(simple, 'full');
    expect(result.commands).toEqual([
      'git pull origin main',
      'docker build -t myapp .',
      'docker stop myapp && docker rm myapp',
      'docker run -d --name myapp -p 3000:3000 myapp',
    ]);
  });

  it('returns empty commands + error when no deployment section found', () => {
    const result = parseDeployInstructions('# Just a README\n\nNo deploy info here.', 'full');
    expect(result.commands).toEqual([]);
    expect(result.error).toBeDefined();
  });

  it('extracts working_directory from NauTabaq', () => {
    const result = parseDeployInstructions(nautabaq, 'frontend');
    expect(result.working_directory).toBe('/local/data/scrath/docker-data');
  });
});
