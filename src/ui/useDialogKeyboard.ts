import { useEffect, useRef } from 'react';

/** Contain keyboard focus in the active modal and return it to its opener. */
export function useDialogKeyboard(open: boolean, label: string, onClose: () => void) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const dialog = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).find(el => el.getAttribute('aria-label') === label);
    if (!dialog) return;
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]')).filter(el => el.getClientRects().length && !el.closest('[hidden], [inert]'));
    dialog.tabIndex = -1;
    if (!dialog.contains(document.activeElement)) (focusable()[0] ?? dialog).focus();
    const keydown = (event: KeyboardEvent) => {
      const modals = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')).filter(el => el.getClientRects().length);
      if (modals[modals.length - 1] !== dialog) return;
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopImmediatePropagation(); close.current();
      } else if (event.key === 'Tab') {
        const items = focusable(), first = items[0], last = items[items.length - 1];
        if (!first) { event.preventDefault(); dialog.focus(); }
        else if (!dialog.contains(document.activeElement) || (event.shiftKey && (document.activeElement === first || document.activeElement === dialog))) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', keydown, true);
    return () => { document.removeEventListener('keydown', keydown, true); if (opener?.isConnected) opener.focus(); };
  }, [open, label]);
}
