import React from 'react';
import { ScoreBreakdown } from '@/lib/types';
import { Card } from '@/components/ui/Card';

interface ScoreGridProps {
  scores: ScoreBreakdown;
}

export const ScoreGrid = ({ scores }: ScoreGridProps) => {
  const items = [
    {
      label: 'Reality Score',
      value: scores.reality,
      desc: 'Feasibility & resource alignment',
      color: 'text-indigo-400',
    },
    {
      label: 'Risk Index',
      value: scores.risk,
      desc: 'Financial or structural exposure',
      color: scores.risk > 60 ? 'text-rose-400' : 'text-emerald-400',
    },
    {
      label: 'AI Style Index',
      value: scores.aiReadiness,
      desc: 'Structural & stylistic readiness',
      color: 'text-amber-400',
    },
    {
      label: 'Human Oversight',
      value: scores.humanOversightNeeded,
      desc: 'Audit & manual vigilance needed',
      color: scores.humanOversightNeeded > 60 ? 'text-amber-400' : 'text-zinc-400',
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {items.map((item) => (
        <Card key={item.label} className="flex flex-col justify-between border-zinc-850/60 bg-zinc-950/40 hover:border-zinc-800 transition-all duration-300">
          <div>
            <h4 className="text-xs font-mono tracking-widest text-zinc-500 uppercase">{item.label}</h4>
            <p className="text-[11px] text-zinc-500 mt-1 leading-relaxed">{item.desc}</p>
          </div>
          <div className="mt-4 flex items-baseline gap-1.5">
            <span className={`text-3xl font-bold tracking-tight ${item.color}`}>
              {item.value}
            </span>
            <span className="text-xs text-zinc-600">/100</span>
          </div>
        </Card>
      ))}
    </div>
  );
};
