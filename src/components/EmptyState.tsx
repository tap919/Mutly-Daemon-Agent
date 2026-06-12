interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export default function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 space-y-4">
      {icon && <div className="text-zinc-600">{icon}</div>}
      <h3 className="text-lg font-display font-semibold text-zinc-400">{title}</h3>
      {description && <p className="text-sm text-zinc-500 max-w-md text-center">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
