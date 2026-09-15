/**
 * Types for Google Drive Organizer Web App
 */

export interface GoogleUser {
  id?: string;
  name: string;
  email: string;
  picture?: string;
}

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'pending' | 'offline' | 'error';

export interface DriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  size?: number;
  modifiedTime: string;
  createdTime?: string;
  parents?: string[];
  starred?: boolean;
  trashed?: boolean;
  iconLink?: string;
  thumbnailLink?: string;
  webViewLink?: string;
  syncStatus: 'synced' | 'pending' | 'syncing' | 'error';
  isVaultLocked?: boolean;
  hasEmbedding?: boolean;
  embedding?: number[];
  lastSyncedAt?: number;
  localVersion?: number;
}

export interface SyncState {
  status: SyncStatus;
  progressPercent: number;
  lastSyncedAt: number | null;
  itemsPendingCount: number;
  currentActivity?: string;
  error?: string | null;
}

export interface DriveFolderItem {
  id: string;
  name: string;
  parentId?: string | null;
}

export interface VaultSecretItem {
  id: string;
  fileId: string;
  iv: string; // Base64 encoded initialization vector
  encryptedData: string; // Base64 encoded ciphertext
  createdAt: number;
}
