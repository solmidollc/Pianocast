import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

export function IconButton({ icon: Icon, label, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string; children?: ReactNode }) {
  return <button type="button" {...props} aria-label={label} title={label} className={`editor-icon-button ${props.className || ''}`}><Icon size={17} strokeWidth={1.7} aria-hidden="true" />{children}</button>;
}
