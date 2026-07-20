'use strict';

const WS_URL = 'ws://localhost:7777';
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS  = 30000;
const HEARTBEAT_MS      = 20000;

// ── State ────────────────────────────────────────────────────────────────────
let ws = null;
let reconnectDelay = RECONNECT_BASE_MS;
let heartbeatTimer = null;
let swPort = null;

// Pending actions queue (shown one at a time)
const pendingQueue = [];
let currentCard = null; // the action currently shown

// ── Service Worker Port (keeps SW alive) ─────────────────────────────────────
function connectPort() {
  swPort = chrome.runtime.connect({ name: 'sidepanel' });
  swPort.onDisconnect.addListener(() => {
    setTimeout(connectPort, 1000);
  });
}
connectPort();

// ── WebSocket ────────────────────────────────────────────────────────────────
function connectWS() {
  setStatus('connecting');

  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    reconnectDelay = RECONNECT_BASE_MS;
    setStatus('connected');
    startHeartbeat();
  };

  ws.onmessage = (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }

    if (msg.type === 'ACTION_REQUEST') {
      enqueueAction(msg.action);
    }
    if (msg.type === 'pong') {
      // Connection alive
    }
  };

  ws.onclose = () => {
    stopHeartbeat();
    setStatus('disconnected');
    setTimeout(connectWS, Math.min(reconnectDelay *= 1.5, RECONNECT_MAX_MS));
  };

  ws.onerror = () => {
    // onclose will fire after onerror
  };
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

// ── Status UI ────────────────────────────────────────────────────────────────
function setStatus(state) {
  const dot   = document.getElementById('statusDot');
  const label = document.getElementById('statusLabel');
  dot.className = `status-dot ${state}`;

  const labels = {
    connecting:    'Connecting…',
    connected:     'Proxy connected',
    disconnected:  'Proxy offline',
  };
  label.textContent = labels[state] || state;
}

// ── Pending Queue ────────────────────────────────────────────────────────────
function enqueueAction(action) {
  pendingQueue.push(action);
  updatePendingBadge();

  // Notify SW for badge
  swPort?.postMessage({ type: 'PENDING_COUNT', count: pendingQueue.length });

  // Show next card if nothing is currently displayed
  if (!currentCard) showNextCard();
}

function showNextCard() {
  if (pendingQueue.length === 0) {
    currentCard = null;
    showPendingEmpty(true);
    return;
  }

  const action = pendingQueue[0]; // peek (don't shift yet — shift after decision)
  currentCard = action;
  showPendingEmpty(false);

  const card = buildRiskCard(action);
  const container = document.getElementById('pendingCards');
  // Remove old cards first
  container.querySelectorAll('.risk-card').forEach(el => el.remove());
  container.appendChild(card);
}

function resolveCurrentCard(action, decision, modifiedArgs) {
  // Remove from queue
  const idx = pendingQueue.findIndex(a => a.id === action.id);
  if (idx !== -1) pendingQueue.splice(idx, 1);
  currentCard = null;

  // Animate card out
  const card = document.getElementById(`card-${CSS.escape(action.id)}`);
  if (card) {
    card.style.transition = 'all 200ms ease';
    card.style.opacity = '0';
    card.style.transform = 'scale(0.95)';
    setTimeout(() => card.remove(), 220);
  }

  // Send decision over WebSocket
  sendDecision(action.id, decision, modifiedArgs);

  // Save to history
  const historyAction = { ...action, decision: { outcome: decision, decided_at: new Date().toISOString(), modifiedArgs } };
  addToHistory(historyAction);
  chrome.runtime.sendMessage({ type: 'SAVE_ACTION', action: historyAction });

  updatePendingBadge();
  swPort?.postMessage({ type: 'PENDING_COUNT', count: pendingQueue.length });

  // Show next
  setTimeout(showNextCard, 250);
}

function sendDecision(actionId, decision, modifiedArgs) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'ACTION_DECISION', actionId, decision, modifiedArgs }));
  }
}

function updatePendingBadge() {
  const badge = document.getElementById('pendingCount');
  badge.textContent = pendingQueue.length;
  badge.dataset.count = pendingQueue.length;
}

function showPendingEmpty(show) {
  document.getElementById('pendingEmpty').style.display = show ? 'flex' : 'none';
}

