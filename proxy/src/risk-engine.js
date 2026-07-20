'use strict';

const crypto = require('crypto');

// ─── Operation Type Detection ───────────────────────────────────────────────

const SHELL_DESTRUCTIVE_PATTERNS = [
  /\brm\s+(-[a-z]*f[a-z]*|-[a-z]*r[a-z]*|--force|--recursive)/i,
  /\brmdir\b/i,
  /\btruncate\b/i,
  /\bshred\b/i,
  /\bdd\b.*of=/i,
  /\b:(){ :|:& };:/,   // fork bomb
  /\bkillall\b/i,
  /\bpkill\b/i,
];

const SHELL_SENSITIVE_PATTERNS = [
  /\bcurl\b.*(-X\s+(DELETE|POST|PUT)|-d|--data|-o|--output)/i,
  /\bwget\b/i,
  /\bchmod\s+[0-7]*7[0-7]*/i,
  /\bchown\b/i,
  /\bsudo\b/i,
  /\bsu\s/i,
  /\bapt(-get)?\s+(install|remove|purge)/i,
  /\bbrew\s+(install|uninstall|remove)/i,
  /\bnpm\s+(install|uninstall|publish)/i,
  /\bpip\s+(install|uninstall)/i,
  /\bssh\b/i,
  /\bscp\b/i,
  /\b(kill|pkill|killall)\b/i,
  /\bxargs\b/i,
];

const GIT_DESTRUCTIVE = [
  /git\s+push\s+.*--force/i,
  /git\s+push\s+-f\b/i,
  /git\s+reset\s+--hard/i,
  /git\s+clean\s+-[a-z]*f/i,
  /git\s+branch\s+-[dD]/i,
  /git\s+rebase\b/i,
];

const DB_DESTRUCTIVE = [
  /\bDROP\s+(TABLE|DATABASE|SCHEMA|INDEX)\b/i,
  /\bTRUNCATE\b/i,
  /\bDELETE\s+FROM\b/i,
  /\bALTER\s+TABLE\b.*DROP/i,
];

const DB_SAFE = [
  /^\s*SELECT\b/i,
  /^\s*SHOW\b/i,
  /^\s*DESCRIBE\b/i,
  /^\s*EXPLAIN\b/i,
];

// ─── Path Sensitivity ────────────────────────────────────────────────────────

function classifyPath(pathStr) {
  if (!pathStr) return { modifier: 0, label: '' };

  const p = pathStr.toLowerCase();
  if (p === '/' || p.startsWith('/etc') || p.startsWith('/usr') || p.startsWith('/bin') || p.startsWith('/system')) {
    return { modifier: 30, label: 'system directory' };
  }
  if (p.includes('~') || p.startsWith('/home') || p.startsWith('/users')) {
    return { modifier: 15, label: 'home directory' };
  }
  if (p.includes('.env') || p.includes('secret') || p.includes('credential') || p.includes('.ssh') || p.includes('.key') || p.includes('token')) {
    return { modifier: 25, label: 'sensitive credentials' };
  }
  if (p.includes('prod') || p.includes('production') || p.includes('live')) {
    return { modifier: 20, label: 'production environment' };
  }
  if (p.includes('node_modules') || p.includes('dist/') || p.includes('/build') || p === './build' || p === 'build') {
    return { modifier: -20, label: 'build artifact' };
  }
  return { modifier: 0, label: '' };
}

// ─── File Count Estimation ───────────────────────────────────────────────────

function estimateBlastRadius(toolName, args) {
  const argStr = JSON.stringify(args).toLowerCase();
  if (argStr.includes('-r') || argStr.includes('--recursive') || argStr.includes('-rf') || argStr.includes('/**')) {
    return 'many files (recursive)';
  }
  if (toolName.includes('delete') || toolName.includes('remove')) {
    return 'the specified file';
  }
  return 'the target resource';
}

