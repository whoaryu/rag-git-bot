import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

// Support standard DATABASE_URL or individual configs
const connectionString = process.env.DATABASE_URL;

export const pool = new Pool(
  connectionString
    ? { connectionString }
    : {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432'),
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || 'postgres',
        database: process.env.DB_NAME || 'rag_git_bot',
      }
);

export async function initializeDatabase() {
  const client = await pool.connect();
  try {
    console.log('Initializing database schema...');
    
    // Create repositories table
    await client.query(`
      CREATE TABLE IF NOT EXISTS repositories (
        id SERIAL PRIMARY KEY,
        github_url TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        status VARCHAR(50) DEFAULT 'idle',
        last_indexed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create index_logs table
    await client.query(`
      CREATE TABLE IF NOT EXISTS index_logs (
        id SERIAL PRIMARY KEY,
        repo_id INTEGER REFERENCES repositories(id) ON DELETE CASCADE,
        files_updated INTEGER DEFAULT 0,
        duration_ms INTEGER DEFAULT 0,
        status VARCHAR(50) NOT NULL,
        error_message TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create chat_history table
    await client.query(`
      CREATE TABLE IF NOT EXISTS chat_history (
        id SERIAL PRIMARY KEY,
        repo_id INTEGER REFERENCES repositories(id) ON DELETE CASCADE,
        sender VARCHAR(10) NOT NULL,
        message TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log('Database schema initialized successfully.');
  } catch (error) {
    console.error('Failed to initialize database schema:', error);
    throw error;
  } finally {
    client.release();
  }
}
