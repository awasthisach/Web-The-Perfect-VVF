/// src/lib/duplicateEngine.ts ///
import { db, type FileRecord } from './db';
import { getSemanticWorker, computeVectorSimilarity, ensureFilesEmbedded } from './searchEngine';

export interface ExactDuplicateGroup {
  bucketKey: string; // `${size}_${md5Checksum}`
  size: number;
  md5Checksum: string;
  files: FileRecord[];
  wastedBytes: number; // size * (files.length - 1)
}

export interface SemanticDuplicatePair {
  id: string; // pair key
  fileA: FileRecord;
  fileB: FileRecord;
  similarityScore: number;
  similarityPercentage: number;
  explanation: string;
}

export interface DeduplicationSummary {
  exactGroups: ExactDuplicateGroup[];
  semanticPairs: SemanticDuplicatePair[];
  totalExactDuplicates: number;
  totalSemanticDuplicates: number;
  totalWastedBytes: number;
}

/**
 * Step 1: O(n) Bucket Algorithm using Map by `size` + `md5Checksum`
 * Fast, deterministic identification of bit-for-bit identical files.
 */
export async function findExactDuplicates(): Promise<ExactDuplicateGroup[]> {
  const allFiles = await db.files.filter((f) => !f.trashed).toArray();
  const bucketMap = new Map<string, FileRecord[]>();

  for (const file of allFiles) {
    // We only group files with valid sizes and checksums
    if (file.size !== undefined && file.md5Checksum) {
      const key = `${file.size}_${file.md5Checksum.toLowerCase()}`;
      const existing = bucketMap.get(key);
      if (existing) {
        existing.push(file);
      } else {
        bucketMap.set(key, [file]);
      }
    }
  }

  const duplicateGroups: ExactDuplicateGroup[] = [];

  for (const [key, files] of bucketMap.entries()) {
    if (files.length > 1) {
      const size = files[0].size || 0;
      const md5Checksum = files[0].md5Checksum || '';
      duplicateGroups.push({
        bucketKey: key,
        size,
        md5Checksum,
        files,
        wastedBytes: size * (files.length - 1),
      });
    }
  }

  // Sort by highest wasted bytes first
  return duplicateGroups.sort((a, b) => b.wastedBytes - a.wastedBytes);
}

/**
 * Step 2: Semantic Deduplication for Google Workspace Files
 * Identifies potential duplicates, revisions, drafts, and renamed copies
 * in `application/vnd.google-apps.*` or documents using Cosine Similarity > threshold.
 */
export async function findSemanticDuplicates(
  threshold: number = 0.82
): Promise<SemanticDuplicatePair[]> {
  // Ensure files are embedded first
  await ensureFilesEmbedded();

  const allFiles = await db.files.filter((f) => !f.trashed).toArray();

  // Target Google Workspace files and text/docs that have embeddings
  const targetFiles = allFiles.filter(
    (f) => Array.isArray(f.embedding) && f.embedding.length > 0
  );

  const pairs: SemanticDuplicatePair[] = [];
  const processedPairs = new Set<string>();

  // Compare pairwise combinations O(k^2) where k is number of files with embeddings
  for (let i = 0; i < targetFiles.length; i++) {
    const fileA = targetFiles[i];

    for (let j = i + 1; j < targetFiles.length; j++) {
      const fileB = targetFiles[j];

      // Skip identical exact files already captured by Step 1
      if (
        fileA.md5Checksum &&
        fileB.md5Checksum &&
        fileA.md5Checksum.toLowerCase() === fileB.md5Checksum.toLowerCase() &&
        fileA.size === fileB.size
      ) {
        continue;
      }

      const pairKey = [fileA.id, fileB.id].sort().join(':::');
      if (processedPairs.has(pairKey)) continue;
      processedPairs.add(pairKey);

      // Cosine similarity
      const score = await computeVectorSimilarity(
        fileA.embedding as number[],
        fileB.embedding as number[]
      );

      if (score >= threshold) {
        const percentage = Math.round(score * 100);
        let reason = 'High semantic similarity in document title & classification.';

        if (fileA.name.toLowerCase() === fileB.name.toLowerCase()) {
          reason = 'Identical document titles across distinct Drive file IDs.';
        } else if (
          fileA.name.toLowerCase().includes('copy') ||
          fileB.name.toLowerCase().includes('copy') ||
          fileA.name.toLowerCase().includes('draft') ||
          fileB.name.toLowerCase().includes('draft') ||
          fileA.name.toLowerCase().includes('v1') ||
          fileB.name.toLowerCase().includes('v2')
        ) {
          reason = 'Possible version/draft iteration or copy with modified title.';
        }

        pairs.push({
          id: pairKey,
          fileA,
          fileB,
          similarityScore: score,
          similarityPercentage: percentage,
          explanation: reason,
        });
      }
    }
  }

  // Sort by highest similarity first
  return pairs.sort((a, b) => b.similarityScore - a.similarityScore);
}

/**
 * Execute full scan: Exact binary buckets + Semantic comparison
 */
export async function runFullDuplicateScan(
  semanticThreshold: number = 0.82
): Promise<DeduplicationSummary> {
  const [exactGroups, semanticPairs] = await Promise.all([
    findExactDuplicates(),
    findSemanticDuplicates(semanticThreshold),
  ]);

  const totalExactDuplicates = exactGroups.reduce(
    (sum, group) => sum + (group.files.length - 1),
    0
  );
  const totalWastedBytes = exactGroups.reduce(
    (sum, group) => sum + group.wastedBytes,
    0
  );

  await db.logAction(
    'DUPLICATE_SCAN_COMPLETE',
    'SYSTEM',
    undefined,
    `Scan found ${exactGroups.length} exact duplicate buckets (${totalExactDuplicates} redundant files) and ${semanticPairs.length} semantic duplicate pairs.`
  );

  return {
    exactGroups,
    semanticPairs,
    totalExactDuplicates,
    totalSemanticDuplicates: semanticPairs.length,
    totalWastedBytes,
  };
}

/**
 * Trashes redundant duplicate files in Dexie and queues them for Drive API sync.
 * Retains the primary file (first in group or oldest).
 */
export async function trashRedundantFiles(
  filesToTrash: FileRecord[],
  reason: string
): Promise<number> {
  let trashedCount = 0;

  for (const file of filesToTrash) {
    await db.files.update(file.id, {
      trashed: true,
      modifiedTime: new Date().toISOString(),
      syncStatus: 'pending',
    });

    await db.enqueueSync('trash', { id: file.id, trashed: true }, file.id);

    await db.logAction(
      'TRASH_DUPLICATE',
      file.id,
      file.name,
      `Auto-trashed duplicate: ${reason}`
    );

    trashedCount++;
  }

  return trashedCount;
}
