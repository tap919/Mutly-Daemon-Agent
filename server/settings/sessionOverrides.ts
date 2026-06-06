/**
 * In-memory session-level feature flag overrides.
 * Reset on daemon restart. Never flushed to disk.
 */
const overrides = new Map<string, boolean>();

export function setFlag(key: string, value: boolean): void {
  overrides.set(key, value);
}

export function getFlag(key: string): boolean | undefined {
  return overrides.get(key);
}

export function getAllFlags(): Record<string, boolean> {
  return Object.fromEntries(overrides);
}

export function clearFlags(): void {
  overrides.clear();
}

export function removeFlag(key: string): boolean {
  return overrides.delete(key);
}

export function hasOverride(key: string): boolean {
  return overrides.has(key);
}
