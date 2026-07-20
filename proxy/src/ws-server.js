'use strict';

const { WebSocketServer } = require('ws');
const { startAppScraper } = require('../app_scraper');

class WsServer {
  constructor(port, approvalQueue) {
    this.port = port;
    this.approvalQueue = approvalQueue;
    this.wss = null;
    this.clients = new Set();
  }

  start() {
    this.wss = new WebSocketServer({ port: this.port });

    this.wss.on('listening', () => {
      process.stderr.write(`[AG WS] Listening on ws://localhost:${this.port}\n`);
      
      // Start scraping local Antigravity memory once the server is up
      startAppScraper(this);
    });

    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      process.stderr.write(`[AG WS] Extension connected (${this.clients.size} clients)\n`);

      ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch { return; }

        if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
          return;
        }

        if (msg.type === 'ACTION_DECISION') {
          // { type, actionId, decision: 'APPROVED'|'DENIED'|'MODIFIED', modifiedArgs? }
          this.approvalQueue.handleDecision(msg.actionId, msg.decision, msg.modifiedArgs);
        }
        
        if (msg.type === 'ACTION_REQUEST') {
          // For testing: Relay requests from mock-agent to all UI clients
          this.broadcast(msg);
        }
      });

      ws.on('close', () => {
        this.clients.delete(ws);
        process.stderr.write(`[AG WS] Extension disconnected (${this.clients.size} clients)\n`);
      });

      ws.on('error', (err) => {
        process.stderr.write(`[AG WS] Client error: ${err.message}\n`);
        this.clients.delete(ws);
      });

      // Send hello so extension knows proxy is ready
      ws.send(JSON.stringify({ type: 'PROXY_READY', version: '1.0.0' }));
    });

    this.wss.on('error', (err) => {
      process.stderr.write(`[AG WS] Server error: ${err.message}\n`);
    });
  }

  broadcast(msg) {
    const payload = JSON.stringify(msg);
    for (const client of this.clients) {
      if (client.readyState === 1 /* OPEN */) {
        client.send(payload);
      }
    }
    if (this.clients.size === 0) {
      process.stderr.write(`[AG WS] ⚠️  No extension clients connected — action will timeout!\n`);
    }
  }
}

module.exports = { WsServer };
