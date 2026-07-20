#!/usr/bin/env node
/**
 * Dummy MCP server that stays alive and responds to any tool call with "ok".
 * Used for demo/testing without a real MCP server.
 */
'use strict';

const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

// Respond to initialize
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }

  if (msg.method === 'initialize') {
    const res = {
      jsonrpc: '2.0', id: msg.id,
      result: {
        protocolVersion: '2025-03-26',
        capabilities: { tools: {} },
        serverInfo: { name: 'dummy-server', version: '1.0.0' },
      },
    };
    process.stdout.write(JSON.stringify(res) + '\n');
  }

  if (msg.method === 'tools/list') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools: [] } }) + '\n');
  }

  if (msg.method === 'tools/call') {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0', id: msg.id,
      result: { content: [{ type: 'text', text: '[dummy] tool executed successfully' }], isError: false },
    }) + '\n');
  }
});

// Stay alive
process.stderr.write('[Dummy MCP Server] Running\n');
