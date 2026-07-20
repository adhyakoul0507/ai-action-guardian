const http = require('http');
const WebSocket = require('ws');
const { RiskEngine } = require('./src/risk-engine');

const riskEngine = new RiskEngine();

function startAppScraper(wsServer) {
  console.error('[AG AppScraper] Looking for Antigravity DevTools on port 49152...');

  http.get('http://localhost:49152/json/list', (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      const pages = JSON.parse(data);
      const page = pages.find(p => p.url && p.url.includes('section=outside-of-project'));
      
      if (!page) {
        console.error('[AG AppScraper] Antigravity window not found. Retrying...');
        setTimeout(() => startAppScraper(wsServer), 5000);
        return;
      }

      console.error('[AG AppScraper] Attached to Antigravity App Memory!');
      connectToPage(page.webSocketDebuggerUrl, wsServer);
    });
  }).on('error', (err) => {
    console.error('[AG AppScraper] Failed to connect to DevTools:', err.message);
    setTimeout(() => startAppScraper(wsServer), 5000);
  });
}

function connectToPage(wsUrl, wsServer) {
  const ws = new WebSocket(wsUrl);
  let id = 1;
  let lastCommand = null;

  ws.on('open', () => {
    setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({
        id: id++,
        method: 'Runtime.evaluate',
        params: {
          expression: 'document.body.innerText',
          returnByValue: true
        }
      }));
    }, 500);
  });

  ws.on('message', async (msg) => {
    const resp = JSON.parse(msg);
    if (resp.result && resp.result.result && resp.result.result.value) {
      const text = resp.result.result.value;
      
      const match = text.match(/Requesting permission to run (.*?)(?:\n|$)/);
      if (match) {
        const command = match[1].trim();
        
        if (command && command !== lastCommand) {
          lastCommand = command;
          console.error(`\n[AG AppScraper] Intercepted pending command off-screen: ${command}`);
          
          const risk = await riskEngine.analyze(null, 'run_command', { command });
          
          wsServer.broadcast({
            type: 'ACTION_REQUEST',
            action: {
              id: `scrape_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
              tool: 'Antigravity Cloud Agent',
              args: { command },
              risk: risk.risk
            }
          });
        }
      } else {
        if (lastCommand !== null) {
          lastCommand = null;
          console.error('[AG AppScraper] Popup resolved, clearing state.');
          wsServer.broadcast({ type: 'ACTION_CLEARED' });
        }
      }
    }
  });

  ws.on('close', () => {
    console.error('[AG AppScraper] Connection lost, reconnecting...');
    setTimeout(() => startAppScraper(wsServer), 5000);
  });
  
  ws.on('error', () => {});
}

module.exports = { startAppScraper };
