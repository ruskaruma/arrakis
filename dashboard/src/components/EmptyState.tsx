interface EmptyStateProps {
  onCreate: () => void;
}

export default function EmptyState({ onCreate }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-28 animate-fade-in">
      <img src="/logo.png" alt="Arrakis" className="w-32 mb-6 opacity-30" />
      <h3 className="text-lg font-semibold text-gray-900 mb-2">No stores yet</h3>
      <p className="text-sm text-gray-500 mb-8 max-w-xs text-center">
        Create your first WooCommerce store. Each store gets its own isolated Kubernetes namespace.
      </p>
      <button
        onClick={onCreate}
        className="px-6 py-2.5 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 transition-colors shadow-sm"
      >
        Create Store
      </button>
    </div>
  );
}
