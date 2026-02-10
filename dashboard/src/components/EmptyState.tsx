interface EmptyStateProps {
  onCreate: () => void;
}

export default function EmptyState({ onCreate }: EmptyStateProps) {
  return (
    <div className="text-center py-16">
      <p className="text-gray-500 mb-4">No stores yet</p>
      <button
        onClick={onCreate}
        className="px-4 py-2 text-sm text-white bg-blue-600 rounded-md hover:bg-blue-700"
      >
        Create your first store
      </button>
    </div>
  );
}