// ─── Main Risk Engine ────────────────────────────────────────────────────────

class RiskEngine {
  async analyze(actionId, toolName, toolArgs) {
    const id = actionId ?? crypto.randomUUID();
    const argStr = JSON.stringify(toolArgs);
    const cmdStr = toolArgs.command || toolArgs.cmd || toolArgs.query || '';

    let score = 0;
    let operationType = 'unknown';
    let reversible = true;
    let pathInfo = { modifier: 0, label: '' };

    // ── Shell / Bash tools ───────────────────────────────────────────────
    if (['bash', 'shell', 'terminal', 'exec', 'run_command', 'execute'].includes(toolName.toLowerCase())) {
      operationType = 'shell';

      // Check for git operations first
      if (/^git\s/.test(cmdStr.trim())) {
        if (GIT_DESTRUCTIVE.some(p => p.test(cmdStr))) {
          score = 80; reversible = false; operationType = 'git_destructive';
        } else if (/git\s+(commit|add|stash)/i.test(cmdStr)) {
          score = 20; reversible = true; operationType = 'git_safe';
        } else if (/git\s+(push|pull|fetch)/i.test(cmdStr)) {
          score = 45; reversible = false; operationType = 'git_remote';
        } else {
          score = 10; reversible = true; operationType = 'git_read';
        }
      }
      // Destructive shell commands
      else if (SHELL_DESTRUCTIVE_PATTERNS.some(p => p.test(cmdStr))) {
        score = 85; reversible = false; operationType = 'shell_destructive';
        // Extract path for modifier
        const pathMatch = cmdStr.match(/rm\s+[^|&;\s]*\s+([^\s|&;]+)/);
        if (pathMatch) pathInfo = classifyPath(pathMatch[1]);
      }
      // Sensitive shell commands
      else if (SHELL_SENSITIVE_PATTERNS.some(p => p.test(cmdStr))) {
        score = 55; reversible = false; operationType = 'shell_sensitive';
      }
      // Read-only shell
      else if (/^(ls|cat|head|tail|grep|find|echo|pwd|whoami|which|type|env|printenv|ps|top|df|du|wc|sort|uniq|diff|file|stat)\b/.test(cmdStr.trim())) {
        score = 8; reversible = true; operationType = 'shell_read';
      }
      else {
        score = 30; reversible = true; operationType = 'shell_general';
      }
    }

    // ── File write ───────────────────────────────────────────────────────
    else if (['write_file', 'create_file', 'save_file', 'file_write'].includes(toolName.toLowerCase())) {
      const targetPath = toolArgs.path || toolArgs.file || toolArgs.filename || '';
      pathInfo = classifyPath(targetPath);
      operationType = 'file_write';
      score = 40 + pathInfo.modifier;
      reversible = false;
    }

    // ── File delete ──────────────────────────────────────────────────────
    else if (['delete_file', 'remove_file', 'file_delete', 'unlink'].includes(toolName.toLowerCase())) {
      const targetPath = toolArgs.path || toolArgs.file || '';
      pathInfo = classifyPath(targetPath);
      operationType = 'file_delete';
      score = 70 + pathInfo.modifier;
      reversible = false;
    }

    // ── File read ────────────────────────────────────────────────────────
    else if (['read_file', 'get_file', 'open_file', 'cat_file', 'read'].includes(toolName.toLowerCase())) {
      const targetPath = toolArgs.path || toolArgs.file || '';
      pathInfo = classifyPath(targetPath);
      operationType = 'file_read';
      score = 5 + Math.max(0, pathInfo.modifier * 0.5); // sensitivity matters for reads too
      reversible = true;
    }

    // ── Directory listing ────────────────────────────────────────────────
    else if (['list_dir', 'list_files', 'ls', 'readdir'].includes(toolName.toLowerCase())) {
      score = 5; reversible = true; operationType = 'dir_read';
    }

    // ── Database ─────────────────────────────────────────────────────────
    else if (['query', 'db_query', 'sql', 'execute_sql', 'run_query'].includes(toolName.toLowerCase())) {
      const q = toolArgs.query || toolArgs.sql || '';
      if (DB_DESTRUCTIVE.some(p => p.test(q))) {
        score = 95; reversible = false; operationType = 'db_destructive';
      } else if (DB_SAFE.some(p => p.test(q))) {
        score = 8; reversible = true; operationType = 'db_read';
      } else {
        score = 50; reversible = false; operationType = 'db_write';
      }
    }

    // ── HTTP / Network ───────────────────────────────────────────────────
    else if (['http_request', 'fetch', 'api_call', 'web_request'].includes(toolName.toLowerCase())) {
      const method = (toolArgs.method || 'GET').toUpperCase();
      if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
        score = 10; reversible = true; operationType = 'http_read';
      } else if (['DELETE'].includes(method)) {
        score = 65; reversible = false; operationType = 'http_delete';
      } else {
        score = 40; reversible = false; operationType = 'http_write';
      }
    }

