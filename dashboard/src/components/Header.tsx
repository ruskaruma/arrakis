import type { User } from '../api.ts';
import { logout } from '../api.ts';
import { useTheme } from '../ThemeContext.tsx';

interface HeaderProps {
  storeCount: number;
  user: User;
  onLogout: () => void;
}

export default function Header({ storeCount, user, onLogout }: HeaderProps) {
  const { theme, toggle } = useTheme();

  async function handleLogout() {
    await logout();
    onLogout();
  }

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--border)] bg-[var(--header-bg)] backdrop-blur-xl">
      <div className="max-w-6xl mx-auto px-8 py-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-[var(--text-primary)] tracking-tight">Arrakis</h1>
        </div>
        <div className="flex items-center gap-4">
          <span className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-mono text-[var(--text-secondary)] bg-[var(--bg-input)] border border-[var(--border)] rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse-dot" />
            {storeCount} {storeCount === 1 ? 'store' : 'stores'}
          </span>
          <span className="px-2 py-1 text-[10px] font-mono font-medium text-[var(--text-dim)] bg-[var(--bg-surface)] border border-[var(--border)] rounded">
            k8s
          </span>
          <button
            onClick={toggle}
            className="p-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] transition-colors"
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          >
            {theme === 'dark' ? (
              <svg className="w-4 h-4 text-[#d4a843]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" />
              </svg>
            ) : (
              <svg className="w-4 h-4 text-[var(--text-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z" />
              </svg>
            )}
          </button>
          <div className="flex items-center gap-2 pl-3 border-l border-[var(--border)]">
            {user.avatar ? (
              <img src={user.avatar} alt="" className="w-6 h-6 rounded-full ring-1 ring-[var(--border)]" />
            ) : (
              <div className="w-6 h-6 rounded-full bg-[var(--bg-input)] flex items-center justify-center text-[10px] font-medium text-[var(--text-muted)]">
                {user.username[0]?.toUpperCase()}
              </div>
            )}
            <span className="text-xs text-[var(--text-body)] hidden sm:inline">{user.username}</span>
            <button
              onClick={handleLogout}
              className="text-xs text-[var(--text-muted)] hover:text-red-400/80 transition-colors"
            >
              Logout
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
