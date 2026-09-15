import React, { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { DriveFileItem, SyncStatus } from '../types';
import { 
  FileText, 
  Folder, 
  Plus, 
  CheckCircle, 
  Clock, 
  RefreshCw, 
  Trash2, 
  Lock, 
  Database,
  Search,
  Sparkles,
  Wifi,
  WifiOff
} from 'lucide-react';

interface OfflineFilesListProps {
  syncStatus: SyncStatus;
  onSimulateSync: () => void;
  isSyncing: boolean;
}

export const OfflineFilesList: React.FC<OfflineFilesListProps> = ({
  syncStatus,
  onSimulateSync,
  isSyncing,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [newFileName, setNewFileName] = useState('');
  const [newFileType, setNewFileType] = useState('application/vnd.google-apps.document');

  // Live query from Dexie IndexedDB
  const files = useLiveQuery(async () => {
    const all = await db.files.toArray();
    return all.sort((a, b) => new Date(b.modifiedTime).getTime() - new Date(a.modifiedTime).getTime());
  }, []);

  const handleAddOfflineFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFileName.trim()) return;

    const newFile: DriveFileItem = {
      id: `local-${Date.now()}`,
      name: newFileName.trim(),
      mimeType: newFileType,
      modifiedTime: new Date().toISOString(),
      createdTime: new Date().toISOString(),
      starred: false,
      trashed: false,
      syncStatus: 'pending', // Pending sync to remote Drive
      hasEmbedding: false,
      lastSyncedAt: undefined,
    };

    await db.files.add(newFile);
    setNewFileName('');
  };

  const handleSeedDemoData = async () => {
    const initialFiles: DriveFileItem[] = [
      {
        id: 'drive-doc-1',
        name: 'Project Roadmap 2026.gdoc',
        mimeType: 'application/vnd.google-apps.document',
        modifiedTime: new Date(Date.now() - 3600000).toISOString(),
        starred: true,
        trashed: false,
        syncStatus: 'synced',
        hasEmbedding: true,
        lastSyncedAt: Date.now() - 3600000,
      },
      {
        id: 'drive-sheet-2',
        name: 'Financial Budget Q3.gsheet',
        mimeType: 'application/vnd.google-apps.spreadsheet',
        modifiedTime: new Date(Date.now() - 7200000).toISOString(),
        starred: false,
        trashed: false,
        syncStatus: 'synced',
        hasEmbedding: true,
        lastSyncedAt: Date.now() - 7200000,
      },
      {
        id: 'local-draft-3',
        name: 'Client Proposal Draft (Offline Edit).gdoc',
        mimeType: 'application/vnd.google-apps.document',
        modifiedTime: new Date().toISOString(),
        starred: false,
        trashed: false,
        syncStatus: 'pending', // Pending remote sync
        hasEmbedding: false,
      },
    ];

    await db.files.bulkPut(initialFiles);
  };

  const handleDeleteFile = async (id: string) => {
    await db.files.delete(id);
  };

  const handleTogglePending = async (file: DriveFileItem) => {
    const nextStatus = file.syncStatus === 'synced' ? 'pending' : 'synced';
    await db.files.update(file.id, { 
      syncStatus: nextStatus,
      modifiedTime: new Date().toISOString(),
    });
  };

  const filteredFiles = (files || []).filter((file) =>
    file.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const pendingCount = (files || []).filter((f) => f.syncStatus === 'pending').length;

  return (
    <div className="space-y-4">
      {/* Offline Storage & Sync Action Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-neutral-800/40 border border-neutral-700/80 rounded-xl">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-blue-950/60 border border-blue-800/50 text-blue-400">
            <Database className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-medium text-neutral-100">IndexedDB Local Cache</h3>
              <span className="text-[11px] bg-neutral-700/60 text-neutral-300 px-2 py-0.5 rounded-full font-mono">
                Dexie.js
              </span>
            </div>
            <p className="text-xs text-neutral-400">
              {files?.length ?? 0} files stored locally • {pendingCount} changes waiting to sync
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {(!files || files.length === 0) && (
            <button
              id="btn-seed-data"
              type="button"
              onClick={handleSeedDemoData}
              className="text-xs font-medium px-3 py-1.5 rounded-lg border border-neutral-700 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 transition"
            >
              Seed Sample Files
            </button>
          )}

          <button
            id="btn-trigger-sync"
            type="button"
            onClick={onSimulateSync}
            disabled={isSyncing || pendingCount === 0}
            className="flex items-center gap-1.5 text-xs font-medium px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:bg-neutral-800 disabled:border disabled:border-neutral-700 text-white disabled:text-neutral-500 transition shadow-sm"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
            <span>{isSyncing ? 'Synchronizing...' : `Sync Pending (${pendingCount})`}</span>
          </button>
        </div>
      </div>

      {/* Add Offline File Form */}
      <form
        id="add-file-form"
        onSubmit={handleAddOfflineFile}
        className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 p-3 bg-neutral-800/30 border border-neutral-700/60 rounded-xl"
      >
        <div className="relative flex-1">
          <input
            id="input-file-name"
            type="text"
            placeholder="Add a new file or local offline draft..."
            value={newFileName}
            onChange={(e) => setNewFileName(e.target.value)}
            className="w-full text-sm bg-neutral-900/80 border border-neutral-700/80 rounded-lg px-3 py-2 text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:border-blue-500 transition"
          />
        </div>

        <select
          id="select-file-type"
          value={newFileType}
          onChange={(e) => setNewFileType(e.target.value)}
          className="text-xs bg-neutral-900 border border-neutral-700/80 rounded-lg px-3 py-2 text-neutral-300 focus:outline-none focus:border-blue-500"
        >
          <option value="application/vnd.google-apps.document">Google Doc</option>
          <option value="application/vnd.google-apps.spreadsheet">Google Sheet</option>
          <option value="application/vnd.google-apps.folder">Folder</option>
          <option value="application/pdf">PDF File</option>
        </select>

        <button
          id="btn-add-file"
          type="submit"
          disabled={!newFileName.trim()}
          className="flex items-center justify-center gap-1 text-xs font-medium px-4 py-2 bg-neutral-700 hover:bg-neutral-600 disabled:opacity-40 text-white rounded-lg transition"
        >
          <Plus className="w-3.5 h-3.5" /> Add Offline File
        </button>
      </form>

      {/* Search & Filter Bar */}
      <div className="relative">
        <Search className="w-4 h-4 text-neutral-500 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          id="search-offline-files"
          type="text"
          placeholder="Filter cached files by title..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full text-sm bg-neutral-900/60 border border-neutral-700/60 rounded-lg pl-9 pr-3 py-2 text-neutral-200 placeholder:text-neutral-500 focus:outline-none focus:border-neutral-600"
        />
      </div>

      {/* Files Table / List */}
      <div className="border border-neutral-800 rounded-xl overflow-hidden bg-neutral-900/40">
        <div className="grid grid-cols-12 gap-2 px-4 py-2.5 bg-neutral-800/40 text-[11px] font-semibold text-neutral-400 uppercase tracking-wider border-b border-neutral-800">
          <div className="col-span-6 sm:col-span-5">Name</div>
          <div className="col-span-3 sm:col-span-3">Sync Status</div>
          <div className="hidden sm:block sm:col-span-2">Modified</div>
          <div className="col-span-3 sm:col-span-2 text-right">Actions</div>
        </div>

        {filteredFiles.length === 0 ? (
          <div className="p-8 text-center text-neutral-500 space-y-2">
            <Folder className="w-8 h-8 mx-auto stroke-[1.5] text-neutral-600" />
            <p className="text-sm">No local files found.</p>
            <p className="text-xs text-neutral-600">
              Click &quot;Seed Sample Files&quot; or add a new offline item above to test Dexie persistence.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-neutral-800/60">
            {filteredFiles.map((file) => (
              <div
                key={file.id}
                className="grid grid-cols-12 gap-2 px-4 py-3 items-center hover:bg-neutral-800/20 transition-colors text-sm"
              >
                {/* Title & Type Icon */}
                <div className="col-span-6 sm:col-span-5 flex items-center gap-2.5 min-w-0">
                  {file.mimeType.includes('folder') ? (
                    <Folder className="w-4 h-4 text-amber-400 shrink-0" />
                  ) : (
                    <FileText className="w-4 h-4 text-blue-400 shrink-0" />
                  )}
                  <span className="font-medium text-neutral-200 truncate">{file.name}</span>
                  {file.hasEmbedding && (
                    <span title="Embedded for Semantic Search" className="shrink-0 text-purple-400">
                      <Sparkles className="w-3 h-3" />
                    </span>
                  )}
                </div>

                {/* Sync Status Badge */}
                <div className="col-span-3 sm:col-span-3 flex items-center">
                  {file.syncStatus === 'synced' ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-950/70 text-emerald-400 border border-emerald-800/50">
                      <CheckCircle className="w-3 h-3" /> Synced
                    </span>
                  ) : file.syncStatus === 'pending' ? (
                    <button
                      type="button"
                      onClick={() => handleTogglePending(file)}
                      title="Click to toggle sync status"
                      className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-950/70 text-amber-300 border border-amber-800/50 hover:bg-amber-900/50 transition cursor-pointer"
                    >
                      <Clock className="w-3 h-3" /> Pending
                    </button>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-blue-950/70 text-blue-400 border border-blue-800/50">
                      <RefreshCw className="w-3 h-3 animate-spin" /> Syncing
                    </span>
                  )}
                </div>

                {/* Modified time */}
                <div className="hidden sm:block sm:col-span-2 text-xs text-neutral-400">
                  {new Date(file.modifiedTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>

                {/* Actions */}
                <div className="col-span-3 sm:col-span-2 flex items-center justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleTogglePending(file)}
                    title={file.syncStatus === 'synced' ? 'Mark as modified offline' : 'Mark as synced'}
                    className="p-1.5 rounded-md hover:bg-neutral-800 text-neutral-400 hover:text-neutral-200 transition"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteFile(file.id)}
                    title="Delete local file"
                    className="p-1.5 rounded-md hover:bg-rose-950/40 text-neutral-500 hover:text-rose-400 transition"
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
  );
};
