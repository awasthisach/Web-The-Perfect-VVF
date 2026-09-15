import React from 'react';
import { Cloud, CloudOff, RefreshCw, CheckCircle2, Clock, AlertTriangle } from 'lucide-react';
import type { SyncStatus } from '../types';

interface SyncStatusBadgeProps {
  status: SyncStatus;
  pendingCount: number;
  lastSyncedAt: number | null;
  onManualSync?: () => void;
  isSyncing?: boolean;
}

export const SyncStatusBadge: React.FC<SyncStatusBadgeProps> = ({
  status,
  pendingCount,
  lastSyncedAt,
  onManualSync,
  isSyncing = false,
}) => {
  const formatTimeAgo = (timestamp: number | null): string => {
    if (!timestamp) return 'Never';
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'Just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  };

  const getStatusConfig = () => {
    switch (status) {
      case 'syncing':
        return {
          icon: <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-400" />,
          label: 'Syncing...',
          bgColor: 'bg-blue-950/60 border-blue-800/60 text-blue-300',
          dotColor: 'bg-blue-400 animate-pulse',
        };
      case 'synced':
        return {
          icon: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />,
          label: 'All Synced',
          bgColor: 'bg-emerald-950/50 border-emerald-800/60 text-emerald-300',
          dotColor: 'bg-emerald-400',
        };
      case 'pending':
        return {
          icon: <Clock className="w-3.5 h-3.5 text-amber-400" />,
          label: `${pendingCount} Pending`,
          bgColor: 'bg-amber-950/50 border-amber-800/60 text-amber-300',
          dotColor: 'bg-amber-400',
        };
      case 'offline':
        return {
          icon: <CloudOff className="w-3.5 h-3.5 text-neutral-400" />,
          label: 'Offline Mode',
          bgColor: 'bg-neutral-800/70 border-neutral-700 text-neutral-300',
          dotColor: 'bg-neutral-500',
        };
      case 'error':
        return {
          icon: <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />,
          label: 'Sync Error',
          bgColor: 'bg-rose-950/60 border-rose-800/60 text-rose-300',
          dotColor: 'bg-rose-400',
        };
      case 'idle':
      default:
        return {
          icon: <Cloud className="w-3.5 h-3.5 text-neutral-400" />,
          label: 'Ready',
          bgColor: 'bg-neutral-800/60 border-neutral-700/60 text-neutral-300',
          dotColor: 'bg-emerald-500',
        };
    }
  };

  const config = getStatusConfig();

  return (
    <div className="flex items-center gap-2">
      <div
        id="sync-status-indicator"
        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border backdrop-blur-sm transition-all duration-200 ${config.bgColor}`}
      >
        <span className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${config.dotColor}`} />
          {config.icon}
          <span>{config.label}</span>
        </span>

        {lastSyncedAt && (
          <span className="text-[11px] opacity-70 border-l border-white/10 pl-2 hidden sm:inline">
            Updated {formatTimeAgo(lastSyncedAt)}
          </span>
        )}
      </div>

      {onManualSync && (
        <button
          id="btn-manual-sync"
          type="button"
          onClick={onManualSync}
          disabled={isSyncing}
          title="Trigger sync"
          className="p-1.5 rounded-lg border border-neutral-700 bg-neutral-800/80 hover:bg-neutral-700/80 text-neutral-300 hover:text-white transition disabled:opacity-40"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
        </button>
      )}
    </div>
  );
};
