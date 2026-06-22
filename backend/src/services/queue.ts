import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { pool } from '../config/db.js';
import { cloneRepo, getRepoFiles, cleanupRepo } from './cloner.js';
import { chunkFile } from './chunker.js';
import { generateEmbedding } from './embeddings.js';
import { upsertChunks } from './qdrant.js';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Setup connection shared for BullMQ
console.log(`Initializing Redis client at: ${REDIS_URL}`);
export const redisConnection = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
});

export const indexingQueue = new Queue('repo-indexing', {
  connection: redisConnection as any,
});

export const indexingWorker = new Worker(
  'repo-indexing',
  async (job) => {
    const { repoId, githubUrl } = job.data;
    console.log(`[Worker] Starting indexing job ${job.id} for Repo ${repoId} (${githubUrl})`);

    const startTime = Date.now();
    let filesUpdated = 0;

    try {
      // 1. Update repo status in Postgres to 'indexing'
      await pool.query('UPDATE repositories SET status = $1 WHERE id = $2', ['indexing', repoId]);

      // 2. Clone repository to temp folder
      const cloneDir = await cloneRepo(githubUrl, String(repoId));

      // 3. Read repository files
      const files = await getRepoFiles(cloneDir);
      filesUpdated = files.length;
      console.log(`[Worker] Found ${filesUpdated} files to index in Repo ${repoId}.`);

      const allChunks = [];
      const allChunkTexts = [];

      // 4. Chunk files
      for (const file of files) {
        const chunks = chunkFile(file.relativePath, file.content);
        for (const chunk of chunks) {
          allChunks.push(chunk);
          allChunkTexts.push(chunk.content);
        }
      }

      console.log(`[Worker] Chunked into ${allChunks.length} segments. Fetching embeddings...`);

      if (allChunks.length > 0) {
        // 5. Generate embeddings in concurrent batches to avoid rate limit/socket issues
        const embeddings: number[][] = [];
        const batchSize = 10;
        for (let i = 0; i < allChunks.length; i += batchSize) {
          const batch = allChunkTexts.slice(i, i + batchSize);
          const batchEmbeddings = await Promise.all(
            batch.map((text) => generateEmbedding(text))
          );
          embeddings.push(...batchEmbeddings);
        }

        // 6. Index chunks into Qdrant
        await upsertChunks(repoId, allChunks, embeddings);
      }

      const durationMs = Date.now() - startTime;

      // 7. Update status to 'completed'
      await pool.query(
        'UPDATE repositories SET status = $1, last_indexed_at = NOW() WHERE id = $2',
        ['completed', repoId]
      );

      // 8. Insert record in index_logs
      await pool.query(
        'INSERT INTO index_logs (repo_id, files_updated, duration_ms, status) VALUES ($1, $2, $3, $4)',
        [repoId, filesUpdated, durationMs, 'completed']
      );

      console.log(`[Worker] Ingestion completed successfully in ${durationMs}ms.`);
    } catch (error: any) {
      console.error(`[Worker] Failed to index Repo ${repoId}:`, error);
      const durationMs = Date.now() - startTime;

      // Update repository status to 'failed'
      await pool.query('UPDATE repositories SET status = $1 WHERE id = $2', ['failed', repoId]);

      // Record failure in index_logs
      await pool.query(
        'INSERT INTO index_logs (repo_id, files_updated, duration_ms, status, error_message) VALUES ($1, $2, $3, $4, $5)',
        [repoId, filesUpdated, durationMs, 'failed', error.message || String(error)]
      );

      throw error;
    } finally {
      // 9. Clean up temp folder cloning
      await cleanupRepo(String(repoId));
    }
  },
  { connection: redisConnection as any }
);

export async function addIndexingJob(repoId: number, githubUrl: string) {
  await indexingQueue.add(`index-${repoId}`, { repoId, githubUrl });
}
