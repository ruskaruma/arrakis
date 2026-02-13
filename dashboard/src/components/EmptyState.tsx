interface EmptyStateProps {
  onCreate: () => void;
}

export default function EmptyState({ onCreate }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-28 animate-fade-in">
      <img src="/logo.png" alt="Arrakis" className="w-32 mb-6 opacity-30" />
      <h3 className="text-lg font-semibold text-[var(--text-body)] mb-2">No stores yet</h3>
      <p className="text-sm text-[var(--text-muted)] mb-8 max-w-xs text-center">
        Create your first WooCommerce store. Each store gets its own isolated Kubernetes namespace.
      </p>
      <button
        onClick={onCreate}
        className="px-6 py-2.5 text-sm font-medium text-black bg-[#d4a843] rounded-lg hover:bg-[#c8992e] transition-colors"
      >
        Create Store
      </button>
    </div>
  );
}
