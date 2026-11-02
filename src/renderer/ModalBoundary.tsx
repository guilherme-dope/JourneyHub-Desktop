import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export function ModalBoundary({ children, close, busy = false }: { children: ReactNode; close: () => void; busy?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const [opener] = useState(() => document.activeElement as HTMLElement | null);
  const closeRef = useRef(close), busyRef = useRef(busy);
  closeRef.current = close; busyRef.current = busy;
  useLayoutEffect(() => {
    const container = root.current!;
    const controls = () => [...container.querySelectorAll<HTMLElement>('button, input, select, textarea, summary, [tabindex]')]
      .filter(element => element.tabIndex >= 0 && !element.matches(':disabled') && element.getClientRects().length > 0);
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;
    dialog.tabIndex = -1;
    if (!container.contains(document.activeElement)) (controls()[0] ?? dialog).focus();
    function key(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!busyRef.current) closeRef.current(); }
      if (event.key !== 'Tab') return;
      const items = controls(), first = items[0], last = items.at(-1);
      if (!first) { event.preventDefault(); dialog.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || !items.includes(document.activeElement as HTMLElement))) { event.preventDefault(); last!.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !items.includes(document.activeElement as HTMLElement))) { event.preventDefault(); first.focus(); }
    }
    container.addEventListener('keydown', key);
    return () => { container.removeEventListener('keydown', key); if (opener?.isConnected) opener.focus(); };
  }, [opener]);
  return <div ref={root} className="modal-backdrop">{children}</div>;
}
