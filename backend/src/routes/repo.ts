import { Router, Request, Response } from 'express';
import { pool } from '../config/db.js';
import { addIndexingJob } from '../services/queue.js';
import { deleteCollection } from '../services/qdrant.js';

const router = Router();

// 1. Get all repositories
router.get('/repos', async (req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT * FROM repositories ORDER BY created_at DESC');
    res.json({ repositories: result.rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message || String(error) });
  }
});

// 2. Add new repository and queue indexing
router.post('/repos', async (req: Request, res: Response) => {
  const { githubUrl } = req.body;
  if (!githubUrl) {
    res.status(400).json({ error: 'githubUrl is required.' });
    return;
  }

  try {
    // Basic extraction of repository name from URL (e.g. https://github.com/owner/repo)
    const urlParts = githubUrl.replace(/\/$/, '').split('/');
    const repoName = urlParts.length >= 2 ? urlParts[urlParts.length - 1] : 'unknown-repo';

    // Insert repository record
    const insertResult = await pool.query(
      'INSERT INTO repositories (github_url, name, status) VALUES ($1, $2, $3) ON CONFLICT (github_url) DO UPDATE SET status = $3 RETURNING *',
      [githubUrl, repoName, 'idle']
    );

    const repo = insertResult.rows[0];

    // Add initial indexing job to BullMQ
    console.log(`[Repo API] Queued initial indexing for Repo ${repo.id} (${githubUrl})`);
    await addIndexingJob(repo.id, githubUrl);

    res.status(201).json({ message: 'Repository added and queued for indexing.', repository: repo });
  } catch (error: any) {
    console.error('[Repo API] Failed to add repository:', error);
    res.status(500).json({ error: error.message || String(error) });
  }
});

// 3. Trigger manual re-index
router.post('/repos/:id/reindex', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const result = await pool.query('SELECT * FROM repositories WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Repository not found.' });
      return;
    }

    const repo = result.rows[0];
    
    // Update status to idle
    await pool.query('UPDATE repositories SET status = $1 WHERE id = $2', ['idle', id]);
    
    // Add indexing job
    console.log(`[Repo API] Queued manual reindexing for Repo ${id} (${repo.github_url})`);
    await addIndexingJob(repo.id, repo.github_url);

    res.json({ message: 'Repository queued for re-indexing.', repository: repo });
  } catch (error: any) {
    res.status(500).json({ error: error.message || String(error) });
  }
});

// 4. Delete repository (cleans up Postgres, Qdrant and local clones)
router.delete('/repos/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    console.log(`[Repo API] Deleting Repo ${id}...`);
    // Delete Qdrant collection
    await deleteCollection(id);

    // Delete Postgres record (cascade deletes index_logs and chat_history)
    await pool.query('DELETE FROM repositories WHERE id = $1', [id]);

    res.json({ message: 'Repository deleted successfully.' });
  } catch (error: any) {
    res.status(500).json({ error: error.message || String(error) });
  }
});

// 5. Get indexing logs for a repository
router.get('/repos/:id/logs', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      'SELECT * FROM index_logs WHERE repo_id = $1 ORDER BY created_at DESC',
      [id]
    );
    res.json({ logs: result.rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message || String(error) });
  }
});

export default router;
