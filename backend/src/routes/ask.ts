import { Router, Request, Response } from 'express';
import OpenAI from 'openai';
import { generateEmbedding } from '../services/embeddings.js';
import { searchSimilarChunks } from '../services/qdrant.js';
import { pool } from '../config/db.js';
import dotenv from 'dotenv';

dotenv.config();

const router = Router();

// Initialize Groq (OpenAI-compatible client)
const groqApiKey = process.env.GROQ_API_KEY;
if (!groqApiKey) {
  console.warn('Warning: GROQ_API_KEY is not defined in the environment.');
}

const groq = new OpenAI({
  apiKey: groqApiKey || '',
  baseURL: 'https://api.groq.com/openai/v1',
});

const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

router.post('/ask', async (req: Request, res: Response) => {
  const { repoId, question, conversationHistory = [] } = req.body;

  if (!repoId || !question) {
    res.status(400).json({ error: 'repoId and question are required.' });
    return;
  }

  // Set headers for Server-Sent Events (SSE)
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable proxy buffering for Nginx/etc.

  try {
    // 1. Embed user query using Gemini API
    console.log(`[Ask] Embedding question: "${question}"`);
    const queryVector = await generateEmbedding(question);

    // 2. Perform vector search in Qdrant
    console.log(`[Ask] Searching Qdrant collection codebase_${repoId}...`);
    const matchingChunks = await searchSimilarChunks(repoId, queryVector, 5);
    console.log(`[Ask] Found ${matchingChunks.length} matching code segments.`);

    // 3. Construct system prompt with retrieved context
    const contextHeader = matchingChunks.map((chunk, index) => {
      return `--- Chunk ${index + 1} ---
File: ${chunk.file_path} (Lines ${chunk.start_line}-${chunk.end_line})
Symbol: ${chunk.symbol_name || 'none'} (${chunk.symbol_type})
Language: ${chunk.language}
Code:
\`\`\`${chunk.language}
${chunk.content}
\`\`\`
`;
    }).join('\n\n');

    const systemPrompt = `You are a professional software engineer AI assistant.
Answer the user's question based strictly on the retrieved code chunks below.
If the information is not present in the code chunks, say "I cannot find the answer in the indexed files." Do not make up answers.
Always reference the file names and line numbers in your explanations when referring to specific parts of the code.

Retrieved Code Chunks:
${contextHeader}`;

    // 4. Map conversation history to OpenAI format
    const messages = [
      { role: 'system', content: systemPrompt },
      ...conversationHistory.map((msg: any) => ({
        role: msg.sender === 'user' ? 'user' : 'assistant',
        content: msg.message,
      })),
      { role: 'user', content: question },
    ];

    // 5. Call Groq and stream response
    console.log(`[Ask] Querying Groq using model: ${GROQ_MODEL}`);
    const stream = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: messages as any,
      stream: true,
    });

    let fullAnswer = '';

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) {
        fullAnswer += content;
        res.write(`data: ${JSON.stringify({ type: 'text', content })}\n\n`);
      }
    }

    // 6. Send citations back as a separate event
    const citations = matchingChunks.map((chunk) => ({
      filePath: chunk.file_path,
      startLine: chunk.start_line,
      endLine: chunk.end_line,
      symbolName: chunk.symbol_name,
      symbolType: chunk.symbol_type,
      content: chunk.content,
    }));

    res.write(`data: ${JSON.stringify({ type: 'citations', citations })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();

    // 7. Save interaction to Postgres chat history
    try {
      await pool.query(
        'INSERT INTO chat_history (repo_id, sender, message) VALUES ($1, $2, $3)',
        [repoId, 'user', question]
      );
      await pool.query(
        'INSERT INTO chat_history (repo_id, sender, message) VALUES ($1, $2, $3)',
        [repoId, 'bot', fullAnswer]
      );
    } catch (dbError) {
      console.error('[Ask] Failed to save chat history to database:', dbError);
    }

  } catch (error: any) {
    console.error('[Ask] SSE Error:', error);
    res.write(`data: ${JSON.stringify({ type: 'error', message: error.message || String(error) })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }
});

// Fetch repository specific chat history
router.get('/chat-history/:repoId', async (req: Request, res: Response) => {
  const { repoId } = req.params;
  try {
    const result = await pool.query(
      'SELECT sender, message, created_at FROM chat_history WHERE repo_id = $1 ORDER BY created_at ASC',
      [repoId]
    );
    res.json({ history: result.rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message || String(error) });
  }
});

export default router;
