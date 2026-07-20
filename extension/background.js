'use strict';

const WS_URL = 'ws://localhost:7777';
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS  = 30000;
const HEARTBEAT_MS      = 20000;

let ws = null;
let reconnectDelay = RECONNECT_BASE_MS;
let heartbeatTimer = null;
let pendingCount = 0;

// ── WebSocket Connection ──────────────────────────────────────────────────────
function connectWS() {
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    reconnectDelay = RECONNECT_BASE_MS;
    startHeartbeat();
  };

  ws.onmessage = (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }

    if (msg.type === 'ACTION_REQUEST') {
      routeToActiveTab(msg);
    }
  };

  ws.onclose = () => {
    stopHeartbeat();
    setTimeout(connectWS, Math.min(reconnectDelay *= 1.5, RECONNECT_MAX_MS));
  };

  ws.onerror = () => {};
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping' }));
    }
  }, HEARTBEAT_MS);
}

function stopHeartbeat() {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
}

// ── Routing to Content Script ───────────────────────────────────────────────
async function routeToActiveTab(msg) {
  pendingCount++;
  updateBadge();
  
  // Find active tab to show the popup
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.id) {
    chrome.tabs.sendMessage(tab.id, msg).catch(err => console.log('Could not send to tab:', err));
  }
}

// ── Listen for Content Script Replies ────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'ACTION_DECISION') {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'ACTION_DECISION',
        actionId: msg.actionId,
        decision: msg.decision,
        modifiedArgs: msg.modifiedArgs
      }));
      pendingCount = Math.max(0, pendingCount - 1);
      updateBadge();
    }
    saveActionToHistory(msg.historyAction);
    sendResponse({ ok: true });
    return true;
  }
});

function updateBadge() {
  if (pendingCount > 0) {
    chrome.action.setBadgeText({ text: String(pendingCount) });
    chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

async function saveActionToHistory(action) {
  if (!action) return;
  const { actionHistory = [] } = await chrome.storage.local.get('actionHistory');
  actionHistory.unshift(action);
  if (actionHistory.length > 500) actionHistory.pop();
  await chrome.storage.local.set({ actionHistory });
}

// Init
connectWS();
