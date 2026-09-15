/// src/components/SemanticSearch.tsx ///
import React, { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type FileRecord } from '../lib/db';
import {
  searchHybrid,
  searchSemantic,
  searchLocalDexie,
  ensureFilesEmbedded,
  initializeSemanticModel,
  subscribeModelProgress,
  type SearchResultItem,
  type ModelProgressInfo,
} from '../lib/searchEngine';
import {
  Search,
  Sparkles,
  Cpu,
  RefreshCw,
  Folder,
  FileText,
  FileSpreadsheet,
  FileCode,
  Sliders,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Layers,
  HelpCircle,
  Lock,
} from 'lucide-react';

interface SemanticSearchProps {
  onSelectFile?: (file: FileRecord) => void;
}

export const SemanticSearch: React.FC<SemanticSearchProps> = ({ onSelectFile }) => {
  const [query, setQuery] = useState('');
  const [searchMode, setSearchMode] = useState<'hybrid' | 'semantic' | 'lexical'>('hybrid');
  const [minSimilarity, setMinSimilarity] = useState<number>(0.25);
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isEmbeddingFiles, setIsEmbeddingFiles] = useState(false);
  const [embeddingProgress, setEmbeddingProgress] = useState<{ completed: number; total: number; current: string } | null>(null);
  const [modelStatus, setModelStatus] = useState<string>('Ready');
  const [hasSearched, setHasSearched] = useState(false);

  // Files in Dexie
  const files = useLiveQuery(() => db.files.filter((f) => !f.trashed).toArray(), []);
  const embeddedCount = files?.filter((f) => f.hasEmbedding && f.embedding?.length).length || 0;
  const totalCount = files?.length || 0;

  // Subscribe to worker model progress
  useEffect(() => {
    const unsub = subscribeModelProgress((info: ModelProgressInfo) => {
      if (info.status === 'progress' && info.progress !== undefined) {
        setModelStatus(`Downloading model weights: ${Math.round(info.progress)}%`);
      } else if (info.status === 'ready' || info.status === 'done') {
        setModelStatus('Model ready in Web Worker');
      }
    });
    return unsub;
  }, []);

  // Run search
  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!query.trim()) {
      setResults([]);
      setHasSearched(false);
      return;
    }

    setIsSearching(true);
    setHasSearched(true);

    try {
      let searchResults: SearchResultItem[] = [];

      if (searchMode === 'hybrid') {
        searchResults = await searchHybrid(query, {
          minSimilarity,
          semanticWeight: 0.55,
        });
      } else if (searchMode === 'semantic') {
        searchResults = await searchSemantic(query, minSimilarity, 30);
      } else {
        searchResults = await searchLocalDexie(query);
      }

      setResults(searchResults);
    } catch (err) {
      console.error('Search error:', err);
    } finally {
      setIsSearching(false);
    }
  };

  // Re-run search if mode or slider changes and query is non-empty
  useEffect(() => {
    if (query.trim() && hasSearched) {
      const timer = setTimeout(() => {
        handleSearch();
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [searchMode, minSimilarity]);

  // Bulk embed files with Web Worker
  const handleGenerateEmbeddings = async () => {
    setIsEmbeddingFiles(true);
    setEmbeddingProgress({ completed: 0, total: totalCount - embeddedCount, current: 'Initializing...' });

    try {
      await initializeSemanticModel();
      await ensureFilesEmbedded((completed, total, current) => {
        setEmbeddingProgress({ completed, total, current });
      });
    } catch (err) {
      console.error('Embedding error:', err);
    } finally {
      setIsEmbeddingFiles(false);
      setEmbeddingProgress(null);
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
      {/* Top Banner / System Status */}
      <div className="p-4 bg-neutral-900/90 border border-neutral-800 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-600/20 border border-purple-500/40 flex items-center justify-center text-purple-400">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-neutral-100">Local Semantic AI Search</h2>
              <span className="text-[10px] bg-purple-950 text-purple-300 border border-purple-800/60 px-2 py-0.5 rounded-full font-mono">
                Xenova/all-MiniLM-L6-v2
              </span>
            </div>
            <p className="text-xs text-neutral-400 mt-0.5">
              Zero cloud API dependencies. Runs 100% inside your browser via Web Worker.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right">
            <span className="text-[11px] text-neutral-400 block font-medium">Embedding Coverage</span>
            <span className="text-xs font-mono font-semibold text-purple-300">
              {embeddedCount} / {totalCount} Files ({totalCount ? Math.round((embeddedCount / totalCount) * 100) : 0}%)
            </span>
          </div>

          <button
            type="button"
            onClick={handleGenerateEmbeddings}
            disabled={isEmbeddingFiles || embeddedCount === totalCount}
            className="flex items-center gap-1.5 text-xs font-semibold px-3.5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white transition shadow-sm"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isEmbeddingFiles ? 'animate-spin' : ''}`} />
            <span>{isEmbeddingFiles ? 'Embedding...' : 'Vectorize Files'}</span>
          </button>
        </div>
      </div>

      {/* Embedding in progress notice */}
      {embeddingProgress && (
        <div className="p-3.5 bg-purple-950/40 border border-purple-800/50 rounded-xl text-xs space-y-2">
          <div className="flex items-center justify-between text-purple-200">
            <span className="flex items-center gap-2">
              <Cpu className="w-3.5 h-3.5 text-purple-400 animate-pulse" />
              Vectorizing: <code className="font-mono text-neutral-300">{embeddingProgress.current}</code>
            </span>
            <span className="font-mono text-purple-300 font-bold">
              {embeddingProgress.completed} / {embeddingProgress.total}
            </span>
          </div>
          <div className="w-full bg-neutral-900 rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-purple-500 h-full transition-all duration-200"
              style={{
                width: `${embeddingProgress.total ? (embeddingProgress.completed / embeddingProgress.total) * 100 : 0}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* Search Bar & Search Mode Switcher */}
      <div className="p-4 bg-neutral-900/60 border border-neutral-800 rounded-2xl space-y-4">
        <form onSubmit={handleSearch} className="flex gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-neutral-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Ask anything concept-wise (e.g. 'company financial roadmap', 'architectural diagrams', 'confidential notes')..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full text-xs bg-neutral-950 border border-neutral-700/80 rounded-xl pl-10 pr-4 py-2.5 text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:border-purple-500 shadow-inner"
            />
          </div>

          <button
            type="submit"
            disabled={isSearching || !query.trim()}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white text-xs font-semibold transition"
          >
            {isSearching ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            <span>Search</span>
          </button>
        </form>

        {/* Filter & Algorithm Selector */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1 border-t border-neutral-800/80 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-neutral-400 font-medium text-[11px] uppercase tracking-wider">Engine:</span>
            <div className="flex items-center bg-neutral-950 p-1 rounded-lg border border-neutral-800">
              <button
                type="button"
                onClick={() => setSearchMode('hybrid')}
                className={`px-2.5 py-1 rounded text-xs font-medium transition ${
                  searchMode === 'hybrid'
                    ? 'bg-purple-600 text-white shadow-sm'
                    : 'text-neutral-400 hover:text-neutral-200'
                }`}
              >
                Hybrid (Recommended)
              </button>
              <button
                type="button"
                onClick={() => setSearchMode('semantic')}
                className={`px-2.5 py-1 rounded text-xs font-medium transition ${
                  searchMode === 'semantic'
                    ? 'bg-purple-600 text-white shadow-sm'
                    : 'text-neutral-400 hover:text-neutral-200'
                }`}
              >
                Semantic Only
              </button>
              <button
                type="button"
                onClick={() => setSearchMode('lexical')}
                className={`px-2.5 py-1 rounded text-xs font-medium transition ${
                  searchMode === 'lexical'
                    ? 'bg-purple-600 text-white shadow-sm'
                    : 'text-neutral-400 hover:text-neutral-200'
                }`}
              >
                Lexical (Exact)
              </button>
            </div>
          </div>

          {searchMode !== 'lexical' && (
            <div className="flex items-center gap-3">
              <span className="text-neutral-400 font-medium text-[11px]">
                Min Similarity: <span className="font-mono text-purple-300 font-bold">{Math.round(minSimilarity * 100)}%</span>
              </span>
              <input
                type="range"
                min="0.10"
                max="0.80"
                step="0.05"
                value={minSimilarity}
                onChange={(e) => setMinSimilarity(parseFloat(e.target.value))}
                className="w-24 accent-purple-500 cursor-pointer"
              />
            </div>
          )}
        </div>
      </div>

      {/* Results Section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <h3 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider">
            {hasSearched ? `Search Results (${results.length})` : 'Search Guidance'}
          </h3>
          {hasSearched && (
            <span className="text-[11px] text-neutral-500">
              Sorted by vector cosine similarity & term relevance
            </span>
          )}
        </div>

        {!hasSearched ? (
          <div className="p-8 border border-dashed border-neutral-800 rounded-2xl text-center space-y-3 bg-neutral-900/20">
            <Sparkles className="w-8 h-8 text-purple-400/60 mx-auto" />
            <div className="space-y-1">
              <h4 className="text-sm font-semibold text-neutral-200">Semantic Concept Matching</h4>
              <p className="text-xs text-neutral-400 max-w-md mx-auto">
                Unlike traditional searches that only match exact keywords, Semantic Search understands meaning. Try searching for:
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
              {['finances & revenues', 'security guidelines', 'presentation slides', 'project roadmap'].map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => {
                    setQuery(example);
                    handleSearch();
                  }}
                  className="text-xs bg-neutral-800/80 hover:bg-neutral-800 text-neutral-300 px-3 py-1.5 rounded-lg border border-neutral-700 transition"
                >
                  &quot;{example}&quot;
                </button>
              ))}
            </div>
          </div>
        ) : results.length === 0 ? (
          <div className="p-8 border border-neutral-800 rounded-2xl text-center text-neutral-500 text-xs bg-neutral-900/40">
            <Search className="w-6 h-6 mx-auto mb-2 text-neutral-600" />
            No matches found for &quot;{query}&quot; with current similarity threshold. Try lowering the threshold or vectorizing more files.
          </div>
        ) : (
          <div className="border border-neutral-800 rounded-2xl overflow-hidden bg-neutral-900/40 divide-y divide-neutral-800/60">
            {results.map((item) => (
              <div
                key={item.file.id}
                className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-neutral-800/25 transition text-xs"
              >
                <div className="flex items-start gap-3 min-w-0">
                  <div className="mt-0.5">{getFileIcon(item.file.mimeType)}</div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-neutral-100 truncate text-sm">
                        {item.file.name}
                      </span>
                      {item.file.isVaultLocked && (
                        <span className="inline-flex items-center gap-0.5 text-[9px] bg-indigo-950/90 text-indigo-300 border border-indigo-800/80 px-1.5 py-0.5 rounded shrink-0 font-medium">
                          <Lock className="w-2.5 h-2.5 text-indigo-400" />
                          Vault
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-neutral-400 text-[11px] mt-0.5">
                      <span>{formatBytes(item.file.size)}</span>
                      <span>•</span>
                      <span className="truncate">{item.file.mimeType.replace('application/vnd.google-apps.', 'gsuite/')}</span>
                      <span>•</span>
                      <span className="font-mono text-[10px] text-neutral-500">ID: {item.file.id}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                  {/* Match Type Badge */}
                  <div className="text-right">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                          item.matchType === 'hybrid'
                            ? 'bg-purple-950/80 text-purple-300 border-purple-800/60'
                            : item.matchType === 'semantic'
                            ? 'bg-blue-950/80 text-blue-300 border-blue-800/60'
                            : 'bg-emerald-950/80 text-emerald-300 border-emerald-800/60'
                        }`}
                      >
                        {item.matchType === 'hybrid'
                          ? 'Hybrid Match'
                          : item.matchType === 'semantic'
                          ? 'Semantic Match'
                          : 'Lexical Match'}
                      </span>
                      <span className="font-mono text-xs font-bold text-neutral-200">
                        {item.similarityPercentage}%
                      </span>
                    </div>
                    <span className="text-[10px] text-neutral-500 block">
                      Score: {item.score.toFixed(3)}
                    </span>
                  </div>

                  {onSelectFile && (
                    <button
                      type="button"
                      onClick={() => onSelectFile(item.file)}
                      className="text-xs px-3 py-1.5 rounded-lg border border-neutral-700 hover:bg-neutral-800 text-neutral-300"
                    >
                      View
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
