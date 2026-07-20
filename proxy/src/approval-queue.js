'use strict';

const APPROVAL_TIMEOUT_MS = 60_000; // 60 seconds

class ApprovalQueue {
  constructor() {
    // Map of actionId → { resolve, reject, timer }
    this._pending = new Map();
  }

  /**
   * Sends the action to the extension and waits for the human decision.
   * Returns a Promise that resolves with { outcome, modifiedArgs?, reason? }
   */
  waitForDecision(action, wsServer) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this._pending.has(action.id)) {
          this._pending.delete(action.id);
          process.stderr.write(`[AG Queue] ⏰ Timeout for action ${action.id}\n`);
          resolve({ outcome: 'TIMEOUT', reason: 'No response from user within 60 seconds.' });
        }
      }, APPROVAL_TIMEOUT_MS);

      this._pending.set(action.id, { resolve, reject, timer });

      // Broadcast to all connected extension clients
      wsServer.broadcast({ type: 'ACTION_REQUEST', action });
    });
  }

  /**
   * Called by WsServer when user sends a decision from the extension.
   */
  handleDecision(actionId, decision, modifiedArgs) {
    const entry = this._pending.get(actionId);
    if (!entry) {
      process.stderr.write(`[AG Queue] No pending action for id: ${actionId}\n`);
      return;
    }

    clearTimeout(entry.timer);
    this._pending.delete(actionId);

    entry.resolve({ outcome: decision, modifiedArgs });
  }

  pendingCount() {
    return this._pending.size;
  }
}

module.exports = { ApprovalQueue };
