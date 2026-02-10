interface HeaderProps {
  storeCount: number;
}

export default function Header({ storeCount }: HeaderProps) {
  return (
    <header className="bg-gradient-to-r from-slate-900 to-slate-800 shadow-lg">
      <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <svg className="w-6 h-6 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 21v-7.5a.75.75 0 0 1 .75-.75h3a.75.75 0 0 1 .75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349M3.75 21V9.349m0 0a3.001 3.001 0 0 0 3.75-.615A2.993 2.993 0 0 0 9.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 0 0 2.25 1.016c.896 0 1.7-.393 2.25-1.015a3.001 3.001 0 0 0 3.75.614m-16.5 0a3.004 3.004 0 0 1-.621-4.72l1.189-1.19A1.5 1.5 0 0 1 5.378 3h13.243a1.5 1.5 0 0 1 1.06.44l1.19 1.189a3 3 0 0 1-.621 4.72M6.75 18h3.75a.75.75 0 0 0 .75-.75V13.5a.75.75 0 0 0-.75-.75H6.75a.75.75 0 0 0-.75.75v3.75c0 .414.336.75.75.75Z" />
          </svg>
          <h1 className="text-xl font-bold text-white tracking-wide">Arrakis</h1>
        </div>
        <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-slate-300 bg-white/10 rounded-full">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
          {storeCount} {storeCount === 1 ? 'store' : 'stores'}
        </span>
      </div>
    </header>
  );
}
