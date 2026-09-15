/// src/components/Dashboard.tsx ///
import React, { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type FileRecord, type SyncQueueItem } from '../lib/db';
import type { UserProfile } from '../lib/auth';
import type { SyncProgress } from '../lib/syncEngine';
import { PrivacyVault } from './PrivacyVault';
import { SemanticSearch } from './SemanticSearch';
import { DuplicateFinder } from './DuplicateFinder';
import { 
  Folder, 
  FileText, 
  Plus, 
  Trash2, 
  RotateCcw, 
  RefreshCw, 
  Layers, 
  Clock, 
  Search, 
  Database, 
  Activity, 
  FileSpreadsheet, 
  FileCode, 
  CheckCircle2, 
  CloudDownload,
  AlertCircle,
  ExternalLink,
  Lock,
  Shield,
  Sparkles,
  Copy
} from 'lucide-react';

interface DashboardProps {
  user: UserProfile | null;
  token: string | null;
  onLogout: () => void;
  isOnline: boolean;
  onTriggerSync?: () => Promise<void>;
  isSyncing?: boolean;
  syncProgress?: SyncProgress | null;
}

export const Dashboard: React.FC<DashboardProps> = ({
  user,
  token,
  onLogout,
  isOnline,
  onTriggerSync,
  isSyncing = false,
  syncProgress,
}) => {
  const [activeTab, setActiveTab] = useState<'files' | 'semantic' | 'duplicates' | 'vault' | 'queue' | 'audit' | 'state'>('files');
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [filterTrashed, setFilterTrashed] = useState<'active' | 'trashed' | 'all'>('active');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Add File Form state
  const [fileName, setFileName] = useState('');
  const [fileMimeType, setFileMimeType] = useState('application/vnd.google-apps.document');
  const [fileSizeKb, setFileSizeKb] = useState('256');

  // Dexie live queries for all 4 tables
  const files = useLiveQuery(async () => {
    return await db.files.toArray();
  }, []);

  const syncQueue = useLiveQuery(async () => {
    return await db.syncQueue.orderBy('createdAt').reverse().toArray();
  }, []);

  const auditLogs = useLiveQuery(async () => {
    return await db.auditLog.orderBy('timestamp').reverse().toArray();
  }, []);

  const syncState = useLiveQuery(async () => {
    return await db.syncState.get('drive_delta_sync');
  }, []);

  // Filter files
  const filteredFiles = (files || []).filter((f) => {
    const matchesSearch =
      f.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (f.md5Checksum && f.md5Checksum.toLowerCase().includes(searchQuery.toLowerCase()));

    if (!matchesSearch) return false;

    if (filterTrashed === 'active') return !f.trashed;
    if (filterTrashed === 'trashed') return f.trashed;
    return true;
  });

  const pendingQueueCount = (syncQueue || []).filter((q) => q.status === 'pending').length;

  const showNotice = (msg: string) => {
    setStatusMessage(msg);
    setTimeout(() => setStatusMessage(null), 3500);
  };

  // Handler: Add new file to Dexie, enqueue sync, log audit
  const handleCreateFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fileName.trim()) return;

    const fileId = `drive_f_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const sizeBytes = parseInt(fileSizeKb, 10) * 1024 || 1024;
    const md5Checksum = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');

    const newRecord: FileRecord = {
      id: fileId,
      name: fileName.trim(),
      mimeType: fileMimeType,
      size: sizeBytes,
      md5Checksum,
      trashed: false,
      parents: ['root'],
      modifiedTime: new Date().toISOString(),
      createdTime: new Date().toISOString(),
      syncStatus: 'pending',
    };

    // 1. Add to files table
    await db.files.add(newRecord);

    // 2. Add to syncQueue table
    await db.enqueueSync('create', newRecord, fileId);

    // 3. Log to auditLog table
    await db.logAction('CREATE_FILE', fileId, newRecord.name, `Created local file (${fileMimeType})`);

    setFileName('');
    setShowAddModal(false);
    showNotice(`Added "${newRecord.name}" to Dexie cache & queued for sync.`);
  };

  // Handler: Toggle trash status
  const handleToggleTrash = async (file: FileRecord) => {
    const nextTrashed = !file.trashed;
    await db.files.update(file.id, {
      trashed: nextTrashed,
      modifiedTime: new Date().toISOString(),
      syncStatus: 'pending',
    });

    const action = nextTrashed ? 'trash' : 'untrash';
    await db.enqueueSync(action, { id: file.id, trashed: nextTrashed }, file.id);
    await db.logAction(
      nextTrashed ? 'TRASH_FILE' : 'RESTORE_FILE',
      file.id,
      file.name,
      nextTrashed ? 'Moved file to trash' : 'Restored file from trash'
    );

    showNotice(nextTrashed ? `Moved "${file.name}" to trash.` : `Restored "${file.name}".`);
  };

  // Handler: Delete permanently
  const handleDeletePermanent = async (file: FileRecord) => {
    await db.files.delete(file.id);
    await db.enqueueSync('delete', { id: file.id }, file.id);
    await db.logAction('DELETE_FILE', file.id, file.name, 'Permanently deleted file from local DB');
    showNotice(`Deleted "${file.name}" permanently.`);
  };

  // Handler: Clear completed queue items
  const handleClearCompletedQueue = async () => {
    const completed = await db.syncQueue.where('status').equals('completed').toArray();
    for (const item of completed) {
      await db.syncQueue.delete(item.id);
    }
    showNotice(`Cleared ${completed.length} completed queue records.`);
  };

  // Handler: Clear audit log
  const handleClearAuditLog = async () => {
    await db.auditLog.clear();
    showNotice('Audit log cleared.');
  };

  // Handler: Seed Sample Google Drive Data for demo testing
  const handleSeedDriveData = async () => {
    const sampleFiles: FileRecord[] = [
      {
        id: '1aB2c3D4e5_doc',
        name: 'Quarterly OKRs & Roadmap 2026.gdoc',
        mimeType: 'application/vnd.google-apps.document',
        size: 145000,
        md5Checksum: 'e4d909c290d0fb1ca068ffaddf22cbd0',
        trashed: false,
        parents: ['root'],
        modifiedTime: new Date(Date.now() - 3600000).toISOString(),
        createdTime: new Date(Date.now() - 86400000).toISOString(),
        syncStatus: 'synced',
        lastSyncedAt: Date.now() - 3600000,
      },
      {
        id: '2bC3d4E5f6_sheet',
        name: 'Company Budget & Revenue Projections.gsheet',
        mimeType: 'application/vnd.google-apps.spreadsheet',
        size: 512000,
        md5Checksum: '7c6a992a2a722e0394c8e7e1f37e4604',
        trashed: false,
        parents: ['root'],
        modifiedTime: new Date(Date.now() - 7200000).toISOString(),
        createdTime: new Date(Date.now() - 172800000).toISOString(),
        syncStatus: 'synced',
        lastSyncedAt: Date.now() - 7200000,
      },
      {
        id: '3cD4e5F6g7_pdf',
        name: 'Architecture Blueprint Specification.pdf',
        mimeType: 'application/pdf',
        size: 1048576,
        md5Checksum: '9b7a48d82f7e34d67e1a2249e0c7041f',
        trashed: false,
        parents: ['root'],
        modifiedTime: new Date(Date.now() - 14400000).toISOString(),
        createdTime: new Date(Date.now() - 259200000).toISOString(),
        syncStatus: 'synced',
        lastSyncedAt: Date.now() - 14400000,
      },
      {
        id: '4dE5f6G7h8_trash',
        name: 'Old Meeting Notes (Draft Deprecated).gdoc',
        mimeType: 'application/vnd.google-apps.document',
        size: 84000,
        md5Checksum: '4a8a08f09d37b73795649038408b5f33',
        trashed: true,
        parents: ['root'],
        modifiedTime: new Date(Date.now() - 86400000).toISOString(),
        createdTime: new Date(Date.now() - 432000000).toISOString(),
        syncStatus: 'synced',
        lastSyncedAt: Date.now() - 86400000,
      },
    ];

    await db.files.bulkPut(sampleFiles);
    await db.updateSyncToken('initial_sync_token_v1');
    await db.logAction('SEED_DATABASE', 'SYSTEM', undefined, `Seeded ${sampleFiles.length} demo files.`);
    showNotice(`Seeded ${sampleFiles.length} files into Dexie database.`);
  };

  const getFileIcon = (mimeType: string) => {
    if (mimeType.includes('spreadsheet')) return <FileSpreadsheet className="w-4 h-4 text-emerald-400" />;
    if (mimeType.includes('folder')) return <Folder className="w-4 h-4 text-amber-400" />;
    if (mimeType.includes('pdf')) return <FileCode className="w-4 h-4 text-rose-400" />;
    return <FileText className="w-4 h-4 text-blue-400" />;
  };

  const formatBytes = (bytes?: number) => {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  };

  return (
    <div className="space-y-6">
      {/* Toast Notice */}
      {statusMessage && (
        <div className="p-3 bg-blue-950/80 border border-blue-800/60 rounded-xl text-blue-200 text-xs flex items-center justify-between shadow-lg">
          <div className="flex items-center gap-2">
            <Activity className="w-3.5 h-3.5 text-blue-400 animate-pulse" />
            <span>{statusMessage}</span>
          </div>
          <button
            onClick={() => setStatusMessage(null)}
            className="text-blue-400 hover:text-white text-xs font-semibold"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Connected User & Drive Sync Action Bar */}
      <div className="p-4 bg-neutral-900/80 border border-neutral-800 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-full bg-blue-600/20 border border-blue-500/40 flex items-center justify-center text-blue-400 font-bold text-base overflow-hidden">
            {user?.picture ? (
              <img src={user.picture} alt={user.name} className="w-full h-full object-cover" />
            ) : (
              (user?.name || 'U').charAt(0).toUpperCase()
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-neutral-100 text-sm">{user?.name}</span>
              <span className="inline-flex items-center gap-1 text-[11px] bg-emerald-950/80 border border-emerald-800/60 text-emerald-400 px-2 py-0.5 rounded-full">
                <CheckCircle2 className="w-3 h-3" /> Drive Connected
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-neutral-400 mt-0.5">
              <span>{user?.email}</span>
              <span>•</span>
              <span className="font-mono text-[11px] text-neutral-500 truncate max-w-[140px]">
                Token: {token ? `${token.substring(0, 8)}...` : 'None'}
              </span>
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center flex-wrap gap-2">
          {/* Main Sync With Drive Button */}
          {onTriggerSync && (
            <button
              id="btn-trigger-drive-sync"
              type="button"
              disabled={isSyncing || !isOnline}
              onClick={onTriggerSync}
              className="flex items-center gap-2 text-xs font-semibold px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 active:scale-[0.98] text-white transition shadow-md disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>{isSyncing ? 'Syncing Drive...' : 'Sync with Google Drive'}</span>
            </button>
          )}

          {(!files || files.length === 0) && (
            <button
              id="btn-seed-drive-data"
              type="button"
              onClick={handleSeedDriveData}
              className="text-xs font-medium px-3 py-2 rounded-xl border border-neutral-700 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 transition"
              title="Populate mock data to test table layout"
            >
              Seed Sample Data
            </button>
          )}

          <button
            id="btn-add-file-modal"
            type="button"
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 text-xs font-medium px-3.5 py-2 rounded-xl border border-neutral-700 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 transition"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add File</span>
          </button>

          <button
            id="btn-disconnect-session"
            type="button"
            onClick={onLogout}
            className="text-xs font-medium px-3 py-2 rounded-xl border border-neutral-700 hover:bg-neutral-800 text-neutral-400 hover:text-neutral-200 transition"
          >
            Disconnect
          </button>
        </div>
      </div>

      {/* Navigation Tabs for Dexie Database Tables */}
      <div className="flex items-center gap-2 border-b border-neutral-800 pb-2 overflow-x-auto">
        <button
          type="button"
          onClick={() => setActiveTab('files')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium transition ${
            activeTab === 'files'
              ? 'bg-blue-600/20 border border-blue-500/40 text-blue-300'
              : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900'
          }`}
        >
          <Folder className="w-3.5 h-3.5" />
          <span>Files Table</span>
          <span className="text-[10px] bg-neutral-800 px-1.5 py-0.5 rounded-full">
            {files?.length ?? 0}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('semantic')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium transition ${
            activeTab === 'semantic'
              ? 'bg-purple-600/25 border border-purple-500/50 text-purple-300 shadow-sm'
              : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5 text-purple-400" />
          <span>Semantic AI Search</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('duplicates')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium transition ${
            activeTab === 'duplicates'
              ? 'bg-amber-600/25 border border-amber-500/50 text-amber-300 shadow-sm'
              : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900'
          }`}
        >
          <Copy className="w-3.5 h-3.5 text-amber-400" />
          <span>Duplicate Detector</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('vault')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium transition ${
            activeTab === 'vault'
              ? 'bg-indigo-600/25 border border-indigo-500/50 text-indigo-300 shadow-sm'
              : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900'
          }`}
        >
          <Shield className="w-3.5 h-3.5 text-indigo-400" />
          <span>Privacy Vault</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('queue')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium transition ${
            activeTab === 'queue'
              ? 'bg-blue-600/20 border border-blue-500/40 text-blue-300'
              : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          <span>Sync Queue</span>
          {pendingQueueCount > 0 ? (
            <span className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/30 px-1.5 py-0.5 rounded-full">
              {pendingQueueCount}
            </span>
          ) : (
            <span className="text-[10px] bg-neutral-800 px-1.5 py-0.5 rounded-full">
              {syncQueue?.length ?? 0}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('audit')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium transition ${
            activeTab === 'audit'
              ? 'bg-blue-600/20 border border-blue-500/40 text-blue-300'
              : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900'
          }`}
        >
          <Activity className="w-3.5 h-3.5" />
          <span>Audit Log</span>
          <span className="text-[10px] bg-neutral-800 px-1.5 py-0.5 rounded-full">
            {auditLogs?.length ?? 0}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('state')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium transition ${
            activeTab === 'state'
              ? 'bg-blue-600/20 border border-blue-500/40 text-blue-300'
              : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900'
          }`}
        >
          <Database className="w-3.5 h-3.5" />
          <span>Sync State</span>
        </button>
      </div>

      {/* Tab 1: Files Table */}
      {activeTab === 'files' && (
        <div className="space-y-4">
          {/* Controls Bar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-neutral-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                id="search-files-input"
                type="text"
                placeholder="Search cached files by name or MD5 checksum..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full text-xs bg-neutral-900/80 border border-neutral-700/80 rounded-xl pl-9 pr-3 py-2 text-neutral-200 placeholder:text-neutral-500 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center p-0.5 bg-neutral-900 border border-neutral-800 rounded-lg text-xs">
                <button
                  type="button"
                  onClick={() => setFilterTrashed('active')}
                  className={`px-2.5 py-1 rounded-md transition ${
                    filterTrashed === 'active' ? 'bg-neutral-800 text-neutral-100 font-medium' : 'text-neutral-400'
                  }`}
                >
                  Active
                </button>
                <button
                  type="button"
                  onClick={() => setFilterTrashed('trashed')}
                  className={`px-2.5 py-1 rounded-md transition ${
                    filterTrashed === 'trashed' ? 'bg-neutral-800 text-neutral-100 font-medium' : 'text-neutral-400'
                  }`}
                >
                  Trashed
                </button>
                <button
                  type="button"
                  onClick={() => setFilterTrashed('all')}
                  className={`px-2.5 py-1 rounded-md transition ${
                    filterTrashed === 'all' ? 'bg-neutral-800 text-neutral-100 font-medium' : 'text-neutral-400'
                  }`}
                >
                  All
                </button>
              </div>
            </div>
          </div>

          {/* Files Grid / Table */}
          <div className="border border-neutral-800 rounded-2xl overflow-hidden bg-neutral-900/40">
            <div className="grid grid-cols-12 gap-2 px-4 py-2.5 bg-neutral-800/40 text-[11px] font-semibold text-neutral-400 uppercase tracking-wider border-b border-neutral-800">
              <div className="col-span-5 sm:col-span-4">File Name</div>
              <div className="col-span-2 hidden md:block">MIME Type</div>
              <div className="col-span-2 hidden sm:block">MD5 Checksum</div>
              <div className="col-span-3 sm:col-span-2">Size / Modified</div>
              <div className="col-span-4 sm:col-span-2 text-right">Actions</div>
            </div>

            {filteredFiles.length === 0 ? (
              <div className="p-10 text-center text-neutral-500 space-y-3">
                <Folder className="w-8 h-8 mx-auto text-neutral-600" />
                <p className="text-sm font-medium">No files found in local Dexie database</p>
                <p className="text-xs text-neutral-600 max-w-sm mx-auto">
                  Click &quot;Sync with Google Drive&quot; above to fetch real files from your Drive account, or add a local file.
                </p>
                {onTriggerSync && isOnline && (
                  <button
                    type="button"
                    onClick={onTriggerSync}
                    disabled={isSyncing}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white transition"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                    <span>Run Sync Engine</span>
                  </button>
                )}
              </div>
            ) : (
              <div className="divide-y divide-neutral-800/60">
                {filteredFiles.map((file) => (
                  <div
                    key={file.id}
                    className="grid grid-cols-12 gap-2 px-4 py-3 items-center hover:bg-neutral-800/30 transition text-xs"
                  >
                    {/* Name & icon */}
                    <div className="col-span-5 sm:col-span-4 flex items-center gap-2.5 min-w-0">
                      {getFileIcon(file.mimeType)}
                      <div className="min-w-0 truncate">
                        <div className="flex items-center gap-1.5 truncate">
                          <span
                            className={`font-medium truncate ${
                              file.trashed ? 'line-through text-neutral-500' : 'text-neutral-200'
                            }`}
                          >
                            {file.name}
                          </span>
                          {file.isVaultLocked && (
                            <span
                              className="inline-flex items-center gap-0.5 text-[9px] bg-indigo-950/90 text-indigo-300 border border-indigo-800/80 px-1.5 py-0.5 rounded shrink-0 font-medium"
                              title="Protected in Local Privacy Vault"
                            >
                              <Lock className="w-2.5 h-2.5 text-indigo-400" />
                              Vault
                            </span>
                          )}
                          {file.hasEmbedding && (
                            <span
                              className="inline-flex items-center gap-0.5 text-[9px] bg-purple-950/90 text-purple-300 border border-purple-800/80 px-1.5 py-0.5 rounded shrink-0 font-medium"
                              title="Vector Embedding Cached (384-d)"
                            >
                              <Sparkles className="w-2.5 h-2.5 text-purple-400" />
                              Vectorized
                            </span>
                          )}
                        </div>
                        <span className="font-mono text-[10px] text-neutral-500 block truncate">
                          ID: {file.id}
                        </span>
                      </div>
                    </div>

                    {/* MIME Type */}
                    <div className="col-span-2 hidden md:block text-neutral-400 truncate text-[11px]">
                      {file.mimeType.replace('application/vnd.google-apps.', 'gsuite/')}
                    </div>

                    {/* MD5 Checksum */}
                    <div
                      className="col-span-2 hidden sm:block font-mono text-[11px] text-neutral-500 truncate"
                      title={file.md5Checksum}
                    >
                      {file.md5Checksum ? file.md5Checksum.substring(0, 12) + '...' : '—'}
                    </div>

                    {/* Size & Modified */}
                    <div className="col-span-3 sm:col-span-2 text-neutral-400 text-[11px]">
                      <div>{formatBytes(file.size)}</div>
                      <div className="text-neutral-500 text-[10px]">
                        {new Date(file.modifiedTime).toLocaleDateString()}{' '}
                        {new Date(file.modifiedTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="col-span-4 sm:col-span-2 flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleToggleTrash(file)}
                        title={file.trashed ? 'Restore file' : 'Move to trash'}
                        className={`p-1.5 rounded-lg border transition ${
                          file.trashed
                            ? 'bg-amber-950/40 border-amber-800/60 text-amber-300 hover:bg-amber-900/60'
                            : 'border-neutral-800 hover:bg-neutral-800 text-neutral-400 hover:text-neutral-200'
                        }`}
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDeletePermanent(file)}
                        title="Delete permanently"
                        className="p-1.5 rounded-lg border border-neutral-800 hover:bg-rose-950/40 hover:border-rose-800/60 text-neutral-500 hover:text-rose-400 transition"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 2: Sync Queue */}
      {activeTab === 'queue' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between p-3.5 bg-neutral-900/60 border border-neutral-800 rounded-xl">
            <div>
              <h3 className="text-xs font-semibold text-neutral-200">syncQueue Table</h3>
              <p className="text-[11px] text-neutral-400">
                Operations queued offline waiting for network synchronization with Google Drive REST API.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleClearCompletedQueue}
                className="text-xs px-3 py-1.5 rounded-lg border border-neutral-700 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 transition"
              >
                Clear Completed
              </button>

              {onTriggerSync && (
                <button
                  type="button"
                  onClick={onTriggerSync}
                  disabled={isSyncing || pendingQueueCount === 0 || !isOnline}
                  className="flex items-center gap-1.5 text-xs font-medium px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white transition"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                  <span>{isSyncing ? 'Syncing...' : `Flush Queue (${pendingQueueCount})`}</span>
                </button>
              )}
            </div>
          </div>

          <div className="border border-neutral-800 rounded-2xl overflow-hidden bg-neutral-900/40">
            <div className="grid grid-cols-12 gap-2 px-4 py-2.5 bg-neutral-800/40 text-[11px] font-semibold text-neutral-400 uppercase tracking-wider border-b border-neutral-800">
              <div className="col-span-3 sm:col-span-2">Queue ID</div>
              <div className="col-span-2 sm:col-span-2">Action</div>
              <div className="col-span-4 sm:col-span-5">Payload Summary</div>
              <div className="col-span-3 sm:col-span-3 text-right">Status</div>
            </div>

            {(!syncQueue || syncQueue.length === 0) ? (
              <div className="p-8 text-center text-neutral-500 text-xs">
                No items in syncQueue table. Perform file operations (create, trash, delete) to populate queue.
              </div>
            ) : (
              <div className="divide-y divide-neutral-800/60 text-xs">
                {syncQueue.map((item) => (
                  <div key={item.id} className="grid grid-cols-12 gap-2 px-4 py-3 items-center hover:bg-neutral-800/20">
                    <div className="col-span-3 sm:col-span-2 font-mono text-[10px] text-neutral-500 truncate">
                      {item.id}
                    </div>
                    <div className="col-span-2 sm:col-span-2">
                      <span className="uppercase text-[10px] font-bold px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-300">
                        {item.action}
                      </span>
                    </div>
                    <div className="col-span-4 sm:col-span-5 font-mono text-[11px] text-neutral-400 truncate">
                      {item.payload?.name || item.fileId || JSON.stringify(item.payload)}
                    </div>
                    <div className="col-span-3 sm:col-span-3 text-right">
                      {item.status === 'pending' ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-400 bg-amber-950/60 border border-amber-800/50 px-2 py-0.5 rounded-full">
                          <Clock className="w-3 h-3" /> Pending
                        </span>
                      ) : item.status === 'processing' ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-400 bg-blue-950/60 border border-blue-800/50 px-2 py-0.5 rounded-full">
                          <RefreshCw className="w-3 h-3 animate-spin" /> Processing
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400 bg-emerald-950/60 border border-emerald-800/50 px-2 py-0.5 rounded-full">
                          <CheckCircle2 className="w-3 h-3" /> Completed
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 3: Audit Log */}
      {activeTab === 'audit' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between p-3.5 bg-neutral-900/60 border border-neutral-800 rounded-xl">
            <div>
              <h3 className="text-xs font-semibold text-neutral-200">auditLog Table</h3>
              <p className="text-[11px] text-neutral-400">
                Immutable audit record for every action (creates, modifications, trashing, sync batches).
              </p>
            </div>

            <button
              type="button"
              onClick={handleClearAuditLog}
              className="text-xs px-3 py-1.5 rounded-lg border border-neutral-700 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 transition"
            >
              Clear Log
            </button>
          </div>

          <div className="border border-neutral-800 rounded-2xl overflow-hidden bg-neutral-900/40">
            <div className="grid grid-cols-12 gap-2 px-4 py-2.5 bg-neutral-800/40 text-[11px] font-semibold text-neutral-400 uppercase tracking-wider border-b border-neutral-800">
              <div className="col-span-3 sm:col-span-2">Timestamp</div>
              <div className="col-span-3 sm:col-span-2">Action</div>
              <div className="col-span-3 sm:col-span-3">Target / File ID</div>
              <div className="col-span-3 sm:col-span-5">Details</div>
            </div>

            {(!auditLogs || auditLogs.length === 0) ? (
              <div className="p-8 text-center text-neutral-500 text-xs">
                No entries in auditLog table yet.
              </div>
            ) : (
              <div className="divide-y divide-neutral-800/60 text-xs">
                {auditLogs.map((log) => (
                  <div key={log.id} className="grid grid-cols-12 gap-2 px-4 py-2.5 items-center hover:bg-neutral-800/20">
                    <div className="col-span-3 sm:col-span-2 text-neutral-500 font-mono text-[10px]">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </div>
                    <div className="col-span-3 sm:col-span-2">
                      <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded bg-neutral-800 text-blue-300 border border-neutral-700">
                        {log.action}
                      </span>
                    </div>
                    <div className="col-span-3 sm:col-span-3 font-mono text-[11px] text-neutral-300 truncate">
                      {log.fileName || log.fileId}
                    </div>
                    <div className="col-span-3 sm:col-span-5 text-neutral-400 truncate text-[11px]">
                      {log.details || '—'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 4: Sync State */}
      {activeTab === 'state' && (
        <div className="space-y-4">
          <div className="p-6 bg-neutral-900/60 border border-neutral-800 rounded-2xl space-y-4">
            <h3 className="text-sm font-semibold text-neutral-200 flex items-center gap-2">
              <Database className="w-4 h-4 text-blue-400" />
              <span>syncState Table (Delta Sync Token & Status)</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div className="p-4 bg-neutral-950/80 border border-neutral-800 rounded-xl space-y-1.5">
                <span className="text-neutral-500 text-[11px] uppercase tracking-wider font-semibold">State Key</span>
                <p className="font-mono text-neutral-200 text-sm">{syncState?.key || 'drive_delta_sync'}</p>
              </div>

              <div className="p-4 bg-neutral-950/80 border border-neutral-800 rounded-xl space-y-1.5">
                <span className="text-neutral-500 text-[11px] uppercase tracking-wider font-semibold">Sync Status</span>
                <p className="text-emerald-400 font-medium text-sm flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" /> {syncState?.status || 'Initialized'}
                </p>
              </div>

              <div className="p-4 bg-neutral-950/80 border border-neutral-800 rounded-xl space-y-1.5">
                <span className="text-neutral-500 text-[11px] uppercase tracking-wider font-semibold">Last Sync Token</span>
                <p className="font-mono text-neutral-300 break-all text-xs bg-neutral-900 p-2 rounded border border-neutral-800">
                  {syncState?.lastSyncToken || 'No delta token stored yet'}
                </p>
              </div>

              <div className="p-4 bg-neutral-950/80 border border-neutral-800 rounded-xl space-y-1.5">
                <span className="text-neutral-500 text-[11px] uppercase tracking-wider font-semibold">Last Synced Timestamp</span>
                <p className="font-mono text-neutral-300 text-xs">
                  {syncState?.lastSyncedAt ? new Date(syncState.lastSyncedAt).toLocaleString() : 'Never'}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab: Local Privacy Vault */}
      {activeTab === 'vault' && (
        <div className="space-y-4">
          <PrivacyVault />
        </div>
      )}

      {/* Tab: Local Semantic AI Search */}
      {activeTab === 'semantic' && (
        <div className="space-y-4">
          <SemanticSearch />
        </div>
      )}

      {/* Tab: Duplicate Detector */}
      {activeTab === 'duplicates' && (
        <div className="space-y-4">
          <DuplicateFinder />
        </div>
      )}

      {/* Modal: Add File */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-neutral-900 border border-neutral-700 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <h3 className="text-base font-semibold text-neutral-100">Add Local File to Dexie</h3>
            <p className="text-xs text-neutral-400">
              Creates a file record in IndexedDB and places a create action in the sync queue.
            </p>

            <form onSubmit={handleCreateFile} className="space-y-3 pt-2">
              <div>
                <label className="block text-[11px] font-medium text-neutral-400 uppercase tracking-wider mb-1">
                  File Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Project Proposal 2026.gdoc"
                  value={fileName}
                  onChange={(e) => setFileName(e.target.value)}
                  className="w-full text-xs bg-neutral-950 border border-neutral-700 rounded-lg p-2.5 text-neutral-100 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-neutral-400 uppercase tracking-wider mb-1">
                  MIME Type
                </label>
                <select
                  value={fileMimeType}
                  onChange={(e) => setFileMimeType(e.target.value)}
                  className="w-full text-xs bg-neutral-950 border border-neutral-700 rounded-lg p-2.5 text-neutral-200 focus:outline-none focus:border-blue-500"
                >
                  <option value="application/vnd.google-apps.document">Google Docs Document (.gdoc)</option>
                  <option value="application/vnd.google-apps.spreadsheet">Google Sheets Spreadsheet (.gsheet)</option>
                  <option value="application/vnd.google-apps.presentation">Google Slides Presentation (.gslides)</option>
                  <option value="application/pdf">PDF Document (.pdf)</option>
                  <option value="application/vnd.google-apps.folder">Google Drive Folder</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-neutral-400 uppercase tracking-wider mb-1">
                  Simulated Size (KB)
                </label>
                <input
                  type="number"
                  min="1"
                  max="100000"
                  value={fileSizeKb}
                  onChange={(e) => setFileSizeKb(e.target.value)}
                  className="w-full text-xs bg-neutral-950 border border-neutral-700 rounded-lg p-2.5 text-neutral-100 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="text-xs px-3.5 py-2 rounded-lg border border-neutral-700 hover:bg-neutral-800 text-neutral-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="text-xs font-medium px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition"
                >
                  Create & Enqueue
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
