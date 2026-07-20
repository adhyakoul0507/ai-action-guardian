'use strict';

let shadowRoot = null;
let overlayContainer = null;

// Helpers
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
    return `<span class="${className}">${escHtml(line)}</span>`;
  }).join('\\n');
}

// ── UI Injection ─────────────────────────────────────────────────────────────
function injectOverlay() {
  if (overlayContainer) return;

  overlayContainer = document.createElement('div');
  overlayContainer.id = 'ag-guardian-overlay-root';
  // Position it absolutely outside normal flow to isolate it
  overlayContainer.style.position = 'fixed';
  overlayContainer.style.top = '0';
  overlayContainer.style.left = '0';
  overlayContainer.style.width = '0';
  overlayContainer.style.height = '0';
  overlayContainer.style.zIndex = '2147483647'; // Max z-index
  
  shadowRoot = overlayContainer.attachShadow({ mode: 'closed' });
  
  // Inject CSS
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = chrome.runtime.getURL('content.css');
  shadowRoot.appendChild(link);
  
  const popupWrapper = document.createElement('div');
  popupWrapper.id = 'popup-wrapper';
  shadowRoot.appendChild(popupWrapper);
  
  document.body.appendChild(overlayContainer);
}

// ── Rendering Risk Card ──────────────────────────────────────────────────────
function showRiskCard(action) {
  injectOverlay();
  const wrapper = shadowRoot.getElementById('popup-wrapper');
  
  const { risk, raw } = action;
  const level = risk.level;
  const levelIcons = { LOW: '🟢', MEDIUM: '🟡', HIGH: '🔴', CRITICAL: '⛔' };
  
  const renderExplanation = (text) => text.replace(/`([^`]+)`/g, '<code>$1</code>');

  const cardHtml = `
    <div class="guardian-modal-backdrop"></div>
    <div class="guardian-modal">
      <div class="guardian-header">
        <img src="${chrome.runtime.getURL('icons/icon-48.png')}" alt="Logo" class="guardian-logo">
        <span class="guardian-title">AI Action Guardian</span>
      </div>
      
      <div class="risk-card" data-level="${level}">
        <div class="card-body">
          <div class="card-tool-row">
            <span class="card-tool-name" title="${escHtml(raw.tool_name)}">${escHtml(raw.tool_name)}</span>
            <span class="risk-badge" data-level="${level}">
              ${levelIcons[level]} ${level} <span class="risk-score">${risk.score}</span>
            </span>
          </div>

          <p class="card-explanation">${renderExplanation(escHtml(risk.plain_english))}</p>

          <div class="card-meta">
            <span class="meta-chip ${risk.reversible ? 'reversible' : 'irreversible'}">
              ${risk.reversible ? '✓ Reversible' : '✕ Not reversible'}
            </span>
            <span class="meta-chip">🌐 ${escHtml(risk.blast_radius)}</span>
          </div>

          ${action.diff ? `
          <div class="card-diff">
            <div class="diff-header">
              <span class="diff-meta diff-added">+${action.diff.linesAdded} lines</span>
              <span class="diff-meta diff-removed">-${action.diff.linesRemoved} lines</span>
            </div>
            <pre class="diff-content">${renderDiff(action.diff.diffText)}</pre>
          </div>
          ` : ''}

          <p class="card-recommendation">${escHtml(risk.recommendation)}</p>

          <div class="card-actions">
            <button class="btn btn-approve" id="approve-btn">Approve</button>
            <button class="btn btn-deny" id="deny-btn">Deny</button>
          </div>
        </div>
      </div>
    </div>
  `;

  wrapper.innerHTML = cardHtml;
  
  // Animate in
  const modal = shadowRoot.querySelector('.guardian-modal');
  setTimeout(() => modal.classList.add('visible'), 10);

  // Event Listeners
  const sendDecision = (decision) => {
    modal.classList.remove('visible');
    setTimeout(() => {
      wrapper.innerHTML = '';
      chrome.runtime.sendMessage({
        type: 'ACTION_DECISION',
        actionId: action.id,
        decision: decision,
        historyAction: { ...action, decision: { outcome: decision, decided_at: new Date().toISOString() } }
      });
    }, 200); // Wait for transition
  };

  shadowRoot.getElementById('approve-btn').addEventListener('click', () => sendDecision('APPROVED'));
  shadowRoot.getElementById('deny-btn').addEventListener('click', () => sendDecision('DENIED'));
}

// ── Message Listener ─────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'ACTION_REQUEST') {
    showRiskCard(msg.action);
    sendResponse({ ok: true });
  }
});
