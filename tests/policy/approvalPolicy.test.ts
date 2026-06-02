import { describe, it, expect } from 'vitest';
import { evaluateApprovalPolicy, ApprovalDecision } from '../../server/policy/approvalPolicy.js';
import { classifyOperation } from '../../server/policy/operationClassifier.js';

describe('Approval Policy', () => {
  describe('basic approval checks', () => {
    it('should not require approval for green operations', () => {
      const riskLevel = classifyOperation('read_file', 'src/utils.ts');
      const result = evaluateApprovalPolicy('read_file', riskLevel, 'src/utils.ts');
      expect(result.requiresApproval).toBe(false);
    });

    it('should require approval for red-risk operations', () => {
      const riskLevel = classifyOperation('write', '.env');
      const result = evaluateApprovalPolicy('write', riskLevel, '.env');
      expect(result.requiresApproval).toBe(true);
      expect(result.reason).toContain('red-risk');
    });

    it('should require approval for critical file modifications', () => {
      const riskLevel = classifyOperation('apply_diff', 'auth/routes.ts');
      const result = evaluateApprovalPolicy('apply_diff', riskLevel, 'auth/routes.ts');
      expect(result.requiresApproval).toBe(true);
      expect(result.reason).toContain('Modifying critical file');
    });

    it('should require approval for large remote artifacts', () => {
      const riskLevel = classifyOperation('apply_artifact', 'generated.ts', { usesRemoteArtifact: true });
      const result = evaluateApprovalPolicy('apply_artifact', riskLevel, 'generated.ts', { artifactSize: 60000 });
      expect(result.requiresApproval).toBe(true);
      expect(result.reason).toContain('exceeds autonomous threshold');
    });
  });

  describe('threshold validation', () => {
    it('should catch batch sizes over limit', () => {
      const riskLevel = classifyOperation('write', 'src/utils.ts');
      const result = evaluateApprovalPolicy('write', riskLevel, 'src/utils.ts', { fileBatchCount: 25 });
      expect(result.requiresApproval).toBe(true);
      expect(result.reason).toContain('exceeds maximum');
    });

    it('should allow within budget limits', () => {
      const riskLevel = classifyOperation('write', 'src/utils.ts');
      const result = evaluateApprovalPolicy('write', riskLevel, 'src/utils.ts', { fileBatchCount: 5 });
      expect(result.requiresApproval).toBe(false);
    });
  });
});