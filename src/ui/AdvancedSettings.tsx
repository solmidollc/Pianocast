import type { ReactNode } from 'react';

export function AdvancedSettings({ children, label = 'Advanced' }: { children: ReactNode; label?: string }) {
  return (
    <details className="mt-2 border-t border-white/5">
      <summary className="px-4 py-3 text-xs text-ink-300 cursor-pointer select-none hover:text-ink-50 focus-visible:outline focus-visible:outline-accent">
        {label}
      </summary>
      <div className="pb-2">{children}</div>
    </details>
  );
}
