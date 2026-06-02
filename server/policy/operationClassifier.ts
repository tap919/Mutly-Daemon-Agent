export type RiskLevel = 'green' | 'yellow' | 'orange' | 'red';

export interface RiskOptions {
  isReversible?: boolean;
  affectsMultipleFiles?: boolean;
  introducesDependencies?: boolean;
  usesRemoteArtifact?: boolean;
  isCriticalPath?: boolean;
}

export function classifyOperation(
  action: string,
  filePath?: string,
  opts?: RiskOptions
): RiskLevel {
  // Critical file patterns
  const criticalPatterns = [
    /auth/i,
    /config/i,
    /deploy/i,
    /ci/i,
    /credentials/i,
    // Also common config file names
    /\.(env|json|env\.example|yml|yaml)$/i,
    // package.json handled via introducesDependencies, not critical path
    /pom\.xml$/i,
    /gradle\.kts$/i,
    /Dockerfile$/i,
    /docker-compose\.yml$/i,
    /terraform\.tf$/i,
    /kubernetes\/.*\.ya?ml$/i,
    /\.gitignore$/i
  ];

  const isCriticalPath = opts?.isCriticalPath || 
    (filePath && criticalPatterns.some(p => p.test(filePath)));

  // Red: critical path writes/deletes/destructive actions
  if (isCriticalPath) {
    if (['write', 'update', 'delete', 'remove', 'overwrite', 'modify'].some(k => 
        action.toLowerCase().includes(k))) {
      return 'red';
    }
    if (['read', 'lookup', 'log', 'summary'].some(k => 
        action.toLowerCase().includes(k))) {
      return 'green';
    }
  }

  // Orange: remote artifacts, dependency changes, multi-file operations
  if (opts?.usesRemoteArtifact) {
    return 'orange';
  }
  if (opts?.introducesDependencies) {
    return 'orange';
  }
  if (opts?.affectsMultipleFiles) {
    if (isCriticalPath || opts?.isReversible === false) {
      return 'red';
    }
    return 'orange';
  }

  // Yellow: simple writes/edit to non-critical files
  if (['write', 'update', 'edit', 'save', 'create'].some(k => 
        action.toLowerCase().includes(k))) {
    if (isCriticalPath) {
      return 'red';
    }
    return 'yellow';
  }

  // Red: destructive/actions that could be harmful
  if (['delete', 'remove', 'destroy', 'drop'].some(k => 
        action.toLowerCase().includes(k))) {
    return 'red';
  }

  // Orange: complex actions that are not simple writes
  if (['run', 'exec', 'deploy', 'publish', 'build', 'compile'].some(k => 
        action.toLowerCase().includes(k))) {
    if (isCriticalPath) {
      return 'red';
    }
    return 'orange';
  }

  // Default to green for pure reads/summary/log type actions
  return 'green';
}

export function getRiskDescription(risk: RiskLevel): string {
  switch (risk) {
    case 'green':
      return 'Read-only lookups, logging, internal summaries, memory retrieval';
    case 'yellow':
      return 'Low-impact writes to non-critical local files, reversible edits, small generated artifacts';
    case 'orange':
      return 'Cross-system changes, multi-file writes, dependency changes, remote-generated artifacts that will become code';
    case 'red':
      return 'Critical config/auth/deploy changes, destructive operations, credential handling, audit-log mutation, large or irreversible blast radius';
  }
}