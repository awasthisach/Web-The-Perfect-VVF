/// src/components/DuplicateFinder.tsx ///
import React, { useState, useEffect } from 'react';
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
  Copy,
  Trash2,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  Folder,
  FileCode,
  FileText,
  Sparkles,
  ArrowRight,
  ShieldAlert,
  HardDrive,
  Sliders,
  Lock,
} from 'lucide-react';

export const DuplicateFinder: React.FC = () => {
  const [activeSubTab, setActiveSubTab] = useState<'exact' | 'semantic'>('exact');
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [semanticThreshold, setSemanticThreshold] = useState<number>(0.82);
  const [summary, setSummary] = useState<DeduplicationSummary | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [isProcessingAction, setIsProcessingAction] = useState<boolean>(false);

  // Re-fetch files from Dexie live query
  const files = useLiveQuery(() => db.files.toArray(), []);

  // Run duplicate scan
  const handleRunScan = async () => {
    setIsScanning(true);
    try {
      const res = await runFullDuplicateScan(semanticThreshold);
      setSummary(res);
      setActionNotice(
        `Scan finished: identified ${res.exactGroups.length} exact duplicate groups and ${res.semanticPairs.length} semantic duplicate pairs.`
      );
    } catch (err) {
      console.error('Duplicate scan error:', err);
      setActionNotice('Failed to complete duplicate scan. Check console for details.');
    } finally {
      setIsScanning(false);
    }
  };

  // Run initial scan automatically if not yet run
  useEffect(() => {
    if (files && files.length > 0 && !summary && !isScanning) {
      handleRunScan();
    }
  }, [files?.length]);

  // Trash redundant copies in an exact duplicate group (keeps oldest/first file)
  const handleTrashRedundantExact = async (group: ExactDuplicateGroup) => {
    if (group.files.length <= 1) return;
    setIsProcessingAction(true);

    try {
      // Keep the first file, trash all others
      const toTrash = group.files.slice(1);
      const count = await trashRedundantFiles(
        toTrash,
        `Exact binary duplicate of "${group.files[0].name}" (MD5: ${group.md5Checksum.substring(0, 8)})`
      );

      setActionNotice(`Successfully trashed ${count} redundant copies. 1 primary copy retained.`);
      // Refresh scan
      handleRunScan();
    } catch (err) {
      console.error('Error trashing duplicate files:', err);
    } finally {
      setIsProcessingAction(false);
    }
  };

  // Trash all redundant files across all exact groups at once
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

      const count = await trashRedundantFiles(
        allToTrash,
        'Bulk cleanup of all exact binary duplicates.'
      );

      setActionNotice(`Cleaned up ${count} redundant duplicate files and recovered offline space.`);
      handleRunScan();
    } catch (err) {
      console.error('Error cleaning exact duplicates:', err);
    } finally {
      setIsProcessingAction(false);
    }
  };

  // Trash one specific file from a semantic pair
  const handleTrashSemanticFile = async (file: FileRecord, otherFile: FileRecord) => {
    setIsProcessingAction(true);
    try {
      await trashRedundantFiles([file], `Semantic duplicate of "${otherFile.name}"`);
      setActionNotice(`Moved "${file.name}" to trash.`);
      handleRunScan();
    } catch (err) {
      console.error('Error trashing file:', err);
    } finally {
      setIsProcessingAction(false);
    }
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
      {actionNotice && (
        <div className="p-3 bg-blue-950/80 border border-blue-800/60 rounded-xl text-blue-200 text-xs flex items-center justify-between shadow-lg">
          <span>{actionNotice}</span>
          <button
            type="button"
            onClick={() => setActionNotice(null)}
            className="text-blue-400 hover:text-white font-medium"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Overview Stats Card */}
      <div className="p-5 bg-neutral-900/90 border border-neutral-800 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
            <Copy className="w-5 h-5" />
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

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleRunScan}
            disabled={isScanning || isProcessingAction}
            className="flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white transition shadow-sm"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
            <span>{isScanning ? 'Analyzing Drive Files...' : 'Re-scan Duplicates'}</span>
          </button>

          {summary && summary.totalExactDuplicates > 0 && (
            <button
              type="button"
              onClick={handleTrashAllExactRedundant}
              disabled={isProcessingAction}
              className="flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-xl bg-rose-600/90 hover:bg-rose-500 disabled:opacity-40 text-white transition shadow-sm"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clean All Exact ({summary.totalExactDuplicates})</span>
            </button>
          )}
        </div>
      </div>

      {/* Summary Metrics Row */}
      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="p-4 bg-neutral-900/50 border border-neutral-800 rounded-xl">
            <span className="text-neutral-500 text-[11px] uppercase tracking-wider font-semibold block">
              Exact Binary Duplicates
            </span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-bold text-neutral-100">{summary.totalExactDuplicates}</span>
              <span className="text-xs text-neutral-400">in {summary.exactGroups.length} groups</span>
            </div>
          </div>

          <div className="p-4 bg-neutral-900/50 border border-neutral-800 rounded-xl">
            <span className="text-neutral-500 text-[11px] uppercase tracking-wider font-semibold block">
              Semantic Doc Duplicates
            </span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-bold text-purple-300">{summary.totalSemanticDuplicates}</span>
              <span className="text-xs text-neutral-400">correlated pairs</span>
            </div>
          </div>

          <div className="p-4 bg-neutral-900/50 border border-neutral-800 rounded-xl">
            <span className="text-neutral-500 text-[11px] uppercase tracking-wider font-semibold block">
              Potential Storage Recoverable
            </span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-bold text-emerald-400">
                {formatBytes(summary.totalWastedBytes)}
              </span>
              <span className="text-xs text-neutral-400">redundant data</span>
            </div>
          </div>
        </div>
      )}

      {/* Sub Tab Navigation */}
      <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveSubTab('exact')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-medium transition ${
              activeSubTab === 'exact'
                ? 'bg-amber-600/20 border border-amber-500/40 text-amber-300'
                : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900'
            }`}
          >
            Exact Binary Copies ({summary?.exactGroups.length || 0})
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab('semantic')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-medium transition flex items-center gap-1.5 ${
              activeSubTab === 'semantic'
                ? 'bg-purple-600/20 border border-purple-500/40 text-purple-300'
                : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Semantic Docs & Copies ({summary?.semanticPairs.length || 0})</span>
          </button>
        </div>

        {activeSubTab === 'semantic' && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-neutral-400 text-[11px]">
              Min Match: <span className="font-mono text-purple-300 font-bold">{Math.round(semanticThreshold * 100)}%</span>
            </span>
            <input
              type="range"
              min="0.70"
              max="0.95"
              step="0.02"
              value={semanticThreshold}
              onChange={(e) => setSemanticThreshold(parseFloat(e.target.value))}
              onMouseUp={handleRunScan}
              onTouchEnd={handleRunScan}
              className="w-20 accent-purple-500 cursor-pointer"
            />
          </div>
        )}
      </div>

      {/* Tab 1 Content: Exact Binary Duplicate Groups */}
      {activeSubTab === 'exact' && (
        <div className="space-y-4">
          {(!summary || summary.exactGroups.length === 0) ? (
            <div className="p-10 border border-dashed border-neutral-800 rounded-2xl text-center space-y-2 bg-neutral-900/20">
              <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto" />
              <h4 className="text-sm font-semibold text-neutral-200">No exact binary duplicates found</h4>
              <p className="text-xs text-neutral-500 max-w-sm mx-auto">
                All files indexed in your Dexie database have unique size and MD5 hash signatures.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {summary.exactGroups.map((group, idx) => (
                <div
                  key={group.bucketKey}
                  className="bg-neutral-900/40 border border-neutral-800 rounded-2xl p-4 space-y-3"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-neutral-800/80 pb-2.5">
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-lg bg-amber-500/20 text-amber-400 font-bold text-xs flex items-center justify-center">
                        #{idx + 1}
                      </span>
                      <div>
                        <span className="text-xs font-semibold text-neutral-200">
                          {group.files.length} Identical Copies Found
                        </span>
                        <div className="flex items-center gap-2 text-[10px] text-neutral-500 font-mono mt-0.5">
                          <span>Size: {formatBytes(group.size)}</span>
                          <span>•</span>
                          <span>MD5: {group.md5Checksum}</span>
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleTrashRedundantExact(group)}
                      disabled={isProcessingAction}
                      className="flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg bg-rose-950/60 border border-rose-800/60 text-rose-300 hover:bg-rose-900/60 transition"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Trash {group.files.length - 1} Redundant Copies</span>
                    </button>
                  </div>

                  {/* List of files in bucket */}
                  <div className="divide-y divide-neutral-800/40 text-xs">
                    {group.files.map((file, fIdx) => (
                      <div
                        key={file.id}
                        className="py-2.5 flex items-center justify-between gap-2 hover:bg-neutral-800/20 px-2 rounded-lg"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          {getFileIcon(file.mimeType)}
                          <div className="min-w-0 truncate">
                            <span className="font-medium text-neutral-200 block truncate">
                              {file.name}
                            </span>
                            <span className="font-mono text-[10px] text-neutral-500 block truncate">
                              ID: {file.id} • Modified: {new Date(file.modifiedTime).toLocaleDateString()}
                            </span>
                          </div>
                        </div>

                        <div>
                          {fIdx === 0 ? (
                            <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-950/80 border border-emerald-800/60 px-2 py-0.5 rounded-full">
                              Primary (Retained)
                            </span>
                          ) : (
                            <span className="text-[10px] font-semibold text-amber-400 bg-amber-950/80 border border-amber-800/60 px-2 py-0.5 rounded-full">
                              Duplicate Copy
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 2 Content: Semantic Doc Duplicates */}
      {activeSubTab === 'semantic' && (
        <div className="space-y-4">
          {(!summary || summary.semanticPairs.length === 0) ? (
            <div className="p-10 border border-dashed border-neutral-800 rounded-2xl text-center space-y-2 bg-neutral-900/20">
              <CheckCircle2 className="w-8 h-8 text-purple-400 mx-auto" />
              <h4 className="text-sm font-semibold text-neutral-200">No semantic duplicate pairs detected</h4>
              <p className="text-xs text-neutral-500 max-w-sm mx-auto">
                No Google Workspace documents exceeded the similarity threshold of {Math.round(semanticThreshold * 100)}%.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {summary.semanticPairs.map((pair) => (
                <div
                  key={pair.id}
                  className="bg-neutral-900/40 border border-purple-900/30 rounded-2xl p-4 space-y-3 hover:border-purple-800/50 transition"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-neutral-800/80 pb-2.5">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-neutral-200 flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                        <span>Semantic Match:</span>
                        <span className="font-mono text-purple-300 font-bold">
                          {pair.similarityPercentage}% Similarity
                        </span>
                      </span>
                    </div>

                    <span className="text-[11px] text-neutral-400 italic">
                      {pair.explanation}
                    </span>
                  </div>

                  {/* Compared File Pair */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs pt-1">
                    {/* File A */}
                    <div className="p-3 bg-neutral-950/80 border border-neutral-800 rounded-xl space-y-2">
                      <div className="flex items-start gap-2.5">
                        <div className="mt-0.5">{getFileIcon(pair.fileA.mimeType)}</div>
                        <div className="min-w-0">
                          <span className="font-medium text-neutral-100 block truncate">
                            {pair.fileA.name}
                          </span>
                          <span className="font-mono text-[10px] text-neutral-500 block truncate">
                            ID: {pair.fileA.id}
                          </span>
                          <span className="text-[10px] text-neutral-400 block mt-0.5">
                            Modified: {new Date(pair.fileA.modifiedTime).toLocaleDateString()}
                          </span>
                        </div>
                      </div>

                      <div className="flex justify-end pt-1">
                        <button
                          type="button"
                          onClick={() => handleTrashSemanticFile(pair.fileA, pair.fileB)}
                          disabled={isProcessingAction}
                          className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-lg border border-neutral-700 hover:border-rose-700 hover:bg-rose-950/40 text-neutral-400 hover:text-rose-300 transition"
                        >
                          <Trash2 className="w-3 h-3" />
                          <span>Trash File A</span>
                        </button>
                      </div>
                    </div>

                    {/* File B */}
                    <div className="p-3 bg-neutral-950/80 border border-neutral-800 rounded-xl space-y-2">
                      <div className="flex items-start gap-2.5">
                        <div className="mt-0.5">{getFileIcon(pair.fileB.mimeType)}</div>
                        <div className="min-w-0">
                          <span className="font-medium text-neutral-100 block truncate">
                            {pair.fileB.name}
                          </span>
                          <span className="font-mono text-[10px] text-neutral-500 block truncate">
                            ID: {pair.fileB.id}
                          </span>
                          <span className="text-[10px] text-neutral-400 block mt-0.5">
                            Modified: {new Date(pair.fileB.modifiedTime).toLocaleDateString()}
                          </span>
                        </div>
                      </div>

                      <div className="flex justify-end pt-1">
                        <button
                          type="button"
                          onClick={() => handleTrashSemanticFile(pair.fileB, pair.fileA)}
                          disabled={isProcessingAction}
                          className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-lg border border-neutral-700 hover:border-rose-700 hover:bg-rose-950/40 text-neutral-400 hover:text-rose-300 transition"
                        >
                          <Trash2 className="w-3 h-3" />
                          <span>Trash File B</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
