import React from 'react';

export const Card = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
  <div className={`rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 ${className}`}>
    {children}
  </div>
);