// ── Risk Card Builder ─────────────────────────────────────────────────────────
function buildRiskCard(action) {
  const { risk, raw } = action;
  const level = risk.level;

  const card = document.createElement('div');
  card.className = 'risk-card';
  card.id = `card-${action.id}`;
  card.dataset.level = level;

  const levelIcons = { LOW: '🟢', MEDIUM: '🟡', HIGH: '🔴', CRITICAL: '⛔' };

  // Safely render plain_english with inline code support
  const renderExplanation = (text) => {
    return text.replace(/`([^`]+)`/g, '<code>$1</code>');
  };

  card.innerHTML = `
    <div class="card-body">
      <!-- Tool name + badge -->
      <div class="card-tool-row">
        <span class="card-tool-name" title="${escHtml(raw.tool_name)}">${escHtml(raw.tool_name)}</span>
        <span class="risk-badge" data-level="${level}">
          ${levelIcons[level]} ${level}
          <span class="risk-score">${risk.score}</span>
        </span>
      </div>

      <!-- Plain English -->
      <p class="card-explanation">${renderExplanation(escHtml(risk.plain_english))}</p>

      <!-- Meta chips -->
      <div class="card-meta">
        <span class="meta-chip ${risk.reversible ? 'reversible' : 'irreversible'}">
          ${risk.reversible
            ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg> Reversible`
            : `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg> Not reversible`
          }
        </span>
        <span class="meta-chip">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12H2M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
          ${escHtml(risk.blast_radius)}
        </span>
      </div>

      ${action.diff ? `
      <!-- Diff View -->
      <div class="card-diff">
        <div class="diff-header">
          <span class="diff-meta diff-added">+${action.diff.linesAdded} lines</span>
          <span class="diff-meta diff-removed">-${action.diff.linesRemoved} lines</span>
        </div>
        <pre class="diff-content">${renderDiff(action.diff.diffText)}</pre>
      </div>
      ` : ''}

      <!-- Recommendation -->
      <p class="card-recommendation">${escHtml(risk.recommendation)}</p>

      <!-- Action buttons -->
      <div class="card-actions">
        <button class="btn btn-approve" id="approve-${action.id}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
          Approve
        </button>
        <button class="btn btn-deny" id="deny-${action.id}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          Deny
        </button>
        <button class="btn btn-modify" id="modify-${action.id}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          Modify
        </button>
      </div>
    </div>
  `;

  // Wire buttons
  card.querySelector(`#approve-${action.id}`).addEventListener('click', () => {
    resolveCurrentCard(action, 'APPROVED');
  });

  card.querySelector(`#deny-${action.id}`).addEventListener('click', () => {
    resolveCurrentCard(action, 'DENIED');
  });

  card.querySelector(`#modify-${action.id}`).addEventListener('click', () => {
    openModifyModal(action);
  });

  return card;
}

// ── Modify Modal ──────────────────────────────────────────────────────────────
let _modifyTarget = null;

function openModifyModal(action) {
  _modifyTarget = action;
  const editor = document.getElementById('jsonEditor');
  editor.value = JSON.stringify(action.raw.arguments, null, 2);
  document.getElementById('jsonError').textContent = '';
  document.getElementById('modifyModal').style.display = 'flex';
  editor.focus();
}

function closeModifyModal() {
  document.getElementById('modifyModal').style.display = 'none';
  _modifyTarget = null;
}

document.getElementById('modalClose').addEventListener('click', closeModifyModal);
document.getElementById('modalCancel').addEventListener('click', closeModifyModal);

document.getElementById('modifyModal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('modifyModal')) closeModifyModal();
});

document.getElementById('modalConfirm').addEventListener('click', () => {
  const editor = document.getElementById('jsonEditor');
  let modifiedArgs;
  try {
    modifiedArgs = JSON.parse(editor.value);
    document.getElementById('jsonError').textContent = '';
  } catch (err) {
    document.getElementById('jsonError').textContent = `Invalid JSON: ${err.message}`;
    return;
  }
  const action = _modifyTarget;
  closeModifyModal();
  resolveCurrentCard(action, 'MODIFIED', modifiedArgs);
});

// ── History ───────────────────────────────────────────────────────────────────
function addToHistory(action) {
  const list = document.getElementById('historyList');
  document.getElementById('historyEmpty').style.display = 'none';

  const outcomeIcons = {
    APPROVED:  { icon: '✓', cls: 'approved'  },
    DENIED:    { icon: '✕', cls: 'denied'    },
    MODIFIED:  { icon: '✏', cls: 'modified'  },
    TIMEOUT:   { icon: '⏱', cls: 'timeout'   },
  };
  const outcome = action.decision?.outcome || 'APPROVED';
  const { icon, cls } = outcomeIcons[outcome] || outcomeIcons.APPROVED;

  const item = document.createElement('div');
  item.className = 'history-item';
  item.innerHTML = `
    <div class="history-outcome-icon ${cls}">${icon}</div>
    <div class="history-body">
      <div class="history-tool">${escHtml(action.raw.tool_name)}</div>
      <div class="history-desc">${escHtml(action.risk.plain_english.replace(/`([^`]+)`/g, '$1').slice(0, 60))}</div>
    </div>
    <div class="history-meta">
      <span class="history-level" data-level="${action.risk.level}">${action.risk.level}</span>
      <span class="history-time">${formatTime(action.timestamp)}</span>
    </div>
  `;

  list.insertBefore(item, list.firstChild);

  // Keep only 50 visible items
  const items = list.querySelectorAll('.history-item');
  if (items.length > 50) items[items.length - 1].remove();
}

function loadHistory() {
  chrome.storage.local.get('actionHistory', ({ actionHistory = [] }) => {
    const slice = actionHistory.slice(0, 30);
    if (slice.length > 0) {
      document.getElementById('historyEmpty').style.display = 'none';
      slice.forEach(addToHistory);
    }
  });
}

document.getElementById('clearHistoryBtn').addEventListener('click', () => {
  chrome.storage.local.set({ actionHistory: [] });
  const list = document.getElementById('historyList');
  list.querySelectorAll('.history-item').forEach(el => el.remove());
  document.getElementById('historyEmpty').style.display = 'flex';
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderDiff(diffText) {
  if (!diffText) return '';
  const lines = diffText.split('\\n');
  return lines.map(line => {
    let className = 'diff-line';
    if (line.startsWith('+')) className += ' diff-line-add';
    else if (line.startsWith('-')) className += ' diff-line-remove';
    else if (line.startsWith('@@')) className += ' diff-line-header';
    return \`<span class="\${className}">\${escHtml(line)}</span>\`;
  }).join('\\n');
}

function formatTime(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

// ── Init ──────────────────────────────────────────────────────────────────────
connectWS();
loadHistory();
updatePendingBadge();
showPendingEmpty(true);
