#!/usr/bin/env node
/**
 * AI Action Guardian — Demo Script
 *
 * Simulates an MCP client sending a series of tool calls to the proxy.
 * Run this AFTER starting the proxy:
 *
 *   Terminal 1: cd proxy && node src/index.js --server cat /dev/null
 *   Terminal 2: node demo/mock-agent.js
 *
 * The demo connects to the proxy's WebSocket (port 7777) and sends
 * tool_call messages directly, bypassing stdio for simplicity.
 */

'use strict';
const { WebSocket } = require('ws');

const WS_URL = 'ws://localhost:7777';

// Sequence of actions to simulate
const DEMO_ACTIONS = [
  {
    description: '1. Read a file (LOW risk — auto-approved)',
    toolCall: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'read_file', arguments: { path: './src/index.js' } } },
  },
  {
    description: '2. List directory (LOW risk — auto-approved)',
    toolCall: { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_dir', arguments: { path: './' } } },
  },
  {
    description: '3. Edit a file (MEDIUM risk — needs approval + shows DIFF)',
    toolCall: { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'write_file', arguments: { path: './README.md', content: '# 🛡️ AI Action Guardian\n\n> **Human-in-the-loop trust layer for AI agents.**\n> Intercepts AI actions safely.\n\n---' } } },
  },
  {
    description: '4. Run git push (HIGH risk — needs approval)',
    toolCall: { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'bash', arguments: { command: 'git push origin main' } } },
  },
  {
    description: '5. Delete build directory (HIGH risk — needs approval)',
    toolCall: { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'bash', arguments: { command: 'rm -rf ./build' } } },
  },
  {
    description: '6. Force push (HIGH risk — needs approval)',
    toolCall: { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'bash', arguments: { command: 'git push origin main --force' } } },
  },
  {
    description: '7. DROP TABLE (CRITICAL — needs approval)',
    toolCall: { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'query', arguments: { query: 'DROP TABLE users;' } } },
  },
];

// ─── Simple standalone demo (direct WebSocket to proxy's WS port) ───────────
// This simulates the risk engine + WS broadcast directly for demo purposes.
// In the real flow, this would be stdin → proxy → risk engine → WS.

const { RiskEngine } = require('../proxy/src/risk-engine');
const engine = new RiskEngine();

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function runDemo() {
  console.log('\n🛡️  AI Action Guardian — Demo\n');
  console.log('Make sure the Chrome extension side panel is open!\n');
  console.log('Make sure the Chrome overlay/extension is open!\n');

  const ws = new WebSocket(WS_URL);

  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', (err) => {
      console.log(`
❌ Could not connect to proxy WebSocket at ws://localhost:7777
   Is the proxy running? Start it first:

   cd proxy && node src/index.js --server cat /dev/null
`);
      reject(err);
    });
    setTimeout(() => reject(new Error('Connection timeout')), 5000);
  });

  console.log('✅ Connected to proxy WebSocket\n');

  for (const demo of DEMO_ACTIONS) {
    const { toolCall } = demo;
    const { name, arguments: args } = toolCall.params;
    const action = engine.analyze(String(toolCall.id), name, args);

    console.log(`─────────────────────────────────────`);
    console.log(`${demo.description}`);
    console.log(`Risk: ${action.risk.level} (${action.risk.score}/100) | ${action.risk.reversible ? '↩ Reversible' : '💀 NOT reversible'}`);
    console.log(`"${action.risk.plain_english}"`);

    if (action.risk.level === 'LOW') {
      console.log(`→ AUTO-APPROVED\n`);
    } else {
      console.log(`→ Sending to extension for approval…`);
      ws.send(JSON.stringify({ type: 'ACTION_REQUEST', action }));

      // Wait for decision
      const decision = await new Promise((resolve) => {
        ws.once('message', (raw) => {
          const msg = JSON.parse(raw.toString());
          if (msg.type === 'ACTION_DECISION' && msg.actionId === action.id) resolve(msg);
        });
        // Also timeout after 30s
        setTimeout(() => resolve({ decision: 'TIMEOUT' }), 30000);
      });

      const icons = { APPROVED: '✅', DENIED: '❌', MODIFIED: '✏️', TIMEOUT: '⏱️' };
      console.log(`→ ${icons[decision.decision] || '?'} ${decision.decision}\n`);
    }

    await delay(800);
  }

  console.log(`─────────────────────────────────────`);
  console.log(`✅ Demo complete!\n`);
  ws.close();
}

runDemo().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
