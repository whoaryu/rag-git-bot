import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { App } from '@octokit/app';
import { Octokit } from '@octokit/rest';
import { pool } from '../config/db.js';
import { chunkFile } from '../services/chunker.js';
import { generateEmbedding } from '../services/embeddings.js';
import { deleteChunksByFilePath, upsertChunks } from '../services/qdrant.js';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const router = Router();

// Setup Octokit App
const appId = process.env.GITHUB_APP_ID;
// Handle escaped newlines in GITHUB_PRIVATE_KEY
const privateKey = process.env.GITHUB_PRIVATE_KEY
  ? process.env.GITHUB_PRIVATE_KEY.replace(/\\n/g, '\n')
  : undefined;
const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;

let octokitApp: App | null = null;
if (appId && privateKey && webhookSecret) {
  console.log('Initializing GitHub App client...');
  octokitApp = new App({
    appId,
    privateKey,
    Octokit: Octokit,
    webhooks: {
      secret: webhookSecret,
    },
  });
} else {
  console.warn('Warning: GitHub App configuration variables are missing. Webhook functionality will be disabled.');
}

// Setup Groq for PR Review
const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY || '',
  baseURL: 'https://api.groq.com/openai/v1',
});
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.1-70b-versatile';

// Signature verification middleware
function verifyGithubSignature(req: Request, res: Response, next: () => void) {
  if (!webhookSecret) {
    return next();
  }

  const signature = req.headers['x-hub-signature-256'] as string;
  if (!signature) {
    res.status(401).json({ error: 'Missing x-hub-signature-256 header' });
    return;
  }

  const rawBody = (req as any).rawBody;
  if (!rawBody) {
    res.status(500).json({ error: 'Raw body not captured for verification' });
    return;
  }

  const hmac = crypto.createHmac('sha256', webhookSecret);
  hmac.update(rawBody);
  const expectedSignature = 'sha256=' + hmac.digest('hex');

  if (signature !== expectedSignature) {
    res.status(401).json({ error: 'Signature verification failed' });
    return;
  }

  next();
}

async function fetchFileContent(octokit: any, owner: string, repo: string, path: string, ref: string): Promise<string> {
  const response = await octokit.rest.repos.getContent({
    owner,
    repo,
    path,
    ref,
  });

  if ('content' in response.data) {
    const base64Content = response.data.content.replace(/\n/g, '');
    return Buffer.from(base64Content, 'base64').toString('utf-8');
  }
  throw new Error(`Path ${path} is not a file or has no content`);
}

