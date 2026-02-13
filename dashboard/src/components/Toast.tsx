import { useState, useEffect, useCallback } from 'react';

type ToastType = 'success' | 'error' | 'info';

interface ToastMessage {
  id: number;
  type: ToastType;
  text: string;
}

let addToast: (type: ToastType, text: string) => void = () => {};

export function toast(type: ToastType, text: string) {
  addToast(type, text);
}

const ICON_PATHS: Record<ToastType, string> = {
  success: 'm4.5 12.75 6 6 9-13.5',
  error: 'M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z',
  info: 'm11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z',
};

const TYPE_STYLES: Record<ToastType, string> = {
  success: 'text-emerald-400 bg-emerald-500/10 border border-emerald-500/20',
  error: 'text-red-400 bg-red-500/10 border border-red-500/20',
  info: 'text-[var(--text-body)] bg-[var(--bg-input)] border border-[var(--border-strong)]',
};

let nextId = 0;

export default function ToastContainer() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const add = useCallback((type: ToastType, text: string) => {
    const id = nextId++;
    setToasts(prev => [...prev, { id, type, text }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  }, []);

  useEffect(() => {
    addToast = add;
    return () => { addToast = () => {}; };
  }, [add]);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`flex items-center gap-2.5 px-4 py-3 rounded-lg backdrop-blur-sm shadow-lg shadow-[var(--shadow-color)] animate-slide-in ${TYPE_STYLES[t.type]}`}
        >
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d={ICON_PATHS[t.type]} />
          </svg>
          <span className="text-sm font-medium">{t.text}</span>
        </div>
      ))}
    </div>
  );
}
