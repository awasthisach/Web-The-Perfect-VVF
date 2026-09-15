/**
 * Google Drive REST API Client Wrapper (v3)
 * Features robust Exponential Backoff + Jitter for 429/403 rate limits and 5xx errors.
 */

import { getToken, clearAuth, isDemoToken, refreshTokenSilently } from './auth';

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API_BASE = 'https://www.googleapis.com/upload/drive/v3';

export interface DriveApiFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string; // Google Drive API returns size as string
  md5Checksum?: string;
  trashed?: boolean;
  starred?: boolean;
  parents?: string[];
  modifiedTime: string;
  createdTime?: string;
  iconLink?: string;
  thumbnailLink?: string;
  webViewLink?: string;
  shared?: boolean;
}

export interface DriveFileListResponse {
  files: DriveApiFile[];
  nextPageToken?: string;
  incompleteSearch?: boolean;
}

export interface DriveAboutResponse {
  user: {
    displayName: string;
    emailAddress: string;
    photoLink?: string;
  };
  storageQuota?: {
    limit?: string;
    usage?: string;
    usageInDrive?: string;
    usageInDriveTrash?: string;
  };
}

export class DriveApiError extends Error {
  status: number;
  statusText: string;
  details?: any;
  isAuthError: boolean;
  isRateLimit: boolean;

  constructor(message: string, status: number, statusText: string, details?: any) {
    super(message);
    this.name = 'DriveApiError';
    this.status = status;
    this.statusText = statusText;
    this.details = details;
    this.isAuthError = status === 401;
    this.isRateLimit = status === 429 || (status === 403 && isRateLimitReason(details));
  }
}

/**
 * Checks if a 403 error is due to rate limits or quota rather than permission denial
 */
function isRateLimitReason(details: any): boolean {
  if (!details) return false;
  const reason = details.error?.errors?.[0]?.reason || details.error?.status;
  return (
    reason === 'rateLimitExceeded' ||
    reason === 'userRateLimitExceeded' ||
    reason === 'dailyLimitExceeded' ||
    reason === 'RESOURCE_EXHAUSTED'
  );
}

/**
 * Utility: Sleep for specified milliseconds
 */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Mock files for sandbox demo mode (ensures no failing network requests when using demo tokens)
 */
