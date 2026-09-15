import React from 'react';
import { ShieldCheck, HardDrive, Cpu, KeyRound, Sparkles, Check } from 'lucide-react';

interface LoginPlaceholderProps {
  isAuthenticated: boolean;
  onLoginClick: () => void;
  onLogoutClick: () => void;
  userEmail?: string;
  userName?: string;
}

export const LoginPlaceholder: React.FC<LoginPlaceholderProps> = ({
  isAuthenticated,
  onLoginClick,
  onLogoutClick,
  userEmail = 'user@example.com',
  userName = 'Demo User',
}) => {
  if (isAuthenticated) {
    return (
      <div
        id="authenticated-user-card"
        className="flex items-center justify-between p-4 bg-neutral-800/80 border border-neutral-700/80 rounded-xl"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-blue-600/20 border border-blue-500/40 flex items-center justify-center text-blue-400 font-semibold">
            {userName.charAt(0)}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm text-neutral-100">{userName}</span>
              <span className="inline-flex items-center gap-1 text-[11px] bg-emerald-950/80 border border-emerald-800/60 text-emerald-400 px-2 py-0.5 rounded-full">
                <Check className="w-3 h-3" /> Drive Connected
              </span>
            </div>
            <p className="text-xs text-neutral-400">{userEmail}</p>
          </div>
        </div>

        <button
          id="btn-logout"
          type="button"
          onClick={onLogoutClick}
          className="text-xs font-medium px-3 py-1.5 rounded-lg border border-neutral-700 hover:bg-neutral-700/60 text-neutral-300 transition"
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <div
      id="login-placeholder-card"
      className="p-6 bg-neutral-800/50 border border-neutral-700/80 rounded-2xl shadow-xl backdrop-blur-sm"
    >
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-2 max-w-xl">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-950/60 border border-blue-800/50 text-blue-400">
            <HardDrive className="w-3.5 h-3.5" /> Google Drive API Integration
          </div>
          <h2 className="text-xl font-semibold text-neutral-100 tracking-tight">
            Connect Your Google Drive
          </h2>
          <p className="text-sm text-neutral-400 leading-relaxed">
            Link your Google Drive account using Google Identity Services (GSI) Web OAuth. All file metadata
            is stored locally in Dexie (IndexedDB) with instant offline accessibility and background synchronization.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
            <div className="flex items-center gap-2 text-xs text-neutral-300 bg-neutral-900/60 border border-neutral-800 p-2 rounded-lg">
              <KeyRound className="w-4 h-4 text-amber-400 shrink-0" />
              <span>Drive REST API Scope</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-neutral-300 bg-neutral-900/60 border border-neutral-800 p-2 rounded-lg">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Web Crypto Privacy Vault</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-neutral-300 bg-neutral-900/60 border border-neutral-800 p-2 rounded-lg">
              <Sparkles className="w-4 h-4 text-purple-400 shrink-0" />
              <span>Local Transformers.js AI</span>
            </div>
          </div>
        </div>

        <div className="flex flex-col items-start md:items-end justify-center shrink-0 space-y-3">
          {/* Official Google Identity Services styled button */}
          <button
            id="gsi-sign-in-btn"
            type="button"
            onClick={onLoginClick}
            className="group relative flex items-center justify-center gap-3 px-5 py-3 rounded-xl bg-white hover:bg-neutral-100 text-neutral-800 font-medium text-sm transition-all shadow-md hover:shadow-lg active:scale-[0.99] border border-neutral-200"
          >
            <svg
              className="w-5 h-5"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                fill="#EA4335"
              />
            </svg>
            <span>Sign in with Google</span>
          </button>

          <span className="text-[11px] text-neutral-500 text-center md:text-right">
            Scope: <code className="text-neutral-400 bg-neutral-900 px-1 py-0.5 rounded">https://www.googleapis.com/auth/drive</code>
          </span>
        </div>
      </div>
    </div>
  );
};
