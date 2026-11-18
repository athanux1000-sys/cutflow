import React, { useEffect, useRef } from 'react';

export type ContextMenuItem =
  | {
      type?: 'item';
      id: string;
      label: string;
      shortcut?: string;
      icon?: React.ReactNode;
      danger?: boolean;
      disabled?: boolean;
      onSelect: () => void;
    }
  | {
      type: 'divider';
      id: string;
    };

interface ContextMenuProps {
  open: boolean;
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function ContextMenu({ open, x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  if (!open || items.length === 0) return null;

  // Clamp coordinates so menu never clips outside viewport
  const menuW = 216;
  const estH = items.length * 32 + 12;
  const clampedX =
    typeof window !== 'undefined' ? Math.min(x, Math.max(8, window.innerWidth - menuW - 8)) : x;
  const clampedY =
    typeof window !== 'undefined' ? Math.min(y, Math.max(8, window.innerHeight - estH - 8)) : y;

  return (
    <div
      ref={menuRef}
      role="menu"
      data-testid="cutflow-context-menu"
      style={{ left: clampedX, top: clampedY, width: menuW }}
      onContextMenu={(e) => e.preventDefault()}
      className="fixed z-[100] rounded-lg border border-slate-200 dark:border-white/15 bg-white dark:bg-[#161920] shadow-2xl py-1.5 text-xs select-none"
    >
      {items.map((item) => {
        if (item.type === 'divider') {
          return (
            <div
              key={item.id}
              className="my-1 border-t border-slate-200 dark:border-white/8"
            />
          );
        }
        return (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return;
              onClose();
              item.onSelect();
            }}
            className={`w-full px-3 py-1.5 flex items-center justify-between gap-2 text-left transition-colors ${
              item.disabled
                ? 'opacity-40 cursor-not-allowed'
                : item.danger
                  ? 'text-red-500 hover:bg-red-500/10 cursor-pointer'
                  : 'text-slate-800 dark:text-[#F4F5F7] hover:bg-teal-500/12 cursor-pointer'
            }`}
          >
            <span className="flex items-center gap-2 min-w-0">
              {item.icon && <span className="shrink-0 opacity-80">{item.icon}</span>}
              <span className="truncate">{item.label}</span>
            </span>
            {item.shortcut && (
              <span className="text-[10px] font-mono-tabular text-slate-400 dark:text-[#8E95A5] shrink-0">
                {item.shortcut}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
