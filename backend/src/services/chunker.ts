import path from 'path';

export interface Chunk {
  filePath: string;
  startLine: number;
  endLine: number;
  symbolName: string | null;
  symbolType: 'function' | 'class' | 'block' | 'file';
  content: string;
  language: string;
}

export function shouldSkip(filePath: string): boolean {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const excludePatterns = [
    /node_modules\//,
    /\.git\//,
    /dist\//,
    /build\//,
    /\.min\.js$/,
    /\.lock$/,
    /package-lock\.json$/,
    /yarn\.lock$/,
    /pnpm-lock\.yaml$/,
    /\.png$/, /\.jpg$/, /\.jpeg$/, /\.gif$/, /\.ico$/, /\.svg$/, /\.pdf$/, /\.zip$/, /\.tar$/, /\.gz$/
  ];
  return excludePatterns.some(pattern => pattern.test(normalizedPath));
}

export function getLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.ts':
    case '.tsx':
      return 'typescript';
    case '.js':
    case '.jsx':
      return 'javascript';
    case '.py':
      return 'python';
    case '.go':
      return 'go';
    case '.rs':
      return 'rust';
    case '.java':
      return 'java';
    case '.c':
    case '.cpp':
    case '.h':
    case '.hpp':
      return 'cpp';
    case '.cs':
      return 'csharp';
    case '.rb':
      return 'ruby';
    case '.php':
      return 'php';
    case '.html':
      return 'html';
    case '.css':
      return 'css';
    case '.json':
      return 'json';
    case '.md':
      return 'markdown';
    case '.yml':
    case '.yaml':
      return 'yaml';
    case '.sh':
      return 'bash';
    default:
      return 'text';
  }
}

export function chunkFile(filePath: string, fileContent: string): Chunk[] {
  const language = getLanguage(filePath);
  const lines = fileContent.split(/\r?\n/);
  const totalLines = lines.length;
  
  if (totalLines === 0) return [];
  
  const chunks: Chunk[] = [];
  const commentPrefix = language === 'python' ? '# ' : '// ';

  // Mode check
  const isSymbolAware = ['typescript', 'javascript', 'python'].includes(language);

  let currentChunkLines: string[] = [];
  let chunkStartLine = 1;
  let currentSymbolName: string | null = null;
  let currentSymbolType: 'function' | 'class' | 'block' | 'file' = 'file';
  let currentSymbolSignature: string | null = null;

  // JS/TS RegEx
  const jstsFunction = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/;
  const jstsClass = /^(?:export\s+)?class\s+(\w+)/;
  const jstsArrow = /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(/;
  
  // Python RegEx
  const pythonFunction = /^def\s+(\w+)/;
  const pythonClass = /^class\s+(\w+)/;

  const commitChunk = (endLine: number) => {
    if (currentChunkLines.length >= 3) {
      chunks.push({
        filePath,
        startLine: chunkStartLine,
        endLine,
        symbolName: currentSymbolName,
        symbolType: currentSymbolType,
        content: currentChunkLines.join('\n'),
        language
      });
    }
    currentChunkLines = [];
  };

  if (isSymbolAware) {
    for (let i = 0; i < totalLines; i++) {
      const line = lines[i];
      const lineNum = i + 1;
      let matchedNewSymbol = false;
      let newSymbolName: string | null = null;
      let newSymbolType: 'function' | 'class' | 'block' | 'file' = 'file';
      let newSignature: string | null = null;

      if (language === 'typescript' || language === 'javascript') {
        let match = line.match(jstsFunction);
        if (match) {
          matchedNewSymbol = true;
          newSymbolName = match[1];
          newSymbolType = 'function';
          newSignature = line;
        } else {
          match = line.match(jstsClass);
          if (match) {
            matchedNewSymbol = true;
            newSymbolName = match[1];
            newSymbolType = 'class';
            newSignature = line;
          } else {
            match = line.match(jstsArrow);
            if (match) {
              matchedNewSymbol = true;
              newSymbolName = match[1];
              newSymbolType = 'function';
              newSignature = line;
            }
          }
        }
      } else if (language === 'python') {
        let match = line.match(pythonFunction);
        if (match) {
          matchedNewSymbol = true;
          newSymbolName = match[1];
          newSymbolType = 'function';
          newSignature = line;
        } else {
          match = line.match(pythonClass);
          if (match) {
            matchedNewSymbol = true;
            newSymbolName = match[1];
            newSymbolType = 'class';
            newSignature = line;
          }
        }
      }

      if (matchedNewSymbol) {
        // Commit previous chunk if any
        commitChunk(lineNum - 1);
        
        // Setup new chunk
        chunkStartLine = lineNum;
        currentSymbolName = newSymbolName;
        currentSymbolType = newSymbolType;
        currentSymbolSignature = newSignature;
        currentChunkLines.push(line);
      } else {
        // If we hit max lines limit (60)
        if (currentChunkLines.length >= 60) {
          commitChunk(lineNum - 1);
          
          // Start next chunk
          chunkStartLine = lineNum;
          if (currentSymbolSignature) {
            // Carry context signature
            currentChunkLines.push(`${commentPrefix}Context: ${currentSymbolSignature.trim()}`);
          }
        }
        currentChunkLines.push(line);
      }
    }
  } else {
    // Other files: Paragraph chunking based on empty lines
    for (let i = 0; i < totalLines; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // Split indicator: empty line separating text blocks
      const isParagraphSeparator = line.trim() === '';

      if (isParagraphSeparator && currentChunkLines.length >= 3) {
        commitChunk(lineNum - 1);
        chunkStartLine = lineNum + 1; // start after empty line
      } else {
        if (currentChunkLines.length >= 60) {
          commitChunk(lineNum - 1);
          chunkStartLine = lineNum;
        }
        currentChunkLines.push(line);
      }
    }
  }

  // Commit final chunk
  commitChunk(totalLines);

  return chunks;
}
