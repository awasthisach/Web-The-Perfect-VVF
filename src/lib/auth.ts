/**
 * Google Identity Services (GSI) Web OAuth Manager
 * Uses window.google.accounts.oauth2.initTokenClient to request Google Drive API scopes.
 * Stores token in memory and sessionStorage (never in localStorage).
 */

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  picture?: string;
}

export interface AuthState {
  isAuthenticated: boolean;
  token: string | null;
  user: UserProfile | null;
}

// Global TypeScript declarations for Google Identity Services
declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (response: GoogleTokenResponse) => void;
            error_callback?: (error: any) => void;
            prompt?: string;
          }) => GoogleTokenClient;
          revoke?: (token: string, done?: () => void) => void;
        };
      };
    };
  }
}

export interface GoogleTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
  error_uri?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
}

export interface GoogleTokenClient {
  requestAccessToken: (overrideConfig?: { prompt?: string }) => void;
}

// Exact Google Cloud OAuth 2.0 Web Client ID provided by user
export const EXACT_GOOGLE_CLIENT_ID =
  '1058219630435-fu0ghr242e9vkb7u9s25706mnrnhpd8c.apps.googleusercontent.com';

// Validates whether an env var is a legitimate Google Web Client ID (ends with .apps.googleusercontent.com and not a client secret)
const rawEnvClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim();
const isValidGoogleClientId = (id?: string): boolean => {
  if (!id) return false;
  return id.endsWith('.apps.googleusercontent.com') && !id.startsWith('GOCSPX-');
};

export const GOOGLE_CLIENT_ID = isValidGoogleClientId(rawEnvClientId)
  ? rawEnvClientId!
  : EXACT_GOOGLE_CLIENT_ID;

// Required Google Drive Full Access Scope
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';

const STORAGE_TOKEN_KEY = 'drive_access_token';
const STORAGE_USER_KEY = 'drive_user_profile';
const STORAGE_EXPIRY_KEY = 'drive_token_expires_at';
const STORAGE_EXPIRED_FLAG = 'drive_session_expired';

// In-memory token cache for ultra-secure runtime usage
let inMemoryToken: string | null = null;
let inMemoryUser: UserProfile | null = null;
let inMemoryExpiresAt: number | null = null;

// Listeners for reactive auth updates
type AuthChangeListener = (state: AuthState) => void;
const listeners: Set<AuthChangeListener> = new Set();

const notifyListeners = () => {
  const state: AuthState = {
    isAuthenticated: !!getToken(),
    token: getToken(),
    user: getUserProfile(),
  };
  listeners.forEach((listener) => {
    try {
      listener(state);
    } catch (e) {
      console.error('Auth listener error:', e);
    }
  });
};

/**
 * Checks if a token is a simulated demo token.
 */
export const isDemoToken = (token: string | null): boolean => {
  if (!token) return false;
  return token.startsWith('demo_') || token.includes('demo_token');
};

/**
 * Checks if the current token has expired or is nearing expiration (within 30 seconds).
 */
export const isTokenExpired = (): boolean => {
  const token = getToken();
  if (!token) return true;
  if (isDemoToken(token)) return false;

  if (!inMemoryExpiresAt) {
    const stored = sessionStorage.getItem(STORAGE_EXPIRY_KEY);
    if (stored) {
      inMemoryExpiresAt = parseInt(stored, 10);
    }
  }

  if (inMemoryExpiresAt && Date.now() >= inMemoryExpiresAt - 30000) {
    return true;
  }
  return false;
};

/**
 * Returns the currently active access token.
 * Checks in-memory cache first, then sessionStorage.
 * Never reads from localStorage.
 */
export const getToken = (): string | null => {
  if (inMemoryToken) return inMemoryToken;
  const stored = sessionStorage.getItem(STORAGE_TOKEN_KEY);
  if (stored) {
    inMemoryToken = stored;
    return stored;
  }
  return null;
};

/**
 * Stores the access token in memory and sessionStorage.
 */
export const storeToken = (token: string, expiresInSeconds = 3600): void => {
  inMemoryToken = token;
  sessionStorage.setItem(STORAGE_TOKEN_KEY, token);

  const expiresAt = Date.now() + expiresInSeconds * 1000;
  inMemoryExpiresAt = expiresAt;
  sessionStorage.setItem(STORAGE_EXPIRY_KEY, String(expiresAt));
  sessionStorage.removeItem(STORAGE_EXPIRED_FLAG);

  notifyListeners();
};

/**
 * Clears all authentication tokens and cached user data.
 */
