import { useState } from 'react';
import { createStore } from '../api.ts';

interface CreateStoreModalProps {
  onClose: () => void;
  onCreated: () => void;
}

export default function CreateStoreModal({ onClose, onCreated }: CreateStoreModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setLoading(true);
    setError(null);
    try {
      await createStore('woocommerce');
      onCreated();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-semibold mb-4">Create Store</h2>

        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">Engine</label>
          <div className="space-y-2">
            <div className="flex items-center px-3 py-2 border-2 border-blue-500 rounded-md bg-blue-50 cursor-default">
              <div className="w-4 h-4 border-2 border-blue-500 rounded-full mr-3 flex items-center justify-center">
                <div className="w-2 h-2 bg-blue-500 rounded-full" />
              </div>
              <span className="text-sm font-medium text-gray-900">WooCommerce</span>
            </div>
            <div className="flex items-center px-3 py-2 border border-gray-200 rounded-md bg-gray-50 cursor-not-allowed opacity-50">
              <div className="w-4 h-4 border-2 border-gray-300 rounded-full mr-3" />
              <span className="text-sm text-gray-400">MedusaJS</span>
              <span className="ml-auto text-xs text-gray-400 italic">Coming Soon</span>
            </div>
          </div>
        </div>

        {error && (
          <p className="text-sm text-red-600 mb-4">{error}</p>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={loading}
            className="px-4 py-2 text-sm text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
