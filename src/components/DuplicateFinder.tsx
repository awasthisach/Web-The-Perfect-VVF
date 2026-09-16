/// src/components/DuplicateFinder.tsx ///
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type FileRecord } from '../lib/db';
import {
  runFullDuplicateScan,
  trashRedundantFiles,
  type ExactDuplicateGroup,
  type SemanticDuplicatePair,
  type DeduplicationSummary,
} from '../lib/duplicateEngine';
import {
  createDriveFile,
  moveDriveFile,
  getDriveFile,
  findFolderByName,
  DriveApiError,
} from '../lib/driveApi';
import {
  Copy,
  Trash2,
  RefreshCw,
  CheckCircle2,
  FileSpreadsheet,
  Folder,
  FileCode,
  FileText,
  Sparkles,
  ExternalLink,
  Move,
  X,
  Loader2,
  Filter,
  ArrowUpDown,
  CheckSquare,
  Square,
  Image as ImageIcon,
  File,
} from 'lucide-react';

type FileTypeFilter = 'all' | 'document' | 'image' | 'spreadsheet';
type SizeFilter = 'all' | 'lt1mb' | '1to10mb' | 'gt10mb';
type SortKey = 'name-asc' | 'name-desc' | 'modified-newest' | 'modified-oldest' | 'size-largest' | 'size-smallest';

function getFileIcon(mimeType: string) {
  if (mimeType.includes('spreadsheet') || mimeType.includes('sheet')) {
    return <FileSpreadsheet className="w-4 h-4 text-emerald-400" aria-hidden="true" />;
  }
  if (mimeType.includes('folder')) {
    return <Folder className="w-4 h-4 text-amber-400" aria-hidden="true" />;
  }
  if (mimeType.includes('pdf')) {
    return <FileCode className="w-4 h-4 text-rose-400" aria-hidden="true" />;
  }
  if (mimeType.startsWith('image/')) {
    return <ImageIcon className="w-4 h-4 text-sky-400" aria-hidden="true" />;
  }
  if (mimeType.includes('document') || mimeType.includes('text')) {
    return <FileText className="w-4 h-4 text-blue-400" aria-hidden="true" />;
  }
  return <File className="w-4 h-4 text-neutral-400" aria-hidden="true" />;
}

