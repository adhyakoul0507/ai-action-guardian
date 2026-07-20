'use strict';

const { spawn } = require('child_process');
const readline = require('readline');
const { WsServer } = require('./ws-server');
const { RiskEngine } = require('./risk-engine');
const { ApprovalQueue } = require('./approval-queue');
const { explainWithOllama } = require('./explainer');
const { generateDiff } = require('./diff-engine');

class MCPProxy {
  constructor(serverCmd, serverArgs) {
    this.serverCmd = serverCmd;
    this.serverArgs = serverArgs;
    this.riskEngine = new RiskEngine();
    this.approvalQueue = new ApprovalQueue();
    this.wsServer = new WsServer(7777, this.approvalQueue);
    this.child = null;
  }

  start() {
    this._log(`Starting proxy → ${this.serverCmd} ${this.serverArgs.join(' ')}`);

    // Start WebSocket server for extension
    this.wsServer.start();

    // Spawn the real MCP server
    this.child = spawn(this.serverCmd, this.serverArgs, {
      stdio: ['pipe', 'pipe', 'inherit'], // stderr passes through to our stderr
      env: process.env,
    });

    this.child.on('exit', (code) => {
      this._log(`Real server exited (${code}). Shutting down.`);
      process.exit(code || 0);
    });

    // ── Client (stdin) → Proxy → Real Server ──────────────────────────────
    // We read from our own stdin (the MCP client writes here)
    // and forward to the real server's stdin — intercepting tools/call
    const clientReader = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

    clientReader.on('line', async (line) => {
      if (!line.trim()) return;
      let msg;
      try { msg = JSON.parse(line); } catch { return; } // ignore parse errors

      // Intercept tool calls
      if (msg.method === 'tools/call') {
        await this._handleToolCall(msg);
      } else {
        // Pass through unchanged
        this._sendToServer(line);
      }
    });

    clientReader.on('close', () => {
      this.child.stdin.end();
    });

    // ── Real Server (stdout) → Proxy → Client (stdout) ────────────────────
    const serverReader = readline.createInterface({ input: this.child.stdout, crlfDelay: Infinity });

    serverReader.on('line', (line) => {
      if (line.trim()) process.stdout.write(line + '\n');
    });
  }

  async _handleToolCall(msg) {
    const toolName = msg.params?.name || 'unknown';
    const toolArgs = msg.params?.arguments || {};

    // Build AgentAction
    const action = await this.riskEngine.analyze(msg.id, toolName, toolArgs);

    this._log(`[${action.risk.level}] ${toolName} → score:${action.risk.score}`);

    if (action.risk.level === 'LOW') {
      // Auto-approve — pass straight through
      this._log(`AUTO-APPROVED: ${action.risk.plain_english}`);
      this._sendToServer(JSON.stringify(msg));
      return;
    }

    // MEDIUM / HIGH / CRITICAL → enhance explanation with Ollama, then gate
    this._log(`Calling Ollama for explanation…`);
    const ollamaExplanation = await explainWithOllama(
      toolName,
      toolArgs,
      action.risk.plain_english  // template fallback if Ollama fails
    );
    action.risk.plain_english = ollamaExplanation;

    // Generate diff for file edits
    if (['write_file', 'replace_file_content'].includes(toolName.toLowerCase())) {
      const targetPath = toolArgs.path || toolArgs.targetFile || toolArgs.TargetFile || '';
      const newContent = toolArgs.content || toolArgs.ReplacementContent || '';
      if (targetPath && typeof newContent === 'string') {
        action.diff = generateDiff(targetPath, newContent);
      }
    }

    this._log(`GATING for approval: ${action.risk.plain_english}`);

    try {
      const decision = await this.approvalQueue.waitForDecision(action, this.wsServer);

      if (decision.outcome === 'APPROVED') {
        this._log(`✅ APPROVED by user`);
        this._sendToServer(JSON.stringify(msg));
      } else if (decision.outcome === 'MODIFIED') {
        this._log(`✏️  MODIFIED by user`);
        const modifiedMsg = {
          ...msg,
          params: { ...msg.params, arguments: decision.modifiedArgs },
        };
        this._sendToServer(JSON.stringify(modifiedMsg));
      } else {
        // DENIED or TIMEOUT
        this._log(`❌ ${decision.outcome} — returning error to agent`);
        const errorResponse = {
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            content: [{ type: 'text', text: `Action denied by AI Action Guardian: ${decision.reason || 'User denied this action.'}` }],
            isError: true,
          },
        };
        process.stdout.write(JSON.stringify(errorResponse) + '\n');
      }
    } catch (err) {
      this._log(`Error in approval flow: ${err.message}`);
      const errorResponse = {
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          content: [{ type: 'text', text: `AI Action Guardian error: ${err.message}` }],
          isError: true,
        },
      };
      process.stdout.write(JSON.stringify(errorResponse) + '\n');
    }
  }

  _sendToServer(line) {
    if (this.child?.stdin?.writable) {
      this.child.stdin.write(line + '\n');
    }
  }

  _log(msg) {
    process.stderr.write(`[AG Proxy] ${msg}\n`);
  }
}

module.exports = { MCPProxy };
