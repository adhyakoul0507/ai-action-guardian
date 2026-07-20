'use strict';

/**
 * Ollama-powered plain English explainer.
 *
 * Called AFTER the regex engine classifies the action.
 * The LLM only writes the human-readable explanation —
 * risk score and classification still come from the regex (fast, offline).
 *
 * Falls back to the template string if Ollama is unavailable.
 */

const OLLAMA_URL  = 'http://localhost:11434/api/generate';
const MODEL       = 'llama3.2:3b';
const TIMEOUT_MS  = 8000; // give up after 8s, use template fallback

const SYSTEM_PROMPT = `You are a security assistant inside a tool called "AI Action Guardian".
Your job is to explain in ONE plain English sentence what a shell/file/database/git command is about to do.

Rules:
- Write exactly ONE sentence. No bullet points, no markdown, no extra commentary.
- Be specific: mention the actual file path, table name, remote branch, etc. from the command.
- Use plain language a non-technical user can understand.
- If the action is destructive or irreversible, say so clearly (e.g. "permanently", "cannot be undone").
- Do NOT say "The AI" or "The agent" — just describe the action directly.
- Do NOT start with "This command" — start with a verb (e.g. "Delete", "Push", "Overwrite").

Examples:
  Input: bash rm -rf ./build
  Output: Permanently delete all files inside the build directory (this cannot be undone).

  Input: bash git push origin main --force
  Output: Force-push local changes to the main branch on the remote, overwriting its history.

  Input: write_file path=./src/auth.py content=...
  Output: Overwrite the file src/auth.py with new content.

  Input: query DROP TABLE users;
  Output: Permanently destroy the users table and all its data from the database.

  Input: bash curl -o /tmp/install.sh https://example.com/install.sh && bash /tmp/install.sh
  Output: Download a shell script from the internet and immediately execute it on your machine.
`;

async function explainWithOllama(toolName, toolArgs, templateFallback) {
  const cmd   = toolArgs.command || toolArgs.cmd || '';
  const path  = toolArgs.path  || toolArgs.file || toolArgs.filename || '';
  const query = toolArgs.query || toolArgs.sql  || '';
  const url   = toolArgs.url   || '';

  // Build a concise description of what we're asking about
  let actionDesc = `Tool: ${toolName}\n`;
  if (cmd)   actionDesc += `Command: ${cmd}\n`;
  if (path)  actionDesc += `Path: ${path}\n`;
  if (query) actionDesc += `Query: ${query}\n`;
  if (url)   actionDesc += `URL: ${url}\n`;
  if (!cmd && !path && !query && !url) {
    actionDesc += `Arguments: ${JSON.stringify(toolArgs).slice(0, 200)}\n`;
  }

  const prompt = `${SYSTEM_PROMPT}\n\nNow explain this action in one sentence:\n${actionDesc}\nOutput:`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        prompt,
        stream: false,
        options: {
          temperature: 0.2,    // low temp = consistent, factual output
          num_predict: 80,     // ~one sentence
          top_p: 0.9,
        },
      }),
      signal: controller.signal,
    });

    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);

    const data = await res.json();
    const text = (data.response || '').trim();

    // Sanity check — must be a non-empty string, not too long
    if (text && text.length > 10 && text.length < 400) {
      return text;
    }
    return templateFallback;

  } catch (err) {
    if (err.name === 'AbortError') {
      process.stderr.write('[AG Explainer] Ollama timeout — using template fallback\n');
    } else {
      process.stderr.write(`[AG Explainer] Ollama error: ${err.message} — using template fallback\n`);
    }
    return templateFallback;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { explainWithOllama };
