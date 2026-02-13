import { useTheme } from '../ThemeContext.tsx';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8080';

const FEATURES = [
  { title: 'One-Click Stores', desc: 'Spin up isolated WooCommerce stores in seconds with a single API call or button click.' },
  { title: 'Namespace Isolation', desc: 'Every store runs in its own Kubernetes namespace with ResourceQuotas and network policies.' },
  { title: 'Store Templates', desc: 'Choose from Fashion, Food, Electronics, Beauty, Sports, Books — pre-configured with sample products.' },
  { title: 'Full Lifecycle', desc: 'Provision, configure, verify, and tear down stores. Automatic cleanup via finalizers.' },
  { title: 'Observability', desc: 'Real-time event streaming, resource usage tracking, and audit logging per store.' },
  { title: 'Multi-Engine', desc: 'WooCommerce today, MedusaJS coming soon. Swap engines without changing your workflow.' },
];

function Particles() {
  return (
    <div className="fixed inset-0 pointer-events-none z-0 dark:opacity-100 opacity-0 transition-opacity">
      {Array.from({ length: 8 }, (_, i) => (
        <div
          key={i}
          className="absolute w-[2px] h-[2px] rounded-full bg-white/10 animate-float"
          style={{ left: `${10 + i * 10}%`, animationDelay: `${i * 2}s` }}
        />
      ))}
    </div>
  );
}

function BgGrid() {
  return (
    <div
      className="fixed inset-0 z-0 animate-grid-move dark:opacity-[0.03] opacity-[0.02]"
      style={{
        backgroundImage: 'linear-gradient(var(--grid-color) 1px, transparent 1px), linear-gradient(90deg, var(--grid-color) 1px, transparent 1px)',
        backgroundSize: '50px 50px',
      }}
    />
  );
}

export default function LoginPage() {
  const { theme, toggle } = useTheme();

  return (
    <div className="min-h-screen bg-[var(--bg-base)] flex flex-col relative overflow-hidden">
      <style>{`
        :root { --grid-color: #cbd5e1; }
        .dark { --grid-color: #333; }
      `}</style>

      <BgGrid />
      <Particles />

      {/* Theme toggle */}
      <button
        onClick={toggle}
        className="fixed top-6 right-6 p-2 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] transition-colors z-50"
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

      {/* Main content */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-16 relative z-10">
        {/* Logo + Title */}
        <div className="text-center animate-fade-in">
          <img src="/logo.png" alt="Arrakis" className="w-28 h-28 mx-auto mb-5 rounded-2xl" />
          <h1 className="text-5xl sm:text-6xl font-semibold tracking-tight text-[var(--text-primary)]">
            Arrakis
          </h1>
          <p className="text-base sm:text-lg text-[var(--text-secondary)] font-normal mt-4 max-w-md mx-auto">
            Kubernetes-native multi-tenant e-commerce platform. Provision isolated stores in seconds.
          </p>

          <div className="mt-10">
            <a
              href={`${API_BASE}/auth/github`}
              className="inline-flex items-center gap-2.5 px-6 py-3 bg-[#d4a843] text-black text-sm font-medium rounded-md hover:bg-[#c8992e] transition-colors"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
              </svg>
              Sign in with GitHub
            </a>
          </div>
        </div>

        {/* Features grid */}
        <div className="max-w-3xl w-full mt-20 animate-fade-in">
          <p className="text-[11px] text-[var(--text-dim)] uppercase tracking-widest mb-6 text-center">
            What you get
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES.map(f => (
              <div key={f.title} className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-4 hover:border-[var(--border-strong)] transition-colors">
                <p className="text-sm font-medium text-[var(--text-primary)] mb-1">{f.title}</p>
                <p className="text-xs text-[var(--text-muted)] leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>

        <p className="text-[11px] text-[var(--text-dim)] uppercase tracking-wide mt-16">
          Multi-tenant e-commerce on Kubernetes
        </p>
      </div>

      {/* Footer */}
      <footer className="relative z-10 border-t border-[var(--border)] py-6 text-center">
        <p className="text-[11px] text-[var(--text-dim)] tracking-wide">
          All rights owned by ruskaruma &copy; 2026
        </p>
      </footer>
    </div>
  );
}
