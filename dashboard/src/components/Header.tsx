import type { User } from '../api.ts';
import { logout } from '../api.ts';

interface HeaderProps {
  storeCount: number;
  user: User;
  onLogout: () => void;
}

export default function Header({ storeCount, user, onLogout }: HeaderProps) {
  async function handleLogout() {
    await logout();
    onLogout();
  }

  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="max-w-6xl mx-auto px-8 py-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-gray-900 tracking-tight">Arrakis</h1>
        </div>
        <div className="flex items-center gap-4">
          <span className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse-dot" />
            {storeCount} {storeCount === 1 ? 'store' : 'stores'}
          </span>
          <span className="px-2 py-1 text-[10px] font-mono font-medium text-gray-400 bg-gray-50 border border-gray-200 rounded">
            k8s
          </span>
          <div className="flex items-center gap-2 pl-3 border-l border-gray-200">
            {user.avatar ? (
              <img src={user.avatar} alt="" className="w-6 h-6 rounded-full" />
            ) : (
              <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-[10px] font-medium text-gray-500">
                {user.username[0]?.toUpperCase()}
              </div>
            )}
            <span className="text-xs text-gray-600 hidden sm:inline">{user.username}</span>
            <button
              onClick={handleLogout}
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              Logout
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
