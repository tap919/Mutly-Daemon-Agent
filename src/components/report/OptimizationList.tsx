import React from 'react';
import { Optimization } from '@/lib/types';
import { Badge } from '@/components/ui/Badge';

interface OptimizationListProps {
  optimizations: Optimization[];
}

const IMPACT_VARIANTS = {
  high: 'success' as const,
  medium: 'warning' as const,
  low: 'default' as const,
};

const EFFORT_VARIANTS = {
  low: 'success' as const,
  medium: 'warning' as const,
  high: 'danger' as const,
};

export const OptimizationList = ({ optimizations }: OptimizationListProps) => {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold tracking-wide text-zinc-300 font-mono uppercase">Actionable Optimizations</h3>
      <div className="grid grid-cols-1 gap-3">
        {optimizations.map((opt, idx) => (
          <div
            key={idx}
            className="group flex flex-col gap-2 rounded-lg border border-zinc-900 bg-zinc-950/20 p-4 hover:border-zinc-800 transition-all duration-300"
          >
            <div className="flex items-start justify-between gap-4">
              <h4 className="text-sm font-semibold text-zinc-200 group-hover:text-white transition-colors">
                {opt.title}
              </h4>
              <div className="flex items-center gap-1.5 shrink-0">
                <Badge variant={IMPACT_VARIANTS[opt.impact]}>
                  {opt.impact} impact
                </Badge>
                <Badge variant={EFFORT_VARIANTS[opt.effort]}>
                  {opt.effort} effort
                </Badge>
              </div>
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed">
              {opt.description}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
};
