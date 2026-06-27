import React from 'react';

export const Badge = ({ children, variant = 'default' }: { children: React.ReactNode; variant?: 'default' | 'success' | 'warning' | 'danger' }) => {
  const variants = {
    default: 'bg-zinc-850 text-zinc-300 border border-zinc-700',
    success: 'bg-emerald-950/50 text-emerald-400 border border-emerald-900/50',
    warning: 'bg-amber-950/50 text-amber-400 border border-amber-900/50',
    danger: 'bg-rose-950/50 text-rose-400 border border-rose-900/50',
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${variants[variant]}`}>
      {children}
    </span>
  );
};