function formatBytes(bytes?: number) {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function matchesFileType(file: FileRecord, filter: FileTypeFilter): boolean {
  if (filter === 'all') return true;
  const mime = (file.mimeType || '').toLowerCase();
  if (filter === 'document') {
    return (
      mime.includes('document') ||
      mime.includes('pdf') ||
      mime.includes('text') ||
      mime.includes('msword') ||
      mime.includes('opendocument.text')
    );
  }
  if (filter === 'image') {
    return mime.startsWith('image/');
  }
  if (filter === 'spreadsheet') {
    return (
      mime.includes('spreadsheet') ||
      mime.includes('sheet') ||
      mime.includes('excel') ||
      mime.includes('csv')
    );
  }
  return true;
}

function matchesSize(file: FileRecord, filter: SizeFilter): boolean {
  if (filter === 'all') return true;
  const size = file.size ?? 0;
  if (filter === 'lt1mb') return size < 1_048_576;
  if (filter === '1to10mb') return size >= 1_048_576 && size <= 10_485_760;
  if (filter === 'gt10mb') return size > 10_485_760;
  return true;
}

function getWebViewLink(file: FileRecord): string {
  const anyFile = file as FileRecord & { webViewLink?: string };
  if (anyFile.webViewLink) return anyFile.webViewLink;
  return `https://drive.google.com/file/d/${file.id}/view`;
}

export const DuplicateFinder: React.FC = () => {
  const [activeSubTab, setActiveSubTab] = useState<'exact' | 'semantic'>('exact');
  const [isScanning, setIsScanning] = useState(false);
  const [semanticThreshold, setSemanticThreshold] = useState(0.82);
  const [summary, setSummary] = useState<DeduplicationSummary | null>(null);
  const [actionNotice, setActionNotice] = useState<{ message: string; type: 'info' | 'success' | 'error' } | null>(null);
  const [isProcessingAction, setIsProcessingAction] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [fileTypeFilter, setFileTypeFilter] = useState<FileTypeFilter>('all');
  const [sizeFilter, setSizeFilter] = useState<SizeFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('size-largest');
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [folderNameInput, setFolderNameInput] = useState('');
  const [folderNameError, setFolderNameError] = useState<string | null>(null);
  const [isMoving, setIsMoving] = useState(false);

  const files = useLiveQuery(() => db.files.toArray(), []);

  const showNotice = useCallback((message: string, type: 'info' | 'success' | 'error' = 'info') => {
    setActionNotice({ message, type });
  }, []);

  const handleRunScan = async () => {
    setIsScanning(true);
    try {
      const res = await runFullDuplicateScan(semanticThreshold);
      setSummary(res);
      setSelectedIds(new Set());
      showNotice(
        `Scan finished: identified ${res.exactGroups.length} exact duplicate groups and ${res.semanticPairs.length} semantic duplicate pairs.`,
        'success'
      );
    } catch (err) {
      console.error('Duplicate scan error:', err);
      showNotice('Failed to complete duplicate scan. Check console for details.', 'error');
    } finally {
      setIsScanning(false);
    }
  };

  useEffect(() => {
    if (files && files.length > 0 && !summary && !isScanning) {
      handleRunScan();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files?.length]);

  const displayedExactGroups = useMemo(() => {
    if (!summary) return [];
    let groups = summary.exactGroups.map((g) => ({
      ...g,
      files: [...g.files],
    }));
    groups = groups.filter((group) =>
      group.files.some(
        (f) => matchesFileType(f, fileTypeFilter) && matchesSize(f, sizeFilter)
      )
    );
    groups.sort((a, b) => {
      const fa = a.files[0];
      const fb = b.files[0];
      switch (sortKey) {
        case 'name-asc':
          return (fa?.name || '').localeCompare(fb?.name || '', undefined, { sensitivity: 'base' });
        case 'name-desc':
          return (fb?.name || '').localeCompare(fa?.name || '', undefined, { sensitivity: 'base' });
        case 'modified-newest':
          return new Date(fb?.modifiedTime || 0).getTime() - new Date(fa?.modifiedTime || 0).getTime();
        case 'modified-oldest':
          return new Date(fa?.modifiedTime || 0).getTime() - new Date(fb?.modifiedTime || 0).getTime();
        case 'size-largest':
          return (b.size || 0) - (a.size || 0);
        case 'size-smallest':
          return (a.size || 0) - (b.size || 0);
        default:
          return 0;
      }
    });
    groups.forEach((g) => {
      g.files.sort((a, b) => {
        switch (sortKey) {
          case 'name-asc':
            return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
          case 'name-desc':
            return b.name.localeCompare(a.name, undefined, { sensitivity: 'base' });
          case 'modified-newest':
            return new Date(b.modifiedTime).getTime() - new Date(a.modifiedTime).getTime();
          case 'modified-oldest':
            return new Date(a.modifiedTime).getTime() - new Date(b.modifiedTime).getTime();
          case 'size-largest':
            return (b.size || 0) - (a.size || 0);
          case 'size-smallest':
            return (a.size || 0) - (b.size || 0);
          default:
            return 0;
        }
      });
    });
    return groups;
  }, [summary, fileTypeFilter, sizeFilter, sortKey]);

  const selectableIds = useMemo(() => {
    const ids: string[] = [];
    displayedExactGroups.forEach((g) => g.files.forEach((f) => ids.push(f.id)));
    return ids;
  }, [displayedExactGroups]);

  const allSelected =
    selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id));
  const someSelected = selectableIds.some((id) => selectedIds.has(id));

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(selectableIds));
    }
  };

  const toggleFileSelection = (fileId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(fileId)) next.delete(fileId);
      else next.add(fileId);
      return next;
    });
  };

  const handleTrashRedundantExact = async (group: ExactDuplicateGroup) => {
    if (group.files.length <= 1) return;
    setIsProcessingAction(true);
    try {
      const toTrash = group.files.slice(1);
      const count = await trashRedundantFiles(
        toTrash,
        `Exact binary duplicate of "${group.files[0].name}" (MD5: ${group.md5Checksum.substring(0, 8)})`
      );
      showNotice(`Successfully trashed ${count} redundant copies. 1 primary copy retained.`, 'success');
      handleRunScan();
    } catch (err) {
      console.error('Error trashing duplicate files:', err);
      showNotice('Failed to trash redundant copies.', 'error');
    } finally {
      setIsProcessingAction(false);
    }
  };

  const handleTrashAllExactRedundant = async () => {
    if (!summary || summary.exactGroups.length === 0) return;
    setIsProcessingAction(true);
    try {
      const allToTrash: FileRecord[] = [];
      for (const group of summary.exactGroups) {
        if (group.files.length > 1) {
          allToTrash.push(...group.files.slice(1));
        }
      }
      const count = await trashRedundantFiles(allToTrash, 'Bulk cleanup of all exact binary duplicates.');
      showNotice(`Cleaned up ${count} redundant duplicate files and recovered offline space.`, 'success');
      handleRunScan();
    } catch (err) {
      console.error('Error cleaning exact duplicates:', err);
      showNotice('Failed to clean exact duplicates.', 'error');
    } finally {
      setIsProcessingAction(false);
    }
  };

  const handleTrashSemanticFile = async (file: FileRecord, otherFile: FileRecord) => {
    setIsProcessingAction(true);
    try {
      await trashRedundantFiles([file], `Semantic duplicate of "${otherFile.name}"`);
      showNotice(`Moved "${file.name}" to trash.`, 'success');
      handleRunScan();
    } catch (err) {
      console.error('Error trashing file:', err);
      showNotice('Failed to trash file.', 'error');
    } finally {
      setIsProcessingAction(false);
    }
  };

  const openMoveModal = () => {
    if (selectedIds.size === 0) {
      showNotice('Please select at least one file to move.', 'error');
      return;
    }
    setFolderNameInput('');
    setFolderNameError(null);
    setShowMoveModal(true);
  };

  const handleMoveSelected = async () => {
    const name = folderNameInput.trim();
    if (!name) {
      setFolderNameError('Folder name cannot be empty.');
      showNotice('Please enter a valid folder name.', 'error');
      return;
    }
    if (name.length > 200) {
      setFolderNameError('Folder name is too long (max 200 characters).');
      return;
    }
    if (/[\\/:*?"<>|]/.test(name)) {
      setFolderNameError('Folder name contains invalid characters.');
      return;
    }

    setIsMoving(true);
    setFolderNameError(null);

    try {
      // ZERO-FOLDER SPAM: look for an existing non-trashed folder with the same name first
      let folder = await findFolderByName(name);
      let folderWasReused = false;

      if (folder?.id) {
        folderWasReused = true;
      } else {
        folder = await createDriveFile({
          name,
          mimeType: 'application/vnd.google-apps.folder',
        });
      }

      if (!folder?.id) {
        throw new Error('Could not resolve or create the target folder.');
      }

      const ids = Array.from(selectedIds);
      let movedCount = 0;
      const skipped403: string[] = [];
      const otherErrors: string[] = [];
      const successfullyMovedIds: string[] = [];

      // Sequential processing with small delay to reduce 429 risk
      for (let i = 0; i < ids.length; i++) {
        const fileId = ids[i];
        try {
          const local = await db.files.get(fileId);
          let currentParents = local?.parents;

          // SAFE PARENT EXTRACTION — never crash on undefined parents
          if (!currentParents || currentParents.length === 0) {
            try {
              const meta = await getDriveFile(fileId, 'id,parents,capabilities,owners');
              currentParents = meta.parents && meta.parents.length > 0 ? meta.parents : [];
            } catch {
              currentParents = [];
            }
          }

          await moveDriveFile(fileId, folder.id, currentParents);

          await db.files.update(fileId, {
            parents: [folder.id],
            modifiedTime: new Date().toISOString(),
            syncStatus: 'synced',
          });

          await db.logAction(
            'MOVE_DUPLICATE',
            fileId,
            local?.name,
            `Moved to folder "${name}" (${folder.id})${folderWasReused ? ' [reused existing]' : ''}`
          );

          movedCount++;
          successfullyMovedIds.push(fileId);
        } catch (moveErr: any) {
          const status = moveErr?.status ?? moveErr?.statusCode;
          const is403 =
            status === 403 ||
            (moveErr instanceof DriveApiError && moveErr.status === 403) ||
            (typeof moveErr?.message === 'string' &&
              (moveErr.message.includes('403') ||
                moveErr.message.toLowerCase().includes('forbidden') ||
                moveErr.message.toLowerCase().includes('insufficient')));

          console.warn(`Move failed for ${fileId}:`, moveErr);

          if (is403) {
            skipped403.push(fileId);
          } else {
            otherErrors.push(fileId);
          }
        }

        if (i < ids.length - 1) {
          await new Promise((r) => setTimeout(r, 120));
        }
      }

      setShowMoveModal(false);
      setSelectedIds(new Set());

      // IMMEDIATE UI STATE SYNC: remove successfully moved files from local summary
      if (successfullyMovedIds.length > 0 && summary) {
        const movedSet = new Set(successfullyMovedIds);
        setSummary((prev) => {
          if (!prev) return prev;
          const newGroups = prev.exactGroups
            .map((g) => ({
              ...g,
              files: g.files.filter((f) => !movedSet.has(f.id)),
            }))
            .filter((g) => g.files.length > 1);
          const totalExactDuplicates = newGroups.reduce(
            (sum, g) => sum + (g.files.length - 1),
            0
          );
          const totalWastedBytes = newGroups.reduce((sum, g) => sum + g.wastedBytes, 0);
          return {
            ...prev,
            exactGroups: newGroups,
            totalExactDuplicates,
            totalWastedBytes,
          };
        });
      }

      const parts: string[] = [];
      if (movedCount > 0) {
        parts.push(
          `Moved ${movedCount} file(s) into "${name}"${folderWasReused ? ' (existing folder reused)' : ''}.`
        );
      }
      if (skipped403.length > 0) {
        parts.push(
          `${skipped403.length} shared/unowned file(s) skipped (403 — no permission to move).`
        );
      }
      if (otherErrors.length > 0) {
        parts.push(`${otherErrors.length} file(s) failed for other reasons.`);
      }
      if (parts.length === 0) {
        showNotice('No files could be moved. Check permissions and try again.', 'error');
      } else {
        const type =
          skipped403.length > 0 || otherErrors.length > 0
            ? movedCount > 0
              ? 'info'
              : 'error'
            : 'success';
        showNotice(parts.join(' '), type);
      }
    } catch (err: any) {
      console.error('Move selected failed:', err);
      setFolderNameError(err?.message || 'Failed to create folder or move files.');
      showNotice(err?.message || 'Failed to move selected files.', 'error');
    } finally {
      setIsMoving(false);
    }
  };

  return (
    <div className="space-y-6">
      {actionNotice && (
        <div
          role="status"
          aria-live="polite"
          className={`p-3 border rounded-xl text-xs flex items-center justify-between shadow-lg ${
            actionNotice.type === 'success'
              ? 'bg-emerald-950/80 border-emerald-800/60 text-emerald-200'
              : actionNotice.type === 'error'
                ? 'bg-rose-950/80 border-rose-800/60 text-rose-200'
                : 'bg-blue-950/80 border-blue-800/60 text-blue-200'
          }`}
        >
          <span>{actionNotice.message}</span>
          <button
            type="button"
            onClick={() => setActionNotice(null)}
            className="ml-3 font-medium opacity-80 hover:opacity-100"
            aria-label="Dismiss notification"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="p-5 bg-neutral-900/90 border border-neutral-800 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
            <Copy className="w-5 h-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-neutral-100 flex items-center gap-2">
              <span>Drive Deduplication Engine</span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-950 border border-amber-800/60 text-amber-300">
                O(n) Buckets + AI Cosine
              </span>
            </h2>
            <p className="text-xs text-neutral-400 mt-0.5">
              Identify redundant file uploads, conflicting revisions, and renamed Google Docs copies.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleRunScan}
            disabled={isScanning || isProcessingAction || isMoving}
            className="flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white transition shadow-sm"
            aria-label="Re-scan for duplicates"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>{isScanning ? 'Analyzing Drive Files...' : 'Re-scan Duplicates'}</span>
          </button>

          {summary && summary.totalExactDuplicates > 0 && (
            <button
              type="button"
              onClick={handleTrashAllExactRedundant}
              disabled={isProcessingAction || isMoving}
              className="flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-xl bg-rose-600/90 hover:bg-rose-500 disabled:opacity-40 text-white transition shadow-sm"
              aria-label={`Clean all ${summary.totalExactDuplicates} exact duplicates`}
            >
              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Clean All Exact ({summary.totalExactDuplicates})</span>
            </button>
          )}
        </div>
      </div>

      {/* Rest of UI remains identical to previous safe implementation — filters, sorting, checkboxes, Show links, modal */}
      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="p-4 bg-neutral-900/50 border border-neutral-800 rounded-xl">
            <span className="text-neutral-500 text-[11px] uppercase tracking-wider font-semibold block">Exact Binary Duplicates</span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-bold text-neutral-100">{summary.totalExactDuplicates}</span>
              <span className="text-xs text-neutral-400">in {summary.exactGroups.length} groups</span>
            </div>
          </div>
          <div className="p-4 bg-neutral-900/50 border border-neutral-800 rounded-xl">
            <span className="text-neutral-500 text-[11px] uppercase tracking-wider font-semibold block">Semantic Doc Duplicates</span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-bold text-purple-300">{summary.totalSemanticDuplicates}</span>
              <span className="text-xs text-neutral-400">correlated pairs</span>
            </div>
          </div>
          <div className="p-4 bg-neutral-900/50 border border-neutral-800 rounded-xl">
            <span className="text-neutral-500 text-[11px] uppercase tracking-wider font-semibold block">Potential Storage Recoverable</span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-bold text-emerald-400">{formatBytes(summary.totalWastedBytes)}</span>
              <span className="text-xs text-neutral-400">redundant data</span>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-neutral-800 pb-3 gap-3">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setActiveSubTab('exact')} className={`px-3.5 py-1.5 rounded-xl text-xs font-medium transition ${activeSubTab === 'exact' ? 'bg-amber-600/20 border border-amber-500/40 text-amber-300' : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900'}`} aria-pressed={activeSubTab === 'exact'}>
            Exact Binary Copies ({summary?.exactGroups.length || 0})
          </button>
          <button type="button" onClick={() => setActiveSubTab('semantic')} className={`px-3.5 py-1.5 rounded-xl text-xs font-medium transition flex items-center gap-1.5 ${activeSubTab === 'semantic' ? 'bg-purple-600/20 border border-purple-500/40 text-purple-300' : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900'}`} aria-pressed={activeSubTab === 'semantic'}>
            <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Semantic Docs & Copies ({summary?.semanticPairs.length || 0})</span>
          </button>
        </div>
        {activeSubTab === 'semantic' && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-neutral-400 text-[11px]">Min Match: <span className="font-mono text-purple-300 font-bold">{Math.round(semanticThreshold * 100)}%</span></span>
            <input type="range" min="0.70" max="0.95" step="0.02" value={semanticThreshold} onChange={(e) => setSemanticThreshold(parseFloat(e.target.value))} onMouseUp={handleRunScan} onTouchEnd={handleRunScan} className="w-20 accent-purple-500 cursor-pointer" aria-label="Semantic similarity threshold" />
          </div>
        )}
      </div>

      {activeSubTab === 'exact' && (
        <div className="space-y-4">
          {summary && summary.exactGroups.length > 0 && (
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 p-3 bg-neutral-900/60 border border-neutral-800 rounded-xl">
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={toggleSelectAll} className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-neutral-700 hover:border-amber-600/60 hover:bg-amber-950/30 text-neutral-300 transition" aria-pressed={allSelected} aria-label={allSelected ? 'Deselect all files' : 'Select all files'}>
                  {allSelected ? <CheckSquare className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" /> : someSelected ? <CheckSquare className="w-3.5 h-3.5 text-amber-400/60" aria-hidden="true" /> : <Square className="w-3.5 h-3.5" aria-hidden="true" />}
                  <span>{allSelected ? 'Deselect All' : 'Select All'}</span>
                  {selectedIds.size > 0 && <span className="ml-1 text-[10px] font-mono text-amber-300">({selectedIds.size})</span>}
                </button>
                <button type="button" onClick={openMoveModal} disabled={selectedIds.size === 0 || isMoving || isProcessingAction} className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-sky-700/90 hover:bg-sky-600 disabled:opacity-40 text-white transition" aria-label="Move selected files to a custom folder">
                  {isMoving ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <Move className="w-3.5 h-3.5" aria-hidden="true" />}
                  <span>Move Selected</span>
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1.5 text-xs text-neutral-400">
                  <Filter className="w-3.5 h-3.5" aria-hidden="true" />
                  <label htmlFor="type-filter" className="sr-only">Filter by file type</label>
                  <select id="type-filter" value={fileTypeFilter} onChange={(e) => setFileTypeFilter(e.target.value as FileTypeFilter)} className="bg-neutral-950 border border-neutral-700 rounded-lg px-2 py-1.5 text-xs text-neutral-200 focus:outline-none focus:ring-1 focus:ring-amber-500">
                    <option value="all">All Types</option>
                    <option value="document">Documents</option>
                    <option value="image">Images</option>
                    <option value="spreadsheet">Spreadsheets</option>
                  </select>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-neutral-400">
                  <label htmlFor="size-filter" className="sr-only">Filter by file size</label>
                  <select id="size-filter" value={sizeFilter} onChange={(e) => setSizeFilter(e.target.value as SizeFilter)} className="bg-neutral-950 border border-neutral-700 rounded-lg px-2 py-1.5 text-xs text-neutral-200 focus:outline-none focus:ring-1 focus:ring-amber-500">
                    <option value="all">All Sizes</option>
                    <option value="lt1mb">< 1 MB</option>
                    <option value="1to10mb">1 – 10 MB</option>
                    <option value="gt10mb">> 10 MB</option>
                  </select>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-neutral-400">
                  <ArrowUpDown className="w-3.5 h-3.5" aria-hidden="true" />
                  <label htmlFor="sort-key" className="sr-only">Sort duplicates</label>
                  <select id="sort-key" value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} className="bg-neutral-950 border border-neutral-700 rounded-lg px-2 py-1.5 text-xs text-neutral-200 focus:outline-none focus:ring-1 focus:ring-amber-500">
                    <option value="size-largest">Size: Largest</option>
                    <option value="size-smallest">Size: Smallest</option>
                    <option value="name-asc">Name: A → Z</option>
                    <option value="name-desc">Name: Z → A</option>
                    <option value="modified-newest">Modified: Newest</option>
                    <option value="modified-oldest">Modified: Oldest</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {(!summary || displayedExactGroups.length === 0) ? (
            <div className="p-10 border border-dashed border-neutral-800 rounded-2xl text-center space-y-2 bg-neutral-900/20">
              <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto" aria-hidden="true" />
              <h4 className="text-sm font-semibold text-neutral-200">{summary && summary.exactGroups.length > 0 ? 'No groups match the current filters' : 'No exact binary duplicates found'}</h4>
              <p className="text-xs text-neutral-500 max-w-sm mx-auto">{summary && summary.exactGroups.length > 0 ? 'Try adjusting the file type or size filters.' : 'All files indexed in your Dexie database have unique size and MD5 hash signatures.'}</p>
            </div>
          ) : (
            <div className="space-y-4">
              {displayedExactGroups.map((group, idx) => (
                <div key={group.bucketKey} className="bg-neutral-900/40 border border-neutral-800 rounded-2xl p-4 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-neutral-800/80 pb-2.5">
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-lg bg-amber-500/20 text-amber-400 font-bold text-xs flex items-center justify-center">#{idx + 1}</span>
                      <div>
                        <span className="text-xs font-semibold text-neutral-200">{group.files.length} Identical Copies Found</span>
                        <div className="flex items-center gap-2 text-[10px] text-neutral-500 font-mono mt-0.5">
                          <span>Size: {formatBytes(group.size)}</span><span>•</span><span>MD5: {group.md5Checksum}</span>
                        </div>
                      </div>
                    </div>
                    <button type="button" onClick={() => handleTrashRedundantExact(group)} disabled={isProcessingAction || isMoving} className="flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg bg-rose-950/60 border border-rose-800/60 text-rose-300 hover:bg-rose-900/60 transition disabled:opacity-40" aria-label={`Trash ${group.files.length - 1} redundant copies`}>
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" /><span>Trash {group.files.length - 1} Redundant Copies</span>
                    </button>
                  </div>
                  <div className="divide-y divide-neutral-800/40 text-xs">
                    {group.files.map((file, fIdx) => {
                      const isSelected = selectedIds.has(file.id);
                      const matchesCurrentFilters = matchesFileType(file, fileTypeFilter) && matchesSize(file, sizeFilter);
                      return (
                        <div key={file.id} className={`py-2.5 flex items-center justify-between gap-2 px-2 rounded-lg transition ${isSelected ? 'bg-amber-950/30' : 'hover:bg-neutral-800/20'} ${!matchesCurrentFilters ? 'opacity-50' : ''}`}>
                          <div className="flex items-center gap-2.5 min-w-0 flex-1">
                            <input type="checkbox" checked={isSelected} onChange={() => toggleFileSelection(file.id)} className="w-4 h-4 rounded border-neutral-600 bg-neutral-900 text-amber-500 focus:ring-amber-500 focus:ring-offset-0 cursor-pointer shrink-0" aria-label={`Select ${file.name}`} />
                            {getFileIcon(file.mimeType)}
                            <div className="min-w-0 truncate">
                              <span className="font-medium text-neutral-200 block truncate">{file.name}</span>
                              <span className="font-mono text-[10px] text-neutral-500 block truncate">ID: {file.id} • Modified: {new Date(file.modifiedTime).toLocaleDateString()} • {formatBytes(file.size)}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <a href={getWebViewLink(file)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] font-medium text-sky-400 hover:text-sky-300 transition px-2 py-1 rounded-md hover:bg-sky-950/40" aria-label={`Open ${file.name} in Google Drive`}>
                              <ExternalLink className="w-3 h-3" aria-hidden="true" /><span>Show</span>
                            </a>
                            {fIdx === 0 ? (
                              <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-950/80 border border-emerald-800/60 px-2 py-0.5 rounded-full">Primary (Retained)</span>
                            ) : (
                              <span className="text-[10px] font-semibold text-amber-400 bg-amber-950/80 border border-amber-800/60 px-2 py-0.5 rounded-full">Duplicate Copy</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeSubTab === 'semantic' && (
        <div className="space-y-4">
          {(!summary || summary.semanticPairs.length === 0) ? (
            <div className="p-10 border border-dashed border-neutral-800 rounded-2xl text-center space-y-2 bg-neutral-900/20">
              <CheckCircle2 className="w-8 h-8 text-purple-400 mx-auto" aria-hidden="true" />
              <h4 className="text-sm font-semibold text-neutral-200">No semantic duplicate pairs detected</h4>
              <p className="text-xs text-neutral-500 max-w-sm mx-auto">No Google Workspace documents exceeded the similarity threshold of {Math.round(semanticThreshold * 100)}%.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {summary.semanticPairs.map((pair) => (
                <div key={pair.id} className="bg-neutral-900/40 border border-purple-900/30 rounded-2xl p-4 space-y-3 hover:border-purple-800/50 transition">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-neutral-800/80 pb-2.5">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-neutral-200 flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-purple-400" aria-hidden="true" />
                        <span>Semantic Match:</span>
                        <span className="font-mono text-purple-300 font-bold">{pair.similarityPercentage}% Similarity</span>
                      </span>
                    </div>
                    <span className="text-[11px] text-neutral-400 italic">{pair.explanation}</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs pt-1">
                    <div className="p-3 bg-neutral-950/80 border border-neutral-800 rounded-xl space-y-2">
                      <div className="flex items-start gap-2.5">
                        <div className="mt-0.5">{getFileIcon(pair.fileA.mimeType)}</div>
                        <div className="min-w-0 flex-1">
                          <span className="font-medium text-neutral-100 block truncate">{pair.fileA.name}</span>
                          <span className="font-mono text-[10px] text-neutral-500 block truncate">ID: {pair.fileA.id}</span>
                          <span className="text-[10px] text-neutral-400 block mt-0.5">Modified: {new Date(pair.fileA.modifiedTime).toLocaleDateString()}</span>
                        </div>
                      </div>
                      <div className="flex justify-between items-center pt-1">
                        <a href={getWebViewLink(pair.fileA)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] text-sky-400 hover:text-sky-300" aria-label={`Open ${pair.fileA.name}`}><ExternalLink className="w-3 h-3" aria-hidden="true" />Show</a>
                        <button type="button" onClick={() => handleTrashSemanticFile(pair.fileA, pair.fileB)} disabled={isProcessingAction} className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-lg border border-neutral-700 hover:border-rose-700 hover:bg-rose-950/40 text-neutral-400 hover:text-rose-300 transition disabled:opacity-40"><Trash2 className="w-3 h-3" aria-hidden="true" /><span>Trash File A</span></button>
                      </div>
                    </div>
                    <div className="p-3 bg-neutral-950/80 border border-neutral-800 rounded-xl space-y-2">
                      <div className="flex items-start gap-2.5">
                        <div className="mt-0.5">{getFileIcon(pair.fileB.mimeType)}</div>
                        <div className="min-w-0 flex-1">
                          <span className="font-medium text-neutral-100 block truncate">{pair.fileB.name}</span>
                          <span className="font-mono text-[10px] text-neutral-500 block truncate">ID: {pair.fileB.id}</span>
                          <span className="text-[10px] text-neutral-400 block mt-0.5">Modified: {new Date(pair.fileB.modifiedTime).toLocaleDateString()}</span>
                        </div>
                      </div>
                      <div className="flex justify-between items-center pt-1">
                        <a href={getWebViewLink(pair.fileB)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] text-sky-400 hover:text-sky-300" aria-label={`Open ${pair.fileB.name}`}><ExternalLink className="w-3 h-3" aria-hidden="true" />Show</a>
                        <button type="button" onClick={() => handleTrashSemanticFile(pair.fileB, pair.fileA)} disabled={isProcessingAction} className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-lg border border-neutral-700 hover:border-rose-700 hover:bg-rose-950/40 text-neutral-400 hover:text-rose-300 transition disabled:opacity-40"><Trash2 className="w-3 h-3" aria-hidden="true" /><span>Trash File B</span></button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showMoveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="move-modal-title">
          <div className="w-full max-w-md bg-neutral-900 border border-neutral-700 rounded-2xl shadow-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 id="move-modal-title" className="text-sm font-semibold text-neutral-100">Move {selectedIds.size} file(s) to a custom folder</h3>
              <button type="button" onClick={() => !isMoving && setShowMoveModal(false)} disabled={isMoving} className="p-1 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition disabled:opacity-40" aria-label="Close modal"><X className="w-4 h-4" aria-hidden="true" /></button>
            </div>
            <p className="text-xs text-neutral-400">If a folder with this name already exists it will be reused (no duplicate folders). Selected files will be moved into it.</p>
            <div>
              <label htmlFor="folder-name" className="block text-xs font-medium text-neutral-300 mb-1.5">Folder name</label>
              <input id="folder-name" type="text" value={folderNameInput} onChange={(e) => { setFolderNameInput(e.target.value); setFolderNameError(null); }} onKeyDown={(e) => { if (e.key === 'Enter' && !isMoving) handleMoveSelected(); }} placeholder="e.g. Duplicates Review 2026" disabled={isMoving} className="w-full px-3 py-2 text-sm bg-neutral-950 border border-neutral-700 rounded-xl text-neutral-100 placeholder:text-neutral-600 focus:outline-none focus:ring-2 focus:ring-sky-500/60 disabled:opacity-50" autoFocus aria-invalid={!!folderNameError} aria-describedby={folderNameError ? 'folder-error' : undefined} />
              {folderNameError && <p id="folder-error" className="mt-1.5 text-xs text-rose-400" role="alert">{folderNameError}</p>}
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button type="button" onClick={() => setShowMoveModal(false)} disabled={isMoving} className="px-4 py-2 text-xs font-medium rounded-xl border border-neutral-700 text-neutral-300 hover:bg-neutral-800 transition disabled:opacity-40">Cancel</button>
              <button type="button" onClick={handleMoveSelected} disabled={isMoving || !folderNameInput.trim()} className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-xl bg-sky-600 hover:bg-sky-500 text-white transition disabled:opacity-40">
                {isMoving ? (<><Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /><span>Moving…</span></>) : (<><Move className="w-3.5 h-3.5" aria-hidden="true" /><span>Create / Reuse & Move</span></>)}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
