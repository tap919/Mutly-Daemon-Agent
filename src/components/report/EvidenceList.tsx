import React from 'react';
import { EvidenceItem } from '@/lib/types';
import { Badge } from '@/components/ui/Badge';

interface EvidenceListProps {
  evidence: EvidenceItem[];
}

const WEIGHT_VARIANTS = {
  strong: 'success' as const,
  moderate: 'warning' as const,
  weak: 'default' as const,
};

export const EvidenceList = ({ evidence }: EvidenceListProps) => {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold tracking-wide text-zinc-300 font-mono uppercase">Detected Evidence</h3>
      <div className="overflow-hidden rounded-lg border border-zinc-900 bg-zinc-950/20 divide-y divide-zinc-900/60">
        {evidence.map((item, idx) => (
          <div key={idx} className="flex items-center justify-between p-3 text-sm hover:bg-zinc-900/20 transition-colors">
            <div className="flex flex-col gap-0.5">
              <span className="font-medium text-zinc-300">{item.label}</span>
              <span className="text-xs text-zinc-500 font-mono">Source: {item.source}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-zinc-200 font-semibold text-xs bg-zinc-900/40 px-2 py-1 rounded border border-zinc-800/80 font-mono">
                {item.value}
              </span>
              <Badge variant={WEIGHT_VARIANTS[item.weight]}>
                {item.weight}
              </Badge>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
