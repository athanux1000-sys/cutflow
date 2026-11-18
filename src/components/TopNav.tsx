import { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';
import { AppRoute } from '../types/project';
import { BrandMark } from './BrandMark';

interface TopNavProps {
  activeRoute: AppRoute;
  onNavigate: (route: AppRoute) => void;
  primaryAction?: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
  };
}

const NAV_ITEMS: Array<{ route: AppRoute; label: string }> = [
  { route: 'home', label: 'Home' },
  { route: 'video-edit', label: 'Video Edit' },
  { route: 'templates', label: 'Templates' },
  { route: 'outputs', label: 'Final Outputs' },
  { route: 'settings', label: 'Settings' },
];

export function TopNav({ activeRoute, onNavigate, primaryAction }: TopNavProps) {
  const effectiveRoute = activeRoute === 'output-edit' ? 'outputs' : activeRoute;
  const [isOffline, setIsOffline] = useState(
    typeof navigator !== 'undefined' ? !navigator.onLine : false
  );

  useEffect(() => {
    const onOnline = () => setIsOffline(false);
    const onOffline = () => setIsOffline(true);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  return (
    <header className="h-14 shrink-0 border-b border-slate-200 dark:border-white/8 bg-white dark:bg-[#121418] px-5 flex items-center justify-between gap-8">
      {/* Zone 1: Brand mark */}
      <BrandMark onClick={() => onNavigate('home')} />

      {/* Zone 2: Clean single-line navigation links */}
      <nav aria-label="Primary navigation" className="flex items-center gap-6 overflow-x-auto">
        {NAV_ITEMS.map((item) => {
          const isActive = effectiveRoute === item.route;
          return (
            <button
              key={item.route}
              type="button"
              onClick={() => onNavigate(item.route)}
              aria-current={isActive ? 'page' : undefined}
              className={`relative py-4 text-sm font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 ${
                isActive
                  ? 'text-slate-900 dark:text-[#F4F5F7]'
                  : 'text-slate-500 dark:text-[#8E95A5] hover:text-slate-900 dark:hover:text-[#F4F5F7]'
              }`}
            >
              {item.label}
              {isActive && (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 bottom-0 h-0.5 bg-teal-500"
                />
              )}
            </button>
          );
        })}
      </nav>

      {/* Zone 3: Offline state pill (only when offline) + Single primary action */}
      <div className="shrink-0 flex items-center gap-2.5 min-w-[120px] justify-end">
        {isOffline && (
          <span
            title="Running offline from local cache"
            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-amber-500/30 bg-amber-500/10 text-[11px] font-medium text-amber-400"
          >
            <WifiOff className="w-3 h-3" />
            Offline
          </span>
        )}
        {primaryAction && (
          <button
            type="button"
            onClick={primaryAction.onClick}
            disabled={primaryAction.disabled}
            className="px-4 py-1.5 rounded-md text-sm font-medium whitespace-nowrap shrink-0 bg-teal-600 hover:bg-teal-500 disabled:opacity-45 disabled:pointer-events-none text-white transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
          >
            {primaryAction.label}
          </button>
        )}
      </div>
    </header>
  );
}
