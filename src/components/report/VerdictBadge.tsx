import React from 'react';
import { Verdict } from '@/lib/types';
import { Badge } from '@/components/ui/Badge';

interface VerdictBadgeProps {
  verdict: Verdict;
}

const VERDICT_DETAILS = {
  strong_go: { label: 'Strong Go', variant: 'success' as const },
  conditional_go: { label: 'Conditional Go', variant: 'warning' as const },
  pivot: { label: 'Pivot Recommended', variant: 'warning' as const },
  strong_no: { label: 'Strong No-Go', variant: 'danger' as const },
};

export const VerdictBadge = ({ verdict }: VerdictBadgeProps) => {
  const details = VERDICT_DETAILS[verdict] || { label: verdict, variant: 'default' as const };
  return <Badge variant={details.variant}>{details.label}</Badge>;
};
