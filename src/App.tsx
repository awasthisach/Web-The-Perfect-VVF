/// src/App.tsx ///
import React, { useState, useEffect, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './lib/db';
import { 
  login, 
  logout, 
  getToken, 
  getUserProfile, 
  subscribeAuthChange, 
  isPopupClosureError,
  type UserProfile 
} from './lib/auth';
import { runSync, type SyncProgress, type SyncResult } from './lib/syncEngine';
import type { SyncStatus } from './types';
import { SyncStatusBadge } from './components/SyncStatusBadge';
import { Login } from './components/Login';
import { Dashboard } from './components/Dashboard';
import { 
  HardDrive, 
  Wifi, 
  WifiOff, 
  Cpu, 
  Info,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Shield,
  Sparkles
} from 'lucide-react';

export default function App() {
  // Authentication State
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => !!getToken());
  const [token, setToken] = useState<string | null>(() => getToken());
  const [user, setUser] = useState<UserProfile | null>(() => getUserProfile());

  // Network & Sync State
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [bannerNotice, setBannerNotice] = useState<{ type: 'info' | 'success' | 'error'; message: string } | null>(null);

  // Subscribe to auth manager state changes
  useEffect(() => {
    const unsubscribe = subscribeAuthChange((state) => {
      setIsAuthenticated(state.isAuthenticated);
      setToken(state.token);
      setUser(state.user);
    });
    return () => unsubscribe();
  }, []);

  // Monitor network online/offline events
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setBannerNotice({ type: 'info', message: 'Network connection restored.' });
      setTimeout(() => setBannerNotice(null), 3500);
    };

    const handleOffline = () => {
      setIsOnline(false);
      setBannerNotice({ type: 'error', message: 'You are offline. File modifications will queue in Dexie IndexedDB.' });
      setTimeout(() => setBannerNotice(null), 4500);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Retrieve last sync timestamp from Dexie syncState table
  useEffect(() => {
    async function loadLastSync() {
      try {
        const stateRecord = await db.syncState.get('drive_delta_sync');
        if (stateRecord?.lastSyncedAt) {
          setLastSyncedAt(stateRecord.lastSyncedAt);
        }
      } catch (e) {
        console.error('Failed to load last sync time:', e);
      }
    }
    loadLastSync();
  }, []);

  // Monitor pending queue count from Dexie IndexedDB
  const syncQueueItems = useLiveQuery(async () => {
    return await db.syncQueue.where('status').equals('pending').toArray();
  }, []);

  const pendingCount = syncQueueItems ? syncQueueItems.length : 0;

  // Determine overall sync status for header indicator
  const currentSyncStatus: SyncStatus = !isOnline
    ? 'offline'
    : isSyncing
      ? 'syncing'
      : pendingCount > 0
        ? 'pending'
        : lastSyncedAt
          ? 'synced'
          : 'idle';

  // Wire up handleLogin: Authenticate using GSI Auth Manager
  const handleLogin = async () => {
    try {
      setBannerNotice({ type: 'info', message: 'Initiating Google Identity Services OAuth...' });
      const result = await login();
      setIsAuthenticated(true);
      setToken(result.token);
      setUser(result.user);
      setBannerNotice({ 
        type: 'success', 
        message: `Welcome, ${result.user.name}. Google Drive access authorized.` 
      });
      setTimeout(() => setBannerNotice(null), 4000);

      // Trigger automatic initial sync upon login
      handleRunSync();
    } catch (err: any) {
      if (isPopupClosureError(err)) {
        console.info('Google OAuth sign-in popup was closed.');
        setBannerNotice({ 
          type: 'info', 
          message: 'Google Sign-In popup was closed.' 
        });
      } else {
        console.error('Login failed:', err);
        setBannerNotice({ 
          type: 'error', 
          message: err.message || 'Google OAuth authorization failed.' 
        });
      }
      setTimeout(() => setBannerNotice(null), 5000);
    }
  };

  // Callback when login succeeds from Login component
  const handleLoginSuccess = (newToken: string, newProfile: UserProfile) => {
    setIsAuthenticated(true);
    setToken(newToken);
    setUser(newProfile);
    setBannerNotice({ 
      type: 'success', 
      message: `Connected as ${newProfile.name}. Synchronizing Google Drive files...` 
    });
    setTimeout(() => setBannerNotice(null), 4000);

    // Initial sync
    handleRunSync();
  };

  // Wire up handleLogout: Revoke and clear session
  const handleLogout = () => {
    logout();
    setIsAuthenticated(false);
    setToken(null);
    setUser(null);
    setSyncProgress(null);
    setBannerNotice({ type: 'info', message: 'Google Drive session disconnected.' });
    setTimeout(() => setBannerNotice(null), 3000);
  };

  // Core Sync Handler: Replaces simulated sync with real runSync from syncEngine.ts
  const handleRunSync = useCallback(async () => {
    if (!isOnline) {
      setBannerNotice({ type: 'error', message: 'Cannot synchronize while in offline mode.' });
      setTimeout(() => setBannerNotice(null), 3000);
      return;
    }

    const currentToken = getToken();
    if (!currentToken) {
      setBannerNotice({ type: 'error', message: 'Authentication required. Please sign in to Google Drive.' });
      setTimeout(() => setBannerNotice(null), 4000);
      return;
    }

    setIsSyncing(true);

    try {
      const result: SyncResult = await runSync({
        onProgress: (progress) => {
          setSyncProgress(progress);
        },
        maxPages: 5,
        pageSize: 50,
      });

      if (result.success) {
        const now = Date.now();
        setLastSyncedAt(now);
        setBannerNotice({
          type: 'success',
          message: `Sync complete! Synced ${result.filesSyncedCount} files from Google Drive and processed ${result.queueItemsProcessedCount} queued item(s).`,
        });
      } else if (result.isAuthExpired) {
        setIsAuthenticated(false);
        setToken(null);
        setUser(null);
        setBannerNotice({
          type: 'error',
          message: 'Your Google Drive session has expired. Please sign in again with Google to reconnect.',
        });
      } else {
        setBannerNotice({
          type: 'error',
          message: `Drive Sync notice: ${result.error || 'Check console logs.'}`,
        });
      }
    } catch (err: any) {
      console.warn('Drive API sync exception:', err);
      const isAuth =
        err.status === 401 ||
        (err.message && (err.message.includes('expired or revoked') || err.message.includes('No Google Drive access token')));

      if (isAuth) {
        setIsAuthenticated(false);
        setToken(null);
        setUser(null);
        setBannerNotice({
          type: 'error',
          message: 'Your Google Drive session has expired. Please sign in again with Google.',
        });
      } else {
        setBannerNotice({
          type: 'error',
          message: `Sync failed: ${err.message || 'Unknown network error'}`,
        });
      }
    } finally {
      setIsSyncing(false);
      setTimeout(() => setBannerNotice(null), 5000);
    }
  }, [isOnline]);

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col font-sans selection:bg-blue-600 selection:text-white">
      {/* Top Navigation Header */}
      <header className="border-b border-neutral-800 bg-neutral-900/80 backdrop-blur sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          {/* Logo & Application Title */}
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400 shadow-inner">
              <HardDrive className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-semibold text-neutral-100 leading-none">
                  Google Drive Organizer
                </h1>
                <span className="text-[10px] bg-purple-950 text-purple-300 border border-purple-800/60 px-2 py-0.5 rounded-full font-mono flex items-center gap-1">
                  <Cpu className="w-2.5 h-2.5" />
                  Transformers.js AI & Vault
                </span>
              </div>
              <p className="text-[11px] text-neutral-400 mt-0.5">
                Google Identity Services • Drive REST API • Web Crypto AES-GCM • Web Worker MiniLM
              </p>
            </div>
          </div>

          {/* Header Controls */}
          <div className="flex items-center gap-3">
            {/* Online / Offline Network Toggle */}
            <button
              id="btn-toggle-network"
              type="button"
              onClick={() => setIsOnline((prev) => !prev)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition ${
                isOnline
                  ? 'bg-neutral-900/80 border-neutral-700 text-neutral-300 hover:border-neutral-600'
                  : 'bg-amber-950/60 border-amber-800/80 text-amber-300'
              }`}
              title="Toggle network connectivity mode"
            >
              {isOnline ? (
                <>
                  <Wifi className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="hidden sm:inline">Online</span>
                </>
              ) : (
                <>
                  <WifiOff className="w-3.5 h-3.5 text-amber-400" />
                  <span>Offline</span>
                </>
              )}
            </button>

            {/* Sync Status Badge */}
            <SyncStatusBadge
              status={currentSyncStatus}
              pendingCount={pendingCount}
              lastSyncedAt={lastSyncedAt}
              onManualSync={handleRunSync}
              isSyncing={isSyncing}
            />
          </div>
        </div>

        {/* Real-time Sync Progress Strip */}
        {isSyncing && syncProgress && (
          <div className="bg-blue-950/60 border-t border-blue-800/40 px-4 py-1.5 flex items-center justify-between text-xs text-blue-300">
            <div className="flex items-center gap-2">
              <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-400" />
              <span>{syncProgress.message}</span>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-blue-400/80 font-mono">
              <span>Step {syncProgress.currentStep} of {syncProgress.totalSteps}</span>
              {syncProgress.itemsProcessed > 0 && (
                <span>({syncProgress.itemsProcessed} items)</span>
              )}
            </div>
          </div>
        )}
      </header>

      {/* Global Notification Banner */}
      {bannerNotice && (
        <div
          className={`border-b text-xs py-2 px-4 flex items-center justify-center gap-2 transition-all ${
            bannerNotice.type === 'error'
              ? 'bg-rose-950/90 border-rose-800/60 text-rose-200'
              : bannerNotice.type === 'success'
                ? 'bg-emerald-950/90 border-emerald-800/60 text-emerald-200'
                : 'bg-blue-950/90 border-blue-800/60 text-blue-200'
          }`}
        >
          {bannerNotice.type === 'error' ? (
            <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
          ) : bannerNotice.type === 'success' ? (
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          ) : (
            <Info className="w-3.5 h-3.5 text-blue-400 shrink-0" />
          )}
          <span>{bannerNotice.message}</span>
        </div>
      )}

      {/* Main View: Conditional Rendering */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-6">
        {!isAuthenticated ? (
          // Logged-out state: Show GSI OAuth Login card
          <div className="py-6">
            <Login onLoginSuccess={handleLoginSuccess} />
          </div>
        ) : (
          // Logged-in state: Show Dashboard (which includes tabs for Files, Semantic AI, Duplicates, Vault, Queue, Audit, State)
          <div className="space-y-6">
            <Dashboard
              user={user}
              token={token}
              onLogout={handleLogout}
              isOnline={isOnline}
              onTriggerSync={handleRunSync}
              isSyncing={isSyncing}
              syncProgress={syncProgress}
            />
          </div>
        )}
      </main>

      {/* Application Footer */}
      <footer className="border-t border-neutral-800/80 bg-neutral-900/60 py-3 px-4 sm:px-6 text-xs text-neutral-500">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              Dexie.js Offline Cache
            </span>
            <span className="flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5 text-indigo-400" />
              PBKDF2-SHA-256 + AES-GCM
            </span>
            <span className="hidden md:flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-purple-400" />
              Transformers.js (all-MiniLM-L6-v2)
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span>OAuth Client ID:</span>
            <code className="text-neutral-400 font-mono text-[11px] bg-neutral-900 px-1.5 py-0.5 rounded border border-neutral-800 truncate max-w-[200px]">
              1058219630435-...
            </code>
          </div>
        </div>
      </footer>
    </div>
  );
}