function getDemoFilesResponse(query = ''): DriveFileListResponse {
  const allDemoFiles: DriveApiFile[] = [
    {
      id: 'demo_doc_101',
      name: 'Product Strategy & Roadmap 2026.gdoc',
      mimeType: 'application/vnd.google-apps.document',
      size: '148200',
      md5Checksum: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
      trashed: false,
      starred: true,
      parents: ['root'],
      modifiedTime: new Date(Date.now() - 3600000 * 2).toISOString(),
      createdTime: new Date(Date.now() - 86400000 * 10).toISOString(),
      webViewLink: 'https://docs.google.com',
    },
    {
      id: 'demo_sheet_102',
      name: 'Financial Projections & Operating Budget Q3.gsheet',
      mimeType: 'application/vnd.google-apps.spreadsheet',
      size: '642000',
      md5Checksum: 'b2c3d4e5f6a10718293a4b5c6d7e8f91',
      trashed: false,
      starred: true,
      parents: ['root'],
      modifiedTime: new Date(Date.now() - 3600000 * 5).toISOString(),
      createdTime: new Date(Date.now() - 86400000 * 14).toISOString(),
      webViewLink: 'https://docs.google.com',
    },
    {
      id: 'demo_pdf_103',
      name: 'Engineering Systems Architecture Spec.pdf',
      mimeType: 'application/pdf',
      size: '1843200',
      md5Checksum: 'c3d4e5f6a1b20718293a4b5c6d7e8f92',
      trashed: false,
      starred: false,
      parents: ['root'],
      modifiedTime: new Date(Date.now() - 3600000 * 24).toISOString(),
      createdTime: new Date(Date.now() - 86400000 * 30).toISOString(),
    },
    {
      id: 'demo_slide_104',
      name: 'Quarterly Executive Pitch Deck.gslides',
      mimeType: 'application/vnd.google-apps.presentation',
      size: '3420000',
      md5Checksum: 'd4e5f6a1b2c30718293a4b5c6d7e8f93',
      trashed: false,
      starred: false,
      parents: ['root'],
      modifiedTime: new Date(Date.now() - 3600000 * 48).toISOString(),
      createdTime: new Date(Date.now() - 86400000 * 40).toISOString(),
      webViewLink: 'https://docs.google.com',
    },
    {
      id: 'demo_doc_105',
      name: 'Weekly Engineering Standup Notes.gdoc',
      mimeType: 'application/vnd.google-apps.document',
      size: '45000',
      md5Checksum: 'e5f6a1b2c3d40718293a4b5c6d7e8f94',
      trashed: false,
      starred: false,
      parents: ['root'],
      modifiedTime: new Date(Date.now() - 3600000 * 72).toISOString(),
      createdTime: new Date(Date.now() - 86400000 * 60).toISOString(),
    },
    {
      id: 'demo_dup_106',
      name: 'Product Strategy & Roadmap 2026 (Copy).gdoc',
      mimeType: 'application/vnd.google-apps.document',
      size: '148200',
      md5Checksum: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
      trashed: false,
      starred: false,
      parents: ['root'],
      modifiedTime: new Date(Date.now() - 3600000 * 8).toISOString(),
      createdTime: new Date(Date.now() - 86400000 * 5).toISOString(),
    },
    {
      id: 'demo_trash_107',
      name: 'Outdated Deprecated Proposal 2025.gdoc',
      mimeType: 'application/vnd.google-apps.document',
      size: '92000',
      md5Checksum: 'f6a1b2c3d4e50718293a4b5c6d7e8f95',
      trashed: true,
      starred: false,
      parents: ['root'],
      modifiedTime: new Date(Date.now() - 86400000 * 90).toISOString(),
      createdTime: new Date(Date.now() - 86400000 * 120).toISOString(),
    },
  ];

  let filtered = allDemoFiles;
  if (query.includes('trashed = false')) {
    filtered = filtered.filter((f) => !f.trashed);
  } else if (query.includes('trashed = true')) {
    filtered = filtered.filter((f) => f.trashed);
  }

  return {
    files: filtered,
    nextPageToken: undefined,
  };
}

/**
 * Robust fetch wrapper with Exponential Backoff + Full Jitter.
 * Handles HTTP 429, rate-limiting 403s, and 5xx transient server errors.
 */
