import Dexie, { type EntityTable } from 'dexie';

export interface FileRecord {
  id: string;
  name: string;
  mimeType: string;
  size?: number;
  md5Checksum?: string;
  trashed: boolean;
  parents?: string[];
  modifiedTime: string;
  createdTime?: string;
  syncStatus?: 'synced' | 'pending' | 'syncing' | 'error';
  hasEmbedding?: boolean;
  embedding?: number[];
  isVaultLocked?: boolean;
  lastSyncedAt?: number;
}

export interface SyncQueueItem {
  id: string;
  action: 'create' | 'update' | 'delete' | 'trash' | 'untrash' | 'move';
  fileId?: string;
  payload: any;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  retryCount?: number;
  error?: string;
  createdAt: number;
}

export interface AuditLogEntry {
  id: string;
  action: string;
  fileId: string;
  fileName?: string;
  details?: string;
  timestamp: number;
}

export interface SyncStateItem {
  key: string;
  lastSyncToken?: string;
  lastSyncedAt?: number;
  status?: string;
  metadata?: Record<string, any>;
}

export interface VaultItem {
  id: string;
  title: string;
  category: 'note' | 'metadata' | 'tag' | 'credential';
  ciphertext: string;
  iv: string;
  salt: string;
  associatedFileId?: string;
  createdAt: number;
  updatedAt: number;
}

export class DriveOrganizerDatabase extends Dexie {
  files!: EntityTable<FileRecord, 'id'>;
  syncQueue!: EntityTable<SyncQueueItem, 'id'>;
  auditLog!: EntityTable<AuditLogEntry, 'id'>;
  syncState!: EntityTable<SyncStateItem, 'key'>;
  vault!: EntityTable<VaultItem, 'id'>;

  constructor() {
    super('DriveOrganizerDB');

    // Schema definition for Dexie.js
    this.version(1).stores({
      files: 'id, name, mimeType, size, md5Checksum, trashed, *parents, modifiedTime',
      syncQueue: 'id, action, status, createdAt',
      auditLog: 'id, action, fileId, timestamp',
      syncState: 'key, lastSyncToken',
    });

    // Version 2: Privacy Vault table with client-side AES-GCM encryption
    this.version(2).stores({
      files: 'id, name, mimeType, size, md5Checksum, trashed, *parents, modifiedTime',
      syncQueue: 'id, action, status, createdAt',
      auditLog: 'id, action, fileId, timestamp',
      syncState: 'key, lastSyncToken',
      vault: 'id, title, category, associatedFileId, createdAt, updatedAt',
    });
  }

  // Audit log helper
  async logAction(action: string, fileId: string, fileName?: string, details?: string): Promise<string> {
    const id = `audit_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    await this.auditLog.add({
      id,
      action,
      fileId,
      fileName,
      details,
      timestamp: Date.now(),
    });
    return id;
  }

  // Sync queue helper
  async enqueueSync(action: SyncQueueItem['action'], payload: any, fileId?: string): Promise<string> {
    const id = `queue_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    await this.syncQueue.add({
      id,
      action,
      fileId,
      payload,
      status: 'pending',
      retryCount: 0,
      createdAt: Date.now(),
    });
    return id;
  }

  // Update sync token helper
  async updateSyncToken(token: string): Promise<void> {
    await this.syncState.put({
      key: 'drive_delta_sync',
      lastSyncToken: token,
      lastSyncedAt: Date.now(),
      status: 'synced',
    });
  }

  // Get current sync token
  async getSyncToken(): Promise<string | undefined> {
    const record = await this.syncState.get('drive_delta_sync');
    return record?.lastSyncToken;
  }
}

export const db = new DriveOrganizerDatabase();
