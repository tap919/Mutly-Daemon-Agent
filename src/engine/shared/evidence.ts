import type { EvidenceItem } from '@/lib/types';

export function createEvidence(label: string, value: string | number, weight: EvidenceItem['weight'], source: EvidenceItem['source']): EvidenceItem {
  return {
    label,
    value,
    weight,
    source,
  };
}

export function combineEvidence(...evidenceArrays: EvidenceItem[][]): EvidenceItem[] {
  return evidenceArrays.flat();
}