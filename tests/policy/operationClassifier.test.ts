import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { classifyOperation, RiskLevel, getRiskDescription } from '../../server/policy/operationClassifier.js';

describe('operationClassifier', () => {
  describe('classifyOperation', () => {
    it('should classify read-only operations as green', () => {
      expect(classifyOperation('read_file', 'src/index.ts')).toBe('green');
      expect(classifyOperation('lookup', 'src/utils.ts')).toBe('green');
      expect(classifyOperation('log', 'server.log')).toBe('green');
      expect(classifyOperation('summary', 'workspace')).toBe('green');
    });

    it('should classify simple writes to non-critical files as yellow', () => {
      expect(classifyOperation('write', 'src/temp.txt')).toBe('yellow');
      expect(classifyOperation('create', 'output/result.md')).toBe('yellow');
      expect(classifyOperation('edit', 'notes.txt')).toBe('yellow');
    });

    it('should classify multi-file writes as orange (non-critical)', () => {
      expect(classifyOperation('write', 'src/file.ts', { affectsMultipleFiles: true })).toBe('orange');
      expect(classifyOperation('apply_diff', 'src/component.tsx', { affectsMultipleFiles: true })).toBe('orange');
    });

    it('should classify dependency changes as orange', () => {
      expect(classifyOperation('write', 'src/package.ts', { introducesDependencies: true })).toBe('orange');
      expect(classifyOperation('apply_diff', 'src/pom.ts', { introducesDependencies: true })).toBe('orange');
    });

    it('should classify remote artifact application as orange', () => {
      expect(classifyOperation('apply_artifact', 'generated.ts', { usesRemoteArtifact: true })).toBe('orange');
    });

    it('should classify critical file modifications as red', () => {
      expect(classifyOperation('write', '.env')).toBe('red');
      expect(classifyOperation('write', 'config/secrets.json')).toBe('red');
      expect(classifyOperation('write', 'auth/middleware.ts')).toBe('red');
      expect(classifyOperation('write', 'deploy/index.js')).toBe('red');
      expect(classifyOperation('write', 'infrastructure/terraform.tf')).toBe('red');
    });

    it('should classify destructive operations as red', () => {
      expect(classifyOperation('delete', 'temp/')).toBe('red');
      expect(classifyOperation('remove', 'build/')).toBe('red');
      expect(classifyOperation('destroy', 'database')).toBe('red');
    });

    it('should classify critical path multi-file operations as red', () => {
      expect(classifyOperation('write', 'auth/routes.ts', { affectsMultipleFiles: true })).toBe('red');
      expect(classifyOperation('write', 'deploy/config.yml', { affectsMultipleFiles: true, isReversible: false })).toBe('red');
    });
  });

  describe('getRiskDescription', () => {
    it('should return correct descriptions for each risk level', () => {
      expect(getRiskDescription('green')).toContain('Read-only');
      expect(getRiskDescription('yellow')).toMatch(/low-impact/i);
      expect(getRiskDescription('orange')).toMatch(/cross-system/i);
      expect(getRiskDescription('red')).toMatch(/critical/i);
    });
  });
});