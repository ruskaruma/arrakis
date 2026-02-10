interface HeaderProps {
  storeCount: number;
}

export default function Header({ storeCount }: HeaderProps) {
  return (
    <header className="bg-gray-900 text-white px-6 py-4 flex items-center justify-between">
      <h1 className="text-xl font-bold tracking-wide">Arrakis</h1>
      <span className="text-sm text-gray-400">
        {storeCount} {storeCount === 1 ? 'store' : 'stores'}
      </span>
    </header>
  );
}