export async function fetchWithBackoff<T>(
  url: string,
  options: RequestInit = {},
  maxRetries = 5,
  initialDelayMs = 1000
): Promise<T> {
  const token = getToken();
  if (!token) {
    throw new DriveApiError('Authentication required. No Google Drive access token found.', 401, 'Unauthorized');
  }

  // Merge headers with Bearer token
  const headers = new Headers(options.headers || {});
  if (!headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }

  let attempt = 0;
  let silentRefreshAttempted = false;

  while (attempt <= maxRetries) {
    try {
      const response = await fetch(url, {
        ...options,
        headers,
      });

      // Successful response
      if (response.ok) {
        // Handle 204 No Content
        if (response.status === 204) {
          return {} as T;
        }
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          return (await response.json()) as T;
        }
        // If blob or raw text
        return (await response.text()) as unknown as T;
      }

      // Parse error payload if possible
      let errorPayload: any = null;
      try {
        errorPayload = await response.json();
      } catch {
        // Response body might be empty or HTML
      }

      const status = response.status;

      // Handle 401 Unauthorized: Expired or revoked token
      if (status === 401) {
        // Attempt silent background refresh via GSI if not tried yet
        if (!silentRefreshAttempted) {
          silentRefreshAttempted = true;
          try {
            const refreshedToken = await refreshTokenSilently();
            if (refreshedToken) {
              headers.set('Authorization', `Bearer ${refreshedToken}`);
              continue; // Retry request immediately with fresh token
            }
          } catch (refreshErr) {
            console.warn('Silent token refresh failed:', refreshErr);
          }
        }

        console.warn('Google Drive API returned 401 Unauthorized. Clearing auth session.');
        clearAuth('expired');
        throw new DriveApiError(
          'Google Drive access token expired or revoked. Please sign in again.',
          401,
          response.statusText,
          errorPayload
        );
      }

      // Check if retryable (429, rate-limit 403, 500, 502, 503, 504)
      const isRetryable =
        status === 429 ||
        (status === 403 && isRateLimitReason(errorPayload)) ||
        status === 500 ||
        status === 502 ||
        status === 503 ||
        status === 504;

      if (!isRetryable || attempt >= maxRetries) {
        const errorMsg =
          errorPayload?.error?.message ||
          `Google Drive API error (${status} ${response.statusText})`;
        throw new DriveApiError(errorMsg, status, response.statusText, errorPayload);
      }

      // Calculate backoff with full jitter
      // Check for Retry-After header
      const retryAfterHeader = response.headers.get('Retry-After');
      let delayMs: number;

      if (retryAfterHeader) {
        const retryAfterSeconds = parseInt(retryAfterHeader, 10);
        delayMs = isNaN(retryAfterSeconds) ? initialDelayMs * Math.pow(2, attempt) : retryAfterSeconds * 1000;
      } else {
        // Standard exponential backoff: delay = base * 2^attempt
        const expDelay = initialDelayMs * Math.pow(2, attempt);
        // Full jitter: random between 0 and expDelay, plus base buffer
        const jitter = Math.random() * 500;
        delayMs = Math.min(expDelay + jitter, 30000); // Cap at 30 seconds
      }

      console.warn(
        `[DriveAPI] Received ${status}. Retrying attempt ${attempt + 1}/${maxRetries} after ${Math.round(delayMs)}ms...`
      );

      await sleep(delayMs);
      attempt++;
    } catch (err: any) {
      // If it's already a DriveApiError, rethrow if not retryable
      if (err instanceof DriveApiError) {
        throw err;
      }

      // Network / Fetch error (offline, DNS failure, aborted)
      if (attempt >= maxRetries) {
        throw new DriveApiError(
          `Network request to Google Drive failed: ${err.message}`,
          0,
          'NetworkError',
          err
        );
      }

      const delayMs = initialDelayMs * Math.pow(2, attempt) + Math.random() * 500;
      console.warn(
        `[DriveAPI] Network fetch failure. Retrying attempt ${attempt + 1}/${maxRetries} after ${Math.round(delayMs)}ms...`
      );
      await sleep(delayMs);
      attempt++;
    }
  }

  throw new DriveApiError('Max retries exceeded for Google Drive API request.', 429, 'TooManyRequests');
}

/**
 * Fetches files from the user's Google Drive with pagination and filtering.
 * @param pageToken Token for the next page of results
 * @param pageSize Number of files to retrieve per page (max 100)
 * @param query Custom Drive search query (e.g. "trashed = false and 'root' in parents")
 */
export async function fetchDriveFiles(
  pageToken?: string,
  pageSize = 50,
  query = 'trashed = false'
): Promise<DriveFileListResponse> {
  const token = getToken();
  if (isDemoToken(token)) {
    await sleep(250);
    return getDemoFilesResponse(query);
  }

  const fields =
    'nextPageToken, incompleteSearch, files(id, name, mimeType, size, md5Checksum, trashed, starred, parents, modifiedTime, createdTime, iconLink, thumbnailLink, webViewLink, shared)';

  const params = new URLSearchParams({
    pageSize: Math.min(pageSize, 100).toString(),
    fields,
    orderBy: 'modifiedTime desc',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  });

  if (pageToken) {
    params.set('pageToken', pageToken);
  }

  if (query) {
    params.set('q', query);
  }

  const url = `${DRIVE_API_BASE}/files?${params.toString()}`;
  return fetchWithBackoff<DriveFileListResponse>(url, { method: 'GET' });
}

/**
 * Updates a file's status in Google Drive (e.g., trash, untrash, rename, star).
 * @param fileId Google Drive file ID
 * @param updates Partial updates object
 */
export async function updateFileStatus(
  fileId: string,
  updates: { trashed?: boolean; name?: string; starred?: boolean }
): Promise<DriveApiFile> {
  const token = getToken();
  if (isDemoToken(token)) {
    await sleep(200);
    return {
      id: fileId,
      name: updates.name || 'Updated File',
      mimeType: 'application/vnd.google-apps.document',
      trashed: updates.trashed ?? false,
      starred: updates.starred ?? false,
      modifiedTime: new Date().toISOString(),
    };
  }

  const url = `${DRIVE_API_BASE}/files/${fileId}?supportsAllDrives=true&fields=id,name,mimeType,trashed,starred,modifiedTime`;

  return fetchWithBackoff<DriveApiFile>(url, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(updates),
  });
}