export const clearAuth = (reason: 'expired' | 'user' = 'user'): void => {
  const currentToken = inMemoryToken || sessionStorage.getItem(STORAGE_TOKEN_KEY);

  // Attempt token revocation if GSI is available and logout was user-initiated
  if (reason === 'user' && currentToken && window.google?.accounts?.oauth2?.revoke) {
    try {
      window.google.accounts.oauth2.revoke(currentToken, () => {
        console.log('Google OAuth token revoked successfully.');
      });
    } catch (err) {
      console.warn('Could not revoke Google OAuth token:', err);
    }
  }

  inMemoryToken = null;
  inMemoryUser = null;
  inMemoryExpiresAt = null;
  sessionStorage.removeItem(STORAGE_TOKEN_KEY);
  sessionStorage.removeItem(STORAGE_USER_KEY);
  sessionStorage.removeItem(STORAGE_EXPIRY_KEY);

  if (reason === 'expired') {
    sessionStorage.setItem(STORAGE_EXPIRED_FLAG, 'true');
  } else {
    sessionStorage.removeItem(STORAGE_EXPIRED_FLAG);
  }

  notifyListeners();
};

/**
 * Checks if the last session ended due to token expiry/revocation.
 */
export const hasSessionExpired = (): boolean => {
  return sessionStorage.getItem(STORAGE_EXPIRED_FLAG) === 'true';
};

/**
 * Clears the session expired notification flag.
 */
export const clearSessionExpiredFlag = (): void => {
  sessionStorage.removeItem(STORAGE_EXPIRED_FLAG);
};

/**
 * Attempts to silently refresh the access token via Google Identity Services without prompting.
 */
export const refreshTokenSilently = async (): Promise<string | null> => {
  if (typeof window === 'undefined' || !window.google?.accounts?.oauth2) {
    return null;
  }

  const currentToken = getToken();
  if (isDemoToken(currentToken)) {
    return currentToken;
  }

  return new Promise((resolve) => {
    try {
      const client = window.google!.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: DRIVE_SCOPE,
        callback: (response: GoogleTokenResponse) => {
          if (response.access_token) {
            storeToken(response.access_token, response.expires_in || 3600);
            resolve(response.access_token);
          } else {
            resolve(null);
          }
        },
        error_callback: () => {
          resolve(null);
        },
      });

      // Attempt silent background token request (no popup prompt)
      client.requestAccessToken({ prompt: '' });
    } catch {
      resolve(null);
    }
  });
};

/**
 * Retrieves the cached user profile.
 */
export const getUserProfile = (): UserProfile | null => {
  if (inMemoryUser) return inMemoryUser;
  const data = sessionStorage.getItem(STORAGE_USER_KEY);
  if (!data) return null;
  try {
    const parsed = JSON.parse(data) as UserProfile;
    inMemoryUser = parsed;
    return parsed;
  } catch {
    return null;
  }
};

/**
 * Stores the user profile in memory and sessionStorage.
 */
export const storeUserProfile = (user: UserProfile): void => {
  inMemoryUser = user;
  sessionStorage.setItem(STORAGE_USER_KEY, JSON.stringify(user));
  notifyListeners();
};

/**
 * Fetches user profile from Google's OpenID / UserInfo REST API.
 */
export const fetchUserProfile = async (token: string): Promise<UserProfile> => {
  // First try Google Drive v3 about endpoint (guaranteed to work with DRIVE_SCOPE)
  try {
    const driveAboutRes = await fetch(
      'https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress,photoLink)',
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      }
    );

    if (driveAboutRes.ok) {
      const data = await driveAboutRes.json();
      if (data.user) {
        const profile: UserProfile = {
          id: data.user.emailAddress || 'google-drive-user',
          name: data.user.displayName || 'Google Drive User',
          email: data.user.emailAddress || 'authorized.user@drive.google.com',
          picture: data.user.photoLink,
        };
        storeUserProfile(profile);
        return profile;
      }
    }
  } catch (driveErr) {
    console.warn('Drive about endpoint unavailable, attempting userinfo fallback:', driveErr);
  }

  // Secondary fallback: userinfo endpoint
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (res.ok) {
      const data = await res.json();
      const profile: UserProfile = {
        id: data.sub || data.id || 'google-user',
        name: data.name || data.email || 'Google Drive User',
        email: data.email || 'user@drive.google.com',
        picture: data.picture,
      };
      storeUserProfile(profile);
      return profile;
    }
  } catch (userinfoErr) {
    console.warn('Could not fetch userinfo endpoint:', userinfoErr);
  }

  const fallbackProfile: UserProfile = {
    id: 'google-user',
    name: 'Google Drive User',
    email: 'authorized.user@gmail.com',
  };
  storeUserProfile(fallbackProfile);
  return fallbackProfile;
};

