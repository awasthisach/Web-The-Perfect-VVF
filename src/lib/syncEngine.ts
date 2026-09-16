/**
 * Google Drive Sync Engine
 * Coordinates bidirectional synchronization between Google Drive REST API and local Dexie.js database.
 * Processes outbound syncQueue items and performs inbound delta synchronization.
 */

import { db, type FileRecord, type SyncQueueItem } from './db';
import { getToken } from './auth';
import {
  fetchDriveFiles,
  updateFileStatus,
  createDriveFile,
  deleteDriveFile,
  type DriveApiFile,
} from './driveApi';

export interface SyncProgress {
  phase: 'idle' | 'auth_check' | 'processing_queue' | 'fetching_drive_files' | 'updating_cache' | 'complete' | 'error';
  currentStep: number;
  totalSteps: number;
  message: string;
  itemsProcessed: number;
  itemsTotal: number;
  error?: string;
}

export interface SyncResult {
  success: boolean;
  filesSyncedCount: number;
  queueItemsProcessedCount: number;
  error?: string;
  isAuthExpired?: boolean;
  timestamp: number;
}

export interface SyncOptions {
  onProgress?: (progress: SyncProgress) => void;
  maxPages?: number;
  pageSize?: number;
  query?: string;
}

/**
 * Transforms a Google Drive API file object into a local Dexie FileRecord.
 */
export function mapDriveApiToFileRecord(file: DriveApiFile): FileRecord {
  const sizeNumber = file.size ? parseInt(file.size, 10) : undefined;

  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    size: isNaN(sizeNumber as number) ? undefined : sizeNumber,
    md5Checksum: file.md5Checksum,
    trashed: Boolean(file.trashed),
    parents: file.parents || [],
    modifiedTime: file.modifiedTime || new Date().toISOString(),
    createdTime: file.createdTime,
    webViewLink: file.webViewLink,
    syncStatus: 'synced',
    lastSyncedAt: Date.now(),
  };
}

/**
 * Executes a full sync cycle:
 * 1. Checks authentication
 * 2. Flushes and pushes outbound pending syncQueue items to Google Drive
 * 3. Fetches remote files from Google Drive API with pagination
 * 4. Upserts remote files into local Dexie.js tables
 * 5. Updates syncState and auditLog
 */