/**
 * Permanently deletes a file from Google Drive.
 * @param fileId Google Drive file ID
 */
export async function deleteDriveFile(fileId: string): Promise<void> {
  const token = getToken();
  if (isDemoToken(token)) {
    await sleep(150);
    return;
  }

  const url = `${DRIVE_API_BASE}/files/${fileId}?supportsAllDrives=true`;

  await fetchWithBackoff<void>(url, {
    method: 'DELETE',
  });
}

/**
 * Creates a new file or folder in Google Drive.
 * @param metadata File metadata (name, mimeType, parents)
 * @param content Optional file content
 */
export async function createDriveFile(
  metadata: { name: string; mimeType: string; parents?: string[] },
  content?: Blob | string
): Promise<DriveApiFile> {
  const token = getToken();
  if (isDemoToken(token)) {
    await sleep(250);
    return {
      id: `demo_created_${Date.now()}`,
      name: metadata.name,
      mimeType: metadata.mimeType,
      parents: metadata.parents || ['root'],
      trashed: false,
      modifiedTime: new Date().toISOString(),
      createdTime: new Date().toISOString(),
    };
  }

  // If creating a folder or metadata-only file
  if (!content) {
    const url = `${DRIVE_API_BASE}/files?supportsAllDrives=true&fields=id,name,mimeType,size,modifiedTime,createdTime`;
    return fetchWithBackoff<DriveApiFile>(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(metadata),
    });
  }

  // Multipart upload for file with content
  const boundary = '-------314159265358979323846';
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const contentType = metadata.mimeType || 'application/octet-stream';
  const metadataPart =
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata);

  let multipartBody: Blob;
  if (content instanceof Blob) {
    const headerBlob = new Blob([metadataPart + delimiter + `Content-Type: ${contentType}\r\n\r\n`]);
    const footerBlob = new Blob([closeDelimiter]);
    multipartBody = new Blob([headerBlob, content, footerBlob], {
      type: `multipart/related; boundary=${boundary}`,
    });
  } else {
    const dataPart =
      delimiter +
      `Content-Type: ${contentType}\r\n\r\n` +
      content +
      closeDelimiter;
    multipartBody = new Blob([metadataPart + dataPart], {
      type: `multipart/related; boundary=${boundary}`,
    });
  }

  const url = `${UPLOAD_API_BASE}/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,mimeType,size,md5Checksum,modifiedTime`;

  return fetchWithBackoff<DriveApiFile>(url, {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: multipartBody,
  });
}

/**
 * Fetches Google Drive About information (storage quota and user profile).
 */
export async function getDriveAbout(): Promise<DriveAboutResponse> {
  const token = getToken();
  if (isDemoToken(token)) {
    return {
      user: {
        displayName: 'Demo Drive User',
        emailAddress: 'user@example.com',
      },
      storageQuota: {
        limit: '16106127360',
        usage: '4294967296',
        usageInDrive: '3221225472',
        usageInDriveTrash: '1073741824',
      },
    };
  }

  const url = `${DRIVE_API_BASE}/about?fields=user(displayName,emailAddress,photoLink),storageQuota`;
  return fetchWithBackoff<DriveAboutResponse>(url, { method: 'GET' });
}

/**
 * Downloads a file from Google Drive as a binary Blob.
 * Used for local caching, Web Crypto vault encryption, and Transformers.js embeddings.
 */
export async function fetchDriveFileBlob(fileId: string): Promise<Blob> {
  const token = getToken();
  if (!token) {
    throw new DriveApiError('Authentication required to download file.', 401, 'Unauthorized');
  }

  if (isDemoToken(token)) {
    return new Blob([`Sample offline text content for file ${fileId}`], { type: 'text/plain' });
  }

  const url = `${DRIVE_API_BASE}/files/${fileId}?alt=media&supportsAllDrives=true`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new DriveApiError(
      `Failed to download file: ${response.status} ${response.statusText}`,
      response.status,
      response.statusText
    );
  }

  return response.blob();
}
