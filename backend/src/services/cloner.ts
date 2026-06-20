import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { shouldSkip } from './chunker.js';

const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function cloneRepo(url: string, repoId: string): Promise<string> {
  const targetDir = path.resolve(__dirname, '../../temp_clones', repoId);
  
  // Ensure target folder exists
  await fs.mkdir(path.dirname(targetDir), { recursive: true });
  
  // Clean up if the target dir already exists
  await cleanupRepo(repoId);
  
  console.log(`Cloning ${url} to ${targetDir}...`);
  // Clone depth 1 (shallow clone)
  await execAsync(`git clone --depth 1 "${url}" "${targetDir}"`);
  return targetDir;
}

export async function cleanupRepo(repoId: string): Promise<void> {
  const targetDir = path.resolve(__dirname, '../../temp_clones', repoId);
  try {
    await fs.rm(targetDir, { recursive: true, force: true });
    console.log(`Cleaned up directory: ${targetDir}`);
  } catch (err) {
    console.warn(`Warning: Failed to delete path ${targetDir}:`, err);
  }
}

export async function getRepoFiles(
  dir: string,
  baseDir: string = dir
): Promise<{ relativePath: string; content: string }[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const results: { relativePath: string; content: string }[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    // Use relative path for shouldSkip matching
    const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, '/');

    if (shouldSkip(relativePath)) {
      continue;
    }

    if (entry.isDirectory()) {
      const subDirFiles = await getRepoFiles(fullPath, baseDir);
      results.push(...subDirFiles);
    } else if (entry.isFile()) {
      try {
        const content = await fs.readFile(fullPath, 'utf-8');
        results.push({ relativePath, content });
      } catch (error) {
        console.warn(`Warning: Could not read file ${fullPath}:`, error);
      }
    }
  }

  return results;
}
