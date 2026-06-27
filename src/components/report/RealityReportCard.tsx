import React from 'react';
import { RealityReport } from '@/lib/types';
import { ScoreGrid } from './ScoreGrid';
import { VerdictBadge } from './VerdictBadge';
import { EvidenceList } from './EvidenceList';
import { OptimizationList } from './OptimizationList';
import { Card } from '@/components/ui/Card';

interface RealityReportCardProps {
  report: RealityReport;
}

export const RealityReportCard = ({ report }: RealityReportCardProps) => {
  const formattedDate = new Date(report.timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header Info */}
      <Card className="border-zinc-850 bg-zinc-950/20 backdrop-blur-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <span className="text-xs font-mono tracking-widest text-zinc-500 uppercase">
                Heuristic Reality Report
              </span>
              <span className="text-zinc-700">•</span>
              <span className="text-xs text-zinc-500 font-mono">
                {formattedDate}
              </span>
            </div>
            <h2 className="text-xl font-bold text-zinc-100 flex items-center gap-2">
              Scan Type:{' '}
              <span className="text-indigo-400 font-mono text-lg font-semibold capitalize">
                {report.type.replace('_', ' ')}
              </span>
            </h2>
          </div>
          <div className="flex items-center gap-2 bg-zinc-900/40 p-1.5 rounded-lg border border-zinc-850">
            <span className="text-xs text-zinc-500 px-2 font-medium">Verdict:</span>
            <VerdictBadge verdict={report.verdict} />
          </div>
        </div>

        <div className="mt-4 border-t border-zinc-900 pt-4">
          <p className="text-sm text-zinc-300 leading-relaxed font-sans italic">
            "{report.summary}"
          </p>
        </div>
      </Card>

      {/* Main Scores Grid */}
      <ScoreGrid scores={report.scores} />

      {/* Detailed Analysis Breakdowns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-zinc-850 bg-zinc-950/20">
          <EvidenceList evidence={report.evidence} />
        </Card>
        <Card className="border-zinc-850 bg-zinc-950/20">
          <OptimizationList optimizations={report.optimizations} />
        </Card>
      </div>
    </div>
  );
};
