let currentActionId = null;
let isExpanded = false;

let ws;

function connect() {
  ws = new WebSocket('ws://localhost:7777');

  ws.onopen = () => {
    console.log('Connected to Proxy WS');
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      switch (msg.type) {
        case 'ACTION_REQUEST':
          handleActionRequest(msg.action);
          break;
        case 'ACTION_CLEARED':
          handleActionCleared();
          break;
        default:
          console.warn('Unknown message type:', msg.type);
      }
    } catch (e) {
      console.error('Failed to parse message:', e);
    }
  };

  ws.onclose = () => {
    console.log('Proxy WS disconnected. Reconnecting in 1s...');
    setTimeout(connect, 1000);
  };
}

connect();

function getRiskIcon(level) {
  if (level === 'CRITICAL' || level === 'HIGH') {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;
  } else if (level === 'MEDIUM') {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;
  } else {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`;
  }
}

function handleActionRequest(action) {
  currentActionId = action.id;
  
  const bubble = document.getElementById('bubble');
  bubble.className = 'bubble'; 
  if (!isExpanded) {
    if (action.risk.level === 'CRITICAL' || action.risk.level === 'HIGH') {
      bubble.classList.add('glow-red');
    } else if (action.risk.level === 'MEDIUM') {
      bubble.classList.add('glow-yellow');
    } else {
      bubble.classList.add('glow-green');
    }
  }

  const detailsEl = document.getElementById('details-content');
  detailsEl.innerHTML = `
    <div class="action-header">
      <span class="tool-name">${action.tool}</span>
      <span class="risk-badge risk-${action.risk.level.toLowerCase()}">
        ${getRiskIcon(action.risk.level)} ${action.risk.level} RISK
      </span>
    </div>
    
    <div class="tags">
      <span class="tag ${action.risk.reversible ? '' : 'irreversible'}">
        ${action.risk.reversible ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><polyline points="3 3 3 8 8 8"></polyline></svg> Reversible' : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg> Irreversible'}
      </span>
      <span class="tag scope">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
        ${action.risk.impact_scope || 'LOCAL'}
      </span>
    </div>

    <div class="command-box">
      ${action.args.command || action.args.path || JSON.stringify(action.args)}
    </div>

    <div class="plain-english">
      ${action.risk.plain_english}
    </div>
  `;
}

function handleActionCleared() {
  currentActionId = null;
  const bubble = document.getElementById('bubble');
  bubble.className = 'bubble'; // remove all glows
  if (isExpanded) {
    toggleExpand();
  }
}

function toggleExpand() {
  // Use IPC to resize the electron window
  const container = document.getElementById('container');
  const bubble = document.getElementById('bubble');
  const panel = document.getElementById('panel');

  if (isExpanded) {
    // Collapse
    panel.style.display = 'none';
    bubble.style.display = 'flex';
    container.classList.remove('expanded');
    isExpanded = false;
    // Tell electron main process to resize back to bubble
    if (window.electronAPI) window.electronAPI.resizeWindow({ width: 80, height: 80 });
  } else {
    // Expand
    bubble.style.display = 'none';
    panel.style.display = 'flex';
    container.classList.add('expanded');
    isExpanded = true;
    // Tell electron main process to resize to panel
    if (window.electronAPI) window.electronAPI.resizeWindow({ width: 380, height: 400 });
  }
}

document.getElementById('bubble').addEventListener('click', () => {
  if (currentActionId) toggleExpand();
});
document.getElementById('close-btn').addEventListener('click', toggleExpand);
