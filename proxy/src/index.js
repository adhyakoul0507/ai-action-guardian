#!/usr/bin/env node
'use strict';

require('dotenv').config();
const { MCPProxy } = require('./proxy');

// Parse args: ag-proxy --server <cmd> [args...]
// e.g. ag-proxy --server npx -y @modelcontextprotocol/server-filesystem /home/user
const args = process.argv.slice(2);
const serverIdx = args.indexOf('--server');

let cmdArgs = serverIdx === -1 ? [] : args.slice(serverIdx + 1);

if (cmdArgs.length === 0) {
  console.log('[AG] No background command provided. Defaulting to an idle daemon loop...');
  cmdArgs = ['tail', '-f', '/dev/null'];
}

const serverCmd = cmdArgs[0];
const serverArgs = cmdArgs.slice(1);

const proxy = new MCPProxy(serverCmd, serverArgs);
proxy.start();
