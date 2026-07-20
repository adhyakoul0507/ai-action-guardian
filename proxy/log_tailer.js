const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { RiskEngine } = require('./src/risk-engine');
const riskEngine = new RiskEngine();

// Find the most recently modified transcript.jsonl file
function findLatestTranscript() {
  const brainDir = path.join(os.homedir(), '.gemini', 'antigravity', 'brain');
  
  if (!fs.existsSync(brainDir)) return null;

  const convDirs = fs.readdirSync(brainDir);
  let latestFile = null;
  let latestTime = 0;

  for (const dir of convDirs) {
    const transcriptPath = path.join(brainDir, dir, '.system_generated', 'logs', 'transcript.jsonl');
    if (fs.existsSync(transcriptPath)) {
      const stats = fs.statSync(transcriptPath);
      if (stats.mtimeMs > latestTime) {
        latestTime = stats.mtimeMs;
        latestFile = transcriptPath;
      }
    }
  }

  return latestFile;
}

function startLogTailer(wsServer) {
  const latestLog = findLatestTranscript();
  if (!latestLog) {
    console.error('[AG LogTailer] No Antigravity logs found to tail.');
    return;
  }

  console.error(`[AG LogTailer] Tailing Antigravity log: ${latestLog}`);

  const tail = spawn('tail', ['-F', '-n', '0', latestLog]);

  tail.stdout.on('data', (data) => {
    const lines = data.toString().split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (obj.source === 'MODEL' && obj.type === 'PLANNER_RESPONSE' && obj.tool_calls) {
          handleToolCalls(obj.tool_calls, wsServer);
        }
      } catch (e) {
        // Ignore parse errors from partial lines
      }
    }
  });

  tail.stderr.on('data', (data) => {
    console.error('[AG LogTailer] Tail error:', data.toString());
  });
}

function extractArg(val) {
  try {
    return JSON.parse(val);
  } catch (e) {
    return val; // fallback
  }
}

async function handleToolCalls(toolCalls, wsServer) {
  for (const call of toolCalls) {
    let command = null;

    if (call.name === 'run_command') {
      command = extractArg(call.args.CommandLine);
    } else if (call.name === 'ask_permission') {
      const action = extractArg(call.args.Action);
      if (action === 'command' || action === 'unsandboxed') {
        command = extractArg(call.args.Target);
      }
    }

    if (command) {
      console.error(`\n[AG LogTailer] Intercepted Antigravity command: ${command}`);
      
      const risk = await riskEngine.analyze(null, 'run_command', { command });
      
      const actionRequest = {
        id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        tool: 'Antigravity Cloud Agent',
        args: { command },
        risk: risk.risk // Un-nest the risk properties
      };

      // Broadcast to Electron Chat Head using WsServer instance
      wsServer.broadcast({
        type: 'ACTION_REQUEST',
        action: actionRequest
      });
    }
  }
}

module.exports = { startLogTailer };
