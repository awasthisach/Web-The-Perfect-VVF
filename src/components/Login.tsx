import React, { useState } from 'react';
import { HardDrive, ShieldCheck, Database, Sparkles, AlertCircle, KeyRound, CheckCircle2, Clock, Info, ExternalLink } from 'lucide-react';
import {
  login,
  storeToken,
  storeUserProfile,
  type UserProfile,
  GOOGLE_CLIENT_ID,
  hasSessionExpired,
  clearSessionExpiredFlag,
  isPopupClosureError,
} from '../lib/auth';

interface LoginProps {
  onLoginSuccess: (token: string, user: UserProfile) => void;
}

export const Login: React.FC<LoginProps> = ({ onLoginSuccess }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDismissedNotice, setIsDismissedNotice] = useState<boolean>(false);
  const [isExpiredNotice, setIsExpiredNotice] = useState<boolean>(() => hasSessionExpired());

  // Native Google Identity Services (GSI) Web OAuth via auth.ts
  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    setIsDismissedNotice(false);
    clearSessionExpiredFlag();
    setIsExpiredNotice(false);

    try {
      const { token, user } = await login();
      onLoginSuccess(token, user);
    } catch (err: any) {
      if (isPopupClosureError(err)) {
        console.info('Google OAuth sign-in dismissed or popup closed.');
        setIsDismissedNotice(true);
      } else {
        console.error('Google Identity Services login failed:', err);
        const msg = err.message || 'Google OAuth sign-in encountered an error.';
        setErrorMessage(msg);
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Fallback demo login for environments to inspect Dexie tables and test offline behavior
  const handleDemoLogin = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    setIsDismissedNotice(false);
    clearSessionExpiredFlag();
    setIsExpiredNotice(false);

    try {
      const demoToken = `demo_token_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
      storeToken(demoToken);
      const demoProfile: UserProfile = {
        id: 'demo-user-123',
        name: 'Demo Drive User',
        email: 'user@example.com',
      };
      storeUserProfile(demoProfile);
      onLoginSuccess(demoToken, demoProfile);
    } catch (err: any) {
      setErrorMessage(err.message || 'Demo login failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto py-8 px-4 sm:px-6 space-y-6">
      <div
        id="login-auth-card"
        className="p-8 bg-neutral-900/90 border border-neutral-800 rounded-3xl shadow-2xl backdrop-blur-md relative overflow-hidden"
      >
        {/* Subtle decorative glow */}
        <div className="absolute top-0 right-0 -mr-20 -mt-20 w-64 h-64 bg-blue-600/10 rounded-full blur-3xl pointer-events-none" />

        <div className="space-y-6">
          {/* Header */}
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium bg-blue-950/70 border border-blue-800/60 text-blue-400">
              <HardDrive className="w-3.5 h-3.5" />
              <span>Phase 2: Google Identity Services & Drive REST API</span>
            </div>

            <h1 className="text-2xl sm:text-3xl font-bold text-neutral-100 tracking-tight">
              Connect to Google Drive
            </h1>

            <p className="text-sm text-neutral-400 leading-relaxed max-w-xl">
              Authorize Google Drive Organizer using native Google Identity Services (GSI). The app syncs files directly into your local Dexie.js database with exponential backoff for offline-ready management.
            </p>
          </div>

          {/* Scope & Privacy Callout */}
          <div className="p-4 rounded-xl bg-neutral-950/70 border border-neutral-800 space-y-2.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-neutral-300">
              <KeyRound className="w-4 h-4 text-amber-400 shrink-0" />
              <span>Configured Client ID & Scope:</span>
            </div>
            <div className="space-y-1.5">
              <div className="font-mono text-xs text-neutral-400 bg-neutral-900 px-3 py-1.5 rounded-lg border border-neutral-800 break-all select-all">
                <span className="text-neutral-500">Client ID: </span>{GOOGLE_CLIENT_ID}
              </div>
              <div className="font-mono text-xs text-blue-400 bg-neutral-900 px-3 py-1.5 rounded-lg border border-neutral-800 break-all select-all">
                <span className="text-neutral-500">Scope: </span>https://www.googleapis.com/auth/drive
              </div>
            </div>
            <p className="text-[11px] text-neutral-500">
              Security notice: Access tokens are held strictly in browser memory and <code className="text-neutral-400">sessionStorage</code> (never in persistent <code className="text-neutral-400">localStorage</code>).
            </p>
          </div>

          {/* Dismissed / Popup Closed Notice */}
          {isDismissedNotice && !errorMessage && (
            <div className="p-3.5 rounded-xl bg-blue-950/60 border border-blue-800/60 text-blue-200 text-xs flex items-start gap-2.5">
              <Info className="w-4 h-4 shrink-0 text-blue-400 mt-0.5" />
              <div className="space-y-1">
                <p className="font-medium text-blue-100">Sign-In Popup Was Closed</p>
                <p className="text-[11px] text-blue-300/80">
                  The Google authentication popup was closed. Click <strong>Sign in with Google</strong> to try again, or click <strong>Test with Demo Token</strong> below to explore the full offline-first Drive organizer immediately.
                </p>
              </div>
            </div>
          )}

          {/* Session Expired Notice */}
          {isExpiredNotice && !errorMessage && (
            <div className="p-3.5 rounded-xl bg-amber-950/60 border border-amber-800/60 text-amber-200 text-xs flex items-start gap-2.5">
              <Clock className="w-4 h-4 shrink-0 text-amber-400 mt-0.5" />
              <div className="space-y-1">
                <p className="font-medium text-amber-100">Session Expired or Re-authorization Needed</p>
                <p className="text-[11px] text-amber-300/80">
                  Your Google Drive access token has expired. Please click <strong>Sign in with Google</strong> below to reconnect your account.
                </p>
              </div>
            </div>
          )}

          {/* Error Banner */}
          {errorMessage && (
            <div className="p-3.5 rounded-xl bg-rose-950/60 border border-rose-800/60 text-rose-300 text-xs flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
              <div className="space-y-1">
                <p className="font-medium">{errorMessage}</p>
                <p className="text-[11px] text-rose-400/80">
                  Note: Google OAuth requires authorized JavaScript origins (the preview domain) in your Google Cloud Console. You can also test with the demo token to verify the offline Dexie store.
                </p>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="pt-2 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            {/* Primary Google Sign-In button using native GSI */}
            <button
              id="btn-google-sign-in"
              type="button"
              disabled={isLoading}
              onClick={handleGoogleSignIn}
              className="flex-1 flex items-center justify-center gap-3 px-6 py-3.5 rounded-xl bg-white hover:bg-neutral-100 active:scale-[0.99] text-neutral-800 font-medium text-sm transition shadow-lg hover:shadow-xl border border-neutral-200 disabled:opacity-50"
            >
              <svg
                className="w-5 h-5 shrink-0"
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
              <span>{isLoading ? 'Authorizing with Google...' : 'Sign in with Google'}</span>
            </button>

            {/* Demo / Sandbox sign-in button */}
            <button
              id="btn-demo-sign-in"
              type="button"
              disabled={isLoading}
              onClick={handleDemoLogin}
              className="flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 active:scale-[0.99] text-neutral-300 hover:text-white text-xs font-medium border border-neutral-700 transition"
              title="Test Dexie database and dashboard with demo session"
            >
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>Test with Demo Token</span>
            </button>
          </div>

          {/* Features Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-4 border-t border-neutral-800/80">
            <div className="p-3 rounded-xl bg-neutral-950/40 border border-neutral-800/60 space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-medium text-neutral-300">
                <Database className="w-3.5 h-3.5 text-blue-400" />
                <span>Dexie IndexedDB</span>
              </div>
              <p className="text-[11px] text-neutral-500">
                Bidirectional sync engine caches files locally with audit trail.
              </p>
            </div>

            <div className="p-3 rounded-xl bg-neutral-950/40 border border-neutral-800/60 space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-medium text-neutral-300">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>Exponential Backoff</span>
              </div>
              <p className="text-[11px] text-neutral-500">
                Full jitter retries prevent 429 rate limits and 5xx transient issues.
              </p>
            </div>

            <div className="p-3 rounded-xl bg-neutral-950/40 border border-neutral-800/60 space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-medium text-neutral-300">
                <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                <span>Semantic Upgrades</span>
              </div>
              <p className="text-[11px] text-neutral-500">
                Ready for Transformers.js embeddings and Web Crypto vault.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