/**
 * Waits for the Google Identity Services client script to be loaded on window.
 */
export const waitForGsiScript = (timeoutMs = 10000): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2?.initTokenClient) {
      resolve();
      return;
    }

    const startTime = Date.now();
    const interval = setInterval(() => {
      if (window.google?.accounts?.oauth2?.initTokenClient) {
        clearInterval(interval);
        resolve();
      } else if (Date.now() - startTime > timeoutMs) {
        clearInterval(interval);
        reject(
          new Error(
            'Google Identity Services (GSI) script failed to load within timeout. Please check your internet connection or ad-blocker settings.'
          )
        );
      }
    }, 100);
  });
};

/**
 * Helper to identify if an error is due to the user closing or dismissing the OAuth popup.
 */
export const isPopupClosureError = (error: any): boolean => {
  if (!error) return false;
  if (error.isCancelled || error.type === 'popup_closed') return true;
  const msg = typeof error === 'string' ? error : error.message || '';
  const lower = msg.toLowerCase();
  return (
    lower.includes('popup window closed') ||
    lower.includes('popup_closed') ||
    lower.includes('closed by user') ||
    lower.includes('popup failed to open') ||
    lower.includes('user closed the popup')
  );
};

// Singleton GSI Token Client reference
let gsiTokenClient: GoogleTokenClient | null = null;

/**
 * Initializes or retrieves the GSI Token Client with the specified Client ID and Drive scope.
 */
export const initTokenClient = async (
  onSuccess: (token: string) => void,
  onError: (error: any) => void
): Promise<GoogleTokenClient> => {
  await waitForGsiScript();

  if (!window.google?.accounts?.oauth2) {
    throw new Error('Google Identity Services library is not accessible on window.');
  }

  const client = window.google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: DRIVE_SCOPE,
    callback: (response: GoogleTokenResponse) => {
      if (response.error) {
        console.warn('Google OAuth error response:', response);
        const err = new Error(response.error_description || response.error);
        if (response.error === 'access_denied') {
          (err as any).isCancelled = true;
        }
        onError(err);
        return;
      }

      if (response.access_token) {
        storeToken(response.access_token, response.expires_in || 3600);
        onSuccess(response.access_token);
      } else {
        onError(new Error('No access_token found in Google OAuth response'));
      }
    },
    error_callback: (error: any) => {
      if (isPopupClosureError(error)) {
        console.info('Google OAuth sign-in popup closed by user or browser.');
        const cancelErr = new Error('Popup window closed');
        (cancelErr as any).isCancelled = true;
        (cancelErr as any).type = 'popup_closed';
        onError(cancelErr);
        return;
      }

      console.error('Google OAuth initialization error:', error);
      onError(error);
    },
  });

  gsiTokenClient = client;
  return client;
};

/**
 * Prompts the user with the Google Identity Services OAuth popup to grant Drive permissions.
 * Resolves with the access token and user profile.
 */
export const login = async (): Promise<{ token: string; user: UserProfile }> => {
  return new Promise(async (resolve, reject) => {
    try {
      await waitForGsiScript();

      const client = await initTokenClient(
        async (token: string) => {
          try {
            const user = await fetchUserProfile(token);
            resolve({ token, user });
          } catch (profileErr) {
            console.warn('Failed to fetch user profile, using fallback:', profileErr);
            // Even if profile fetch fails, token is valid
            const fallbackUser = getUserProfile() || {
              id: 'google-user',
              name: 'Google Drive User',
              email: 'authorized.user@gmail.com',
            };
            resolve({ token, user: fallbackUser });
          }
        },
        (err) => {
          reject(err);
        }
      );

      // Trigger GSI OAuth popup
      client.requestAccessToken({ prompt: 'consent' });
    } catch (err) {
      reject(err);
    }
  });
};

/**
 * Logs out the user and clears all credentials.
 */
export const logout = (): void => {
  clearAuth();
};

/**
 * Subscribes a React component or service to authentication state changes.
 */
export const subscribeAuthChange = (listener: AuthChangeListener): (() => void) => {
  listeners.add(listener);
  // Emit current state immediately
  listener({
    isAuthenticated: !!getToken(),
    token: getToken(),
    user: getUserProfile(),
  });
  return () => {
    listeners.delete(listener);
  };
};

/**
 * Checks if the user currently has an authenticated session.
 */
export const isAuthenticated = (): boolean => {
  return !!getToken();
};