export async function runSync(options: SyncOptions = {}): Promise<SyncResult> {
  const { onProgress, maxPages = 5, pageSize = 50, query = '' } = options;

  const emitProgress = (
    phase: SyncProgress['phase'],
    step: number,
    total: number,
    message: string,
    processed = 0,
    itemsTotal = 0,
    error?: string
  ) => {
    if (onProgress) {
      onProgress({
        phase,
        currentStep: step,
        totalSteps: total,
        message,
        itemsProcessed: processed,
        itemsTotal,
        error,
      });
    }
  };

  const timestamp = Date.now();
  let queueProcessedCount = 0;
  let filesSyncedCount = 0;

  try {
    // 1. Verify Authentication & Connectivity
    emitProgress('auth_check', 1, 4, 'Checking Google authentication...');
    const token = getToken();
    if (!token) {
      throw new Error('Not authenticated with Google Drive. Please sign in first.');
    }

    if (!navigator.onLine) {
      throw new Error('Network is offline. Cannot synchronize with Google Drive.');
    }

    // Set sync state to syncing
    await db.syncState.put({
      key: 'drive_delta_sync',
      status: 'syncing',
      lastSyncedAt: timestamp,
    });

    // 2. Outbound Sync: Process pending items in Dexie syncQueue
    emitProgress('processing_queue', 2, 4, 'Processing outbound sync queue...');
    const pendingQueueItems = await db.syncQueue.where('status').equals('pending').toArray();

    for (let i = 0; i < pendingQueueItems.length; i++) {
      const item = pendingQueueItems[i];
      emitProgress(
        'processing_queue',
        2,
        4,
        `Pushing ${item.action} operation for "${item.payload?.name || item.fileId || item.id}"...`,
        i,
        pendingQueueItems.length
      );

      try {
        await db.syncQueue.update(item.id, { status: 'processing' });

        if (item.action === 'trash' && item.fileId) {
          await updateFileStatus(item.fileId, { trashed: true });
        } else if (item.action === 'untrash' && item.fileId) {
          await updateFileStatus(item.fileId, { trashed: false });
        } else if (item.action === 'delete' && item.fileId) {
          await deleteDriveFile(item.fileId);
        } else if (item.action === 'update' && item.fileId) {
          await updateFileStatus(item.fileId, {
            name: item.payload?.name,
            starred: item.payload?.starred,
          });
        } else if (item.action === 'create') {
          // If offline file was created, upload it to Drive
          const createdFile = await createDriveFile({
            name: item.payload?.name || 'Untitled File',
            mimeType: item.payload?.mimeType || 'application/vnd.google-apps.document',
            parents: item.payload?.parents,
          });

          // Replace temporary offline file ID in Dexie if needed
          if (item.fileId && item.fileId !== createdFile.id) {
            await db.files.delete(item.fileId);
            const mapped = mapDriveApiToFileRecord(createdFile);
            await db.files.put(mapped);
          }
        }

        // Mark queue item completed
        await db.syncQueue.update(item.id, {
          status: 'completed',
        });
        queueProcessedCount++;

        // Update local file record sync status
        if (item.fileId) {
          const file = await db.files.get(item.fileId);
          if (file) {
            await db.files.update(item.fileId, {
              syncStatus: 'synced',
              lastSyncedAt: Date.now(),
            });
          }
        }
      } catch (queueErr: any) {
        console.error(`Failed to process syncQueue item ${item.id}:`, queueErr);
        const nextRetry = (item.retryCount || 0) + 1;
        await db.syncQueue.update(item.id, {
          status: nextRetry >= 3 ? 'failed' : 'pending',
          retryCount: nextRetry,
          error: queueErr.message,
        });
      }
    }

    // 3. Inbound Sync: Fetch remote files from Google Drive API
    emitProgress('fetching_drive_files', 3, 4, 'Fetching files from Google Drive...');
    let pageToken: string | undefined = undefined;
    let pageCount = 0;
    const fetchedFiles: FileRecord[] = [];

    do {
      pageCount++;
      emitProgress(
        'fetching_drive_files',
        3,
        4,
        `Fetching page ${pageCount} of Drive files...`,
        fetchedFiles.length,
        0
      );

      const response = await fetchDriveFiles(pageToken, pageSize, query);
      const remoteFiles = response.files || [];

      for (const remoteFile of remoteFiles) {
        // Check if existing file has local flags we want to preserve (like vault status or local embedding)
        const existing = await db.files.get(remoteFile.id);
        const mapped = mapDriveApiToFileRecord(remoteFile);

        if (existing) {
          mapped.isVaultLocked = existing.isVaultLocked;
          mapped.hasEmbedding = existing.hasEmbedding;
          mapped.embedding = existing.embedding;
        }

        fetchedFiles.push(mapped);
      }

      pageToken = response.nextPageToken;
    } while (pageToken && pageCount < maxPages);

    // 4. Update local Dexie database
    emitProgress('updating_cache', 4, 4, 'Updating local Dexie IndexedDB cache...', 0, fetchedFiles.length);

    if (fetchedFiles.length > 0) {
      // Bulk put files into IndexedDB
      await db.files.bulkPut(fetchedFiles);
      filesSyncedCount = fetchedFiles.length;
    }

    // 5. Finalize Sync State and Audit Log
    const nextSyncToken = `token_${Date.now()}`;
    await db.updateSyncToken(nextSyncToken);

    await db.logAction(
      'DRIVE_SYNC_COMPLETED',
      'SYSTEM',
      undefined,
      `Synchronized ${filesSyncedCount} files from Google Drive and processed ${queueProcessedCount} queued items.`
    );

    emitProgress('complete', 4, 4, `Sync completed. ${filesSyncedCount} files cached locally.`, filesSyncedCount, filesSyncedCount);

    return {
      success: true,
      filesSyncedCount,
      queueItemsProcessedCount: queueProcessedCount,
      timestamp: Date.now(),
    };
  } catch (err: any) {
    const isAuthExpired =
      err.status === 401 ||
      (err.message && (err.message.includes('expired or revoked') || err.message.includes('No Google Drive access token')));

    if (isAuthExpired) {
      console.warn('Drive sync paused: access token expired or revoked. Re-auth required.');
    } else {
      console.error('Drive sync failed:', err);
    }

    await db.syncState.put({
      key: 'drive_delta_sync',
      status: isAuthExpired ? 'idle' : 'error',
      lastSyncedAt: timestamp,
      metadata: { error: err.message, isAuthExpired },
    });

    await db.logAction(
      isAuthExpired ? 'DRIVE_AUTH_EXPIRED' : 'DRIVE_SYNC_FAILED',
      'SYSTEM',
      undefined,
      isAuthExpired ? 'Drive session expired. Re-authentication needed.' : `Sync error: ${err.message}`
    );

    emitProgress(
      'error',
      4,
      4,
      isAuthExpired ? 'Session expired. Please sign in again.' : `Sync failed: ${err.message}`,
      0,
      0,
      err.message
    );

    return {
      success: false,
      isAuthExpired,
      filesSyncedCount,
      queueItemsProcessedCount: queueProcessedCount,
      error: err.message || 'Unknown sync failure',
      timestamp: Date.now(),
    };
  }
}