router.post('/webhook', verifyGithubSignature, async (req: Request, res: Response) => {
  const event = req.headers['x-github-event'] as string;
  const payload = req.body;

  if (!octokitApp) {
    res.status(500).json({ error: 'GitHub App is not configured.' });
    return;
  }

  console.log(`[Webhook] Received GitHub event: ${event}`);

  try {
    const gitUrl = payload.repository?.html_url || payload.repository?.clone_url;
    if (!gitUrl) {
      res.status(200).send('Payload lacks repository URL, ignored.');
      return;
    }

    // Lookup repo in our database
    const dbResult = await pool.query('SELECT id FROM repositories WHERE github_url = $1', [gitUrl]);
    if (dbResult.rows.length === 0) {
      console.log(`[Webhook] Repository ${gitUrl} not registered in db. Ignoring event.`);
      res.status(200).send('Repository not tracked.');
      return;
    }
    const repoId = dbResult.rows[0].id;
    const installationId = payload.installation?.id;
    if (!installationId) {
      res.status(200).send('No installation ID, ignored.');
      return;
    }

    const octokit = (await octokitApp.getInstallationOctokit(installationId)) as any;

    // 1. Push Event -> Incremental Indexing
    if (event === 'push') {
      const headSha = payload.after;
      const owner = payload.repository.owner.login;
      const repo = payload.repository.name;
      
      console.log(`[Webhook] Processing push event for Repo ${repoId}. Head SHA: ${headSha}`);

      const addedFiles = new Set<string>();
      const modifiedFiles = new Set<string>();
      const removedFiles = new Set<string>();

      // Extract file changes from push commits
      if (payload.commits && Array.isArray(payload.commits)) {
        for (const commit of payload.commits) {
          commit.added?.forEach((f: string) => {
            addedFiles.add(f);
            removedFiles.delete(f); // Added overrides a previous remove in the same push
          });
          commit.modified?.forEach((f: string) => {
            modifiedFiles.add(f);
            removedFiles.delete(f);
          });
          commit.removed?.forEach((f: string) => {
            removedFiles.add(f);
            addedFiles.delete(f);
            modifiedFiles.delete(f);
          });
        }
      }

      const filesToUpdate = Array.from(new Set([...addedFiles, ...modifiedFiles]));
      const filesToDelete = Array.from(removedFiles);
      const totalChanges = filesToUpdate.length + filesToDelete.length;

      if (totalChanges === 0) {
        res.status(200).send('No files changed in commits.');
        return;
      }

      console.log(`[Webhook] Incremental Sync: ${filesToUpdate.length} updates, ${filesToDelete.length} deletes.`);

      const startTime = Date.now();

      // Delete removed files from Qdrant
      for (const filePath of filesToDelete) {
        await deleteChunksByFilePath(repoId, filePath);
      }

      // Re-index updated files
      for (const filePath of filesToUpdate) {
        try {
          await deleteChunksByFilePath(repoId, filePath); // Clear existing chunks first

          const content = await fetchFileContent(octokit, owner, repo, filePath, headSha);
          const chunks = chunkFile(filePath, content);

          if (chunks.length > 0) {
            const chunkTexts = chunks.map((c) => c.content);
            const embeddings = await Promise.all(
              chunkTexts.map((text) => generateEmbedding(text))
            );
            await upsertChunks(repoId, chunks, embeddings);
          }
        } catch (err: any) {
          console.error(`[Webhook] Error indexing file ${filePath} on push:`, err);
        }
      }

      const durationMs = Date.now() - startTime;
      
      // Update repository last indexed timestamp
      await pool.query('UPDATE repositories SET last_indexed_at = NOW() WHERE id = $1', [repoId]);

      // Log push re-indexing
      await pool.query(
        'INSERT INTO index_logs (repo_id, files_updated, duration_ms, status) VALUES ($1, $2, $3, $4)',
        [repoId, totalChanges, durationMs, 'completed']
      );

      console.log(`[Webhook] Incremental push indexing completed in ${durationMs}ms.`);
      res.status(200).send('Incremental push indexing completed.');
      return;
    }

    // 2. Pull Request Event -> Automated AI Review Comments
    if (event === 'pull_request') {
      const action = payload.action;
      if (!['opened', 'synchronize', 'reopened'].includes(action)) {
        res.status(200).send(`PR action ${action} ignored.`);
        return;
      }

      const pullNumber = payload.pull_request.number;
      const headSha = payload.pull_request.head.sha;
      const owner = payload.repository.owner.login;
      const repo = payload.repository.name;

      console.log(`[Webhook] Automated code review requested for PR #${pullNumber} in Repo ${repoId}. SHA: ${headSha}`);

      // Get changed files list in PR
      const filesResponse = await octokit.rest.pulls.listFiles({
        owner,
        repo,
        pull_number: pullNumber,
      });

      const commentsToPost: any[] = [];

      for (const prFile of filesResponse.data) {
        // Skip deleted files or non-code extensions
        if (prFile.status === 'removed' || !prFile.patch) {
          continue;
        }

        try {
          const content = await fetchFileContent(octokit, owner, repo, prFile.filename, headSha);

          const systemPrompt = `You are a strict technical senior developer code reviewer.
Analyze the following source code file and identify critical coding issues, security bugs, leak of secrets, missing error handling, and N+1 SQL queries.

You MUST return ONLY a valid JSON object matching the schema below. No other text, markdown wrapper, or explanation is allowed.
JSON Schema:
{
  "issues": [{
    "file": string,
    "line": number,
    "type": "bug" | "security" | "n+1" | "error-handling" | "style",
    "severity": "high" | "medium" | "low",
    "suggestion": string
  }]
}

Constraint:
- suggestion MUST be max 2 sentences and highly actionable.
- Flag ONLY real issues. If no critical issues are found, return an empty "issues" list.
`;

          const userPrompt = `File Name: ${prFile.filename}
File Content:
\`\`\`
${content}
\`\`\`
`;

          const aiResponse = await groq.chat.completions.create({
            model: GROQ_MODEL,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            response_format: { type: 'json_object' },
          });

          const jsonText = aiResponse.choices[0]?.message?.content || '{}';
          const reviewOutput = JSON.parse(jsonText);

          if (reviewOutput && Array.isArray(reviewOutput.issues)) {
            for (const issue of reviewOutput.issues) {
              // Quality gate: skip low severity issues
              if (issue.severity === 'low') {
                continue;
              }

              commentsToPost.push({
                path: prFile.filename,
                line: issue.line || 1,
                body: `**[AI Review - ${issue.type.toUpperCase()} - Severity: ${issue.severity.toUpperCase()}]**\n\n${issue.suggestion}`,
              });
            }
          }

        } catch (fileErr) {
          console.error(`[Webhook] Error reviewing file ${prFile.filename}:`, fileErr);
        }
      }

      if (commentsToPost.length > 0) {
        console.log(`[Webhook] Posting ${commentsToPost.length} review comments to PR #${pullNumber}...`);
        await octokit.rest.pulls.createReview({
          owner,
          repo,
          pull_number: pullNumber,
          event: 'COMMENT',
          comments: commentsToPost,
        });
      } else {
        console.log(`[Webhook] Review complete for PR #${pullNumber}. No issues met the severity gate.`);
      }

      res.status(200).send('PR Review completed.');
      return;
    }

    res.status(200).send('Event received but no action required.');
  } catch (error: any) {
    console.error('[Webhook] Error handling event:', error);
    res.status(500).json({ error: error.message || String(error) });
  }
});

export default router;
