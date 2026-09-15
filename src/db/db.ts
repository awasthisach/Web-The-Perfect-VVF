import Dexie, { type EntityTable } from 'dexie';
import type { DriveFileItem, VaultSecretItem } from '../types';

export interface SyncMetadataItem {
  key: string;
  value: string | number | boolean | object;
  updatedAt: number;
}

class DriveOrganizerDB extends Dexie {
  files!: EntityTable<DriveFileItem, 'id'>;
  vault!: EntityTable<VaultSecretItem, 'id'>;
  syncMetadata!: EntityTable<SyncMetadataItem, 'key'>;

  constructor() {
    super('GoogleDriveOrganizerDB');

    // Schema definition for offline-first storage and queries
    this.version(1).stores({
      files: 'id, name, mimeType, syncStatus, modifiedTime, starred, trashed, hasEmbedding, lastSyncedAt',
      vault: 'id, fileId, createdAt',
      syncMetadata: 'key, updatedAt',
    });
  }
}

export const db = new DriveOrganizerDB();