    // ── OAuth / Auth ─────────────────────────────────────────────────────
    else if (['oauth', 'auth_grant', 'request_permission', 'grant_access'].includes(toolName.toLowerCase())) {
      score = 70; reversible = false; operationType = 'oauth';
    }

    // ── Unknown tool ─────────────────────────────────────────────────────
    else {
      score = 35; reversible = true; operationType = 'unknown';
    }

    // Clamp
    score = Math.max(0, Math.min(100, score));

    const level = score < 31 ? 'LOW'
                : score < 61 ? 'MEDIUM'
                : score < 86 ? 'HIGH'
                : 'CRITICAL';

    const plain_english = await this._generatePlainEnglish(operationType, level, cmdStr, toolName, toolArgs, pathInfo);
    const blast_radius = estimateBlastRadius(toolName, toolArgs);
    const recommendation = this._generateRecommendation(level, reversible);

    return {
      id: String(id),
      timestamp: new Date().toISOString(),
      raw: { tool_name: toolName, arguments: toolArgs },
      parsed: { operation_type: operationType, target: this._extractTarget(toolArgs) },
      risk: { score, level, reversible, blast_radius, plain_english, recommendation },
    };
  }

  _extractTarget(args) {
    return args.command || args.cmd || args.path || args.file || args.query || args.url || JSON.stringify(args).slice(0, 80);
  }

  async _generatePlainEnglish(opType, riskLevel, cmd, toolName, args, pathInfo) {
    // 1. Shell commands get dynamic breakdowns
    if (opType.startsWith('shell') || opType.startsWith('git') || opType === 'unknown') {
      const words = cmd.trim().split(/\s+/);
      const firstWord = words[0];
      
      if (firstWord === 'rm') {
        const target = words[words.length - 1];
        return `The AI is attempting to permanently delete the file or folder located at <code>${target}</code>. This action cannot be undone.`;
      }
      
      if (firstWord === 'curl' || firstWord === 'wget') {
        const isDelete = cmd.includes('DELETE');
        const isPost = cmd.includes('POST') || cmd.includes('PUT') || cmd.includes('--data');
        const target = words.find(w => w.startsWith('http')) || 'an external server';
        
        if (isDelete) return `The AI is sending a destructive web request to <code>${target}</code> to permanently delete external data.`;
        if (isPost) return `The AI is transmitting data from your computer to <code>${target}</code>.`;
        return `The AI is downloading data or fetching information from <code>${target}</code>.`;
      }

      if (firstWord === 'npm' || firstWord === 'yarn' || firstWord === 'pnpm') {
        if (words.includes('install') || words.includes('i') || words.includes('add')) {
          const pkgs = words.slice(2).filter(w => !w.startsWith('-')).join(', ') || 'project dependencies';
          return `The AI is downloading and installing the following code packages onto your computer: <code>${pkgs}</code>.`;
        }
        if (words.includes('run')) return `The AI is running the custom script <code>${words[2]}</code> defined in your project.`;
        return `The AI is using ${firstWord} to manage your project's code dependencies.`;
      }

      if (firstWord === 'npx') {
        const pkg = words.find(w => w !== 'npx' && w !== '-y' && !w.startsWith('-'));
        return `The AI is temporarily downloading the <code>${pkg}</code> package from the internet and executing it directly.`;
      }

      if (firstWord === 'git') {
        const action = words[1];
        if (action === 'push') {
          if (cmd.includes('--force')) return `The AI is forcefully pushing code to a remote server, which may permanently overwrite your teammates' work!`;
          return `The AI is uploading your local code changes to a remote repository.`;
        }
        if (action === 'reset' || action === 'checkout') return `The AI is reverting or changing your local code files, which might discard uncommitted work.`;
        if (action === 'commit') return `The AI is saving a new snapshot of your code history.`;
        return `The AI is using Git to inspect or manage your code history.`;
      }

      if (firstWord === 'python' || firstWord === 'python3' || firstWord === 'node') {
        if (words.includes('-c') || words.includes('-e')) return `The AI is executing a quick, invisible script snippet directly in your terminal.`;
        const scriptName = words.find(w => w.endsWith('.py') || w.endsWith('.js')) || 'a local script';
        return `The AI is running <code>${scriptName}</code> on your computer.`;
      }

      if (['cat', 'less', 'head', 'tail'].includes(firstWord)) return `The AI is reading the contents of a file to understand your code. This is completely safe.`;
      if (['grep', 'find', 'ls'].includes(firstWord)) return `The AI is searching through your folders to locate specific files or code snippets.`;
      if (['mkdir', 'touch'].includes(firstWord)) return `The AI is creating new empty files or folders on your system.`;
      if (['cp', 'mv'].includes(firstWord)) return `The AI is copying or moving files across your computer.`;

      if (firstWord === 'kill' || firstWord === 'pkill' || firstWord === 'killall') return `The AI is attempting to forcibly terminate running applications on your computer.`;
      if (firstWord === 'chmod' || firstWord === 'chown') return `The AI is modifying the security permissions of files on your computer.`;
      if (firstWord === 'sudo' || firstWord === 'su') return `The AI is attempting to run a command with maximum Administrator privileges!`;

      if (['tar', 'zip', 'unzip', 'gzip'].includes(firstWord)) {
        if (cmd.includes('-x') || firstWord === 'unzip') return `The AI is extracting a compressed archive file on your computer.`;
        if (cmd.includes('-c') || firstWord === 'zip' || firstWord === 'gzip') return `The AI is compressing files into an archive on your computer.`;
        return `The AI is interacting with compressed archive files.`;
      }

      // Guardian AI Upgrade (Ollama Local SLM)
      if (firstWord) {
        try {
          console.error(`\n[AG Guardian AI] Asking local Ollama SLM to translate: ${cmd}`);
          const prompt = `You are a cybersecurity UI explainer for a non-technical user.
Explain what the terminal command '${cmd}' is trying to do.
Keep it extremely short, under 15 words.
Make it "Explain Like I'm 5" level simple.
Do NOT use any technical jargon.
Start the sentence exactly with: "The AI is "`;

          const response = await fetch('http://localhost:11434/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'llama3.2:3b',
              prompt: prompt,
              stream: false
            })
          });
          
          if (!response.ok) throw new Error(`Ollama returned status ${response.status}`);
          const data = await response.json();
          
          if (data.response) {
            return data.response.trim();
          }
        } catch (e) {
          console.error('[AG Guardian AI] Failed to reach local Ollama:', e.message);
        }
      }

      // Offline Dictionary Fallback (Runs if no API key or if Gemini fails)
      if (firstWord) {
        try {
          const commandDB = require('../commands-db.json');
          if (commandDB[firstWord]) {
            return `The AI is using a system tool called <code>${firstWord}</code>, which is designed for: "<b>${commandDB[firstWord]}</b>".`;
          }
        } catch (e) {
          console.error('[AG RiskEngine] Failed to load offline dictionary:', e.message);
        }
      }

      return `The AI is running a terminal utility called <code>${firstWord || cmd}</code>. Please review its arguments carefully before proceeding.`;
    }

    // 2. Specific Antigravity Tool Parsing
    const path = args.TargetFile || args.AbsolutePath || args.DirectoryPath || args.SearchPath || args.path || args.file || args.filename || '';
    const query = args.Query || args.query || '';
    const url = args.Url || args.url || '';
    
    // Explicit mappings for Antigravity's internal agentic tools
    if (toolName === 'replace_file_content' || toolName === 'multi_replace_file_content') {
      return `The AI is surgically editing lines of code inside <code>${path}</code>.`;
    }
    if (toolName === 'write_to_file') {
      return `The AI is creating a brand new file on your computer at <code>${path}</code>.`;
    }
    if (toolName === 'view_file') {
      return `The AI is inspecting the contents of <code>${path}</code> to understand your project. This is completely safe.`;
    }
    if (toolName === 'list_dir') {
      return `The AI is listing the files inside <code>${path}</code> to map out your project structure.`;
    }
    if (toolName === 'grep_search') {
      return `The AI is performing a lightning-fast regex search across your project for the pattern "<b>${query}</b>".`;
    }
    if (toolName === 'search_web') {
      return `The AI is searching Google for "<b>${query}</b>" to find external information.`;
    }
    if (toolName === 'read_url_content') {
      return `The AI is silently scraping content from <code>${url}</code>.`;
    }
    if (toolName === 'generate_image') {
      return `The AI is generating a synthetic image using the prompt: "<b>${args.Prompt}</b>".`;
    }
    if (toolName === 'manage_task' || toolName === 'schedule') {
      return `The AI is configuring background daemon tasks or automated cron jobs on your system.`;
    }
    if (toolName === 'invoke_subagent' || toolName === 'manage_subagents') {
      return `The AI is spinning up autonomous sub-agents to parallelize its work in the background!`;
    }
    if (toolName === 'ask_permission') {
      return `The AI hit a security wall and is explicitly asking you for elevated permissions to bypass it.`;
    }

    // 3. Generic Fallbacks for MCP Servers or Databases
    const templates = {
      db_destructive:    `This executes a highly destructive database query: \`${query.slice(0, 60)}\`. It may permanently drop tables or delete rows.`,
      db_read:           `This is a safe, read-only database query to fetch information.`,
      db_write:          `This action modifies data in your database: \`${query.slice(0, 60)}\`.`,
      http_read:         `This makes a safe HTTP request to fetch data from the internet: \`${url}\`.`,
      http_write:        `This sends your data to an external internet server: \`${url}\`.`,
      http_delete:       `This tells an external server to permanently delete a resource: \`${url}\`.`,
      oauth:             `Request OAuth access permission to authenticate you with a third-party service.`,
      unknown:           `The AI is using an unknown capability called <code>${toolName}</code>. Please review its arguments carefully.`,
    };
    return templates[opType] || templates.unknown;
  }

  _generateRecommendation(level, reversible) {
    if (level === 'CRITICAL') return '⛔ Do not approve unless you fully understand the consequences. This action is irreversible.';
    if (level === 'HIGH' && !reversible) return '⚠️ Review carefully — this action cannot be undone.';
    if (level === 'HIGH') return '⚠️ Review before approving — significant impact expected.';
    if (level === 'MEDIUM') return 'ℹ️ Double-check the target and arguments before approving.';
    return '✅ Low risk — safe to approve.';
  }
}

module.exports = { RiskEngine };
