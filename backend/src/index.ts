import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { initializeDatabase } from './config/db.js';
import repoRouter from './routes/repo.js';
import askRouter from './routes/ask.js';
import webhookRouter from './routes/webhook.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// CORS setup
app.use(cors({
  origin: '*', // Adjust this for production security
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
}));

// Capture raw body buffer for GitHub webhook signature validation
app.use(
  express.json({
    verify: (req: any, res, buf) => {
      req.rawBody = buf;
    },
  })
);

app.use(express.urlencoded({ extended: true }));

// Health Check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date() });
});

// Mounting Routes
app.use('/api', repoRouter);
app.use('/api', askRouter);
app.use('/api', webhookRouter);

// Start Server
async function startServer() {
  try {
    // 1. Initialize Postgres Schema
    await initializeDatabase();

    // 2. Listen to Port
    app.listen(PORT, () => {
      console.log(`===============================================`);
      console.log(` RAG Git Bot Backend running on port ${PORT}`);
      console.log(` Health check: http://localhost:${PORT}/health`);
      console.log(`===============================================`);
    });
  } catch (error) {
    console.error('Critical: Failed to start the server:', error);
    process.exit(1);
  }
}

startServer();
export default app;
