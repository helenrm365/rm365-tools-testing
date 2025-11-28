/**
 * Order Progress Dashboard
 * Monitor and manage all pick & pack sessions
 */

import { getApiUrl } from '../../config.js';
import { getToken } from '../../services/state/sessionStore.js';
import { wsService } from '../../services/websocket.js';
import * as progressModals from '../../ui/orderProgressModals.js';

// Helper to get auth headers
function getAuthHeaders() {
    const token = getToken();
    return token ? { 'Authorization': `Bearer ${token}` } : {};
}

let currentSessions = [];
let wsConnected = false;
let refreshTimer = null; // track auto-refresh interval

/**
 * Initialize dashboard
 */
export async function init() {
    wireEventHandlers();
    await loadSessions();
    setupWebSocket();
    
    // Auto-refresh every 30 seconds as fallback
    refreshTimer = setInterval(async () => {
        if (!wsConnected) {
            await loadSessions(false); // Silent refresh if WebSocket not connected
        }
    }, 30000);
}

/**
 * Setup WebSocket for live updates
 */
function setupWebSocket() {
    // Listen for session events
    wsService.on('session_started', handleSessionUpdate);
    wsService.on('session_updated', handleSessionUpdate);
    wsService.on('session_completed', handleSessionUpdate);
    wsService.on('session_cancelled', handleSessionUpdate);
    wsService.on('session_drafted', handleSessionUpdate);
    wsService.on('session_transferred', handleSessionUpdate);
    wsService.on('session_forced_cancel', handleSessionUpdate);
    wsService.on('session_forced_takeover', handleSessionUpdate);
    wsService.on('session_assigned', handleSessionUpdate);
    
    // Check connection status
    if (wsService.connected) {
        wsConnected = true;
    }
}

/**
 * Handle session update from WebSocket
 */
function handleSessionUpdate(data) {
    wsConnected = true;
    
    // Reload sessions to get fresh data
    loadSessions(false);
}

/**
 * Cleanup WebSocket listeners
 */
export function cleanup() {
    wsService.off('session_started', handleSessionUpdate);
    wsService.off('session_updated', handleSessionUpdate);
    wsService.off('session_completed', handleSessionUpdate);
    wsService.off('session_cancelled', handleSessionUpdate);
    wsService.off('session_drafted', handleSessionUpdate);
    wsService.off('session_transferred', handleSessionUpdate);
    wsService.off('session_forced_cancel', handleSessionUpdate);
    wsService.off('session_forced_takeover', handleSessionUpdate);
    wsService.off('session_assigned', handleSessionUpdate);
    
    // Stop auto-refresh timer
    if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = null;
    }
    
    wsConnected = false;
}

/**
 * Wire up event handlers
 */
function wireEventHandlers() {
    // Refresh button
    document.getElementById('refreshBtn').addEventListener('click', () => {
        loadSessions();
    });
    
    // Show completed checkbox
    document.getElementById('showCompleted').addEventListener('change', (e) => {
        loadSessions();
    });
}

/**
 * Load all sessions from API
 */
async function loadSessions(showLoading = true) {
    const showCompletedEl = document.getElementById('showCompleted');
    const includeCompleted = showCompletedEl ? showCompletedEl.checked : false;
    const listContainer = document.getElementById('sessionsList');
    
    if (showLoading) {
        listContainer.innerHTML = '<div class="loading">Loading sessions...</div>';
    }
    
    try {
        const url = `${getApiUrl()}/v1/magento/dashboard/sessions?include_completed=${includeCompleted}`;
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeaders()
            }
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to load sessions');
        }
        
        let data;
        try {
            data = await response.json();
        } catch (e) {
            console.error('[OrderProgress] Non-JSON response when loading sessions:', e);
            throw new Error('Failed to parse sessions response');
        }
        currentSessions = data.sessions || [];
        renderSessions();
        updateStats();
    } catch (error) {
        console.error('[OrderProgress] Failed to load sessions:', error);
        if (listContainer) {
            listContainer.innerHTML = `
                <div class="empty-state">
                    <p>Failed to load sessions: ${error.message}</p>
                    <button class="btn btn-primary" onclick="location.reload()">Retry</button>
                </div>
            `;
        }
    }
}

/**
 * Render sessions list
 */
function renderSessions() {
    const listContainer = document.getElementById('sessionsList');
    if (!listContainer) return; // Exit if DOM doesn't exist (navigated away)
    
    if (currentSessions.length === 0) {
        listContainer.innerHTML = `
            <div class="empty-state">
                <p>No sessions found</p>
            </div>
        `;
        return;
    }
    
    const html = currentSessions.map(session => renderSessionCard(session)).join('');
    listContainer.innerHTML = html;
    
    // Wire up action buttons
    currentSessions.forEach(session => {
        wireSessionActions(session);
    });
}

/**
 * Render a single session card
 */
function renderSessionCard(session) {
    const createdAt = new Date(session.created_at).toLocaleString();
    const lastModified = session.last_modified_at 
        ? new Date(session.last_modified_at).toLocaleString()
        : 'N/A';
    
    const actions = getActionsForSession(session);
    
    // Calculate quantity progress
    let totalQtyExpected = 0;
    let totalQtyScanned = 0;
    
    if (session.items && session.items.length > 0) {
        session.items.forEach(item => {
            totalQtyExpected += item.qty_invoiced || 0;
            totalQtyScanned += item.qty_scanned || 0;
        });
    }
    
    const qtyPercent = totalQtyExpected > 0 ? Math.round((totalQtyScanned / totalQtyExpected) * 100) : 0;
    
    return `
        <div class="session-card" data-session-id="${session.session_id}">
            <div class="session-header">
                <div class="session-info">
                    <h3>Order #${session.order_number}</h3>
                    <div class="session-meta">Invoice: ${session.invoice_number}</div>
                    <div class="session-meta">Type: ${session.session_type}</div>
                    <div class="session-meta">Created: ${createdAt}</div>
                    <div class="session-meta">Last Modified: ${lastModified}</div>
                </div>
                <div class="session-status">
                    <span class="status-badge ${session.status}">${session.status.replace('_', ' ')}</span>
                    ${session.current_owner ? `<div class="session-owner"><i class="fas fa-user"></i> ${session.current_owner}</div>` : ''}
                    ${session.created_by ? `<div class="session-owner"><i class="fas fa-user-plus"></i> Created by: ${session.created_by}</div>` : ''}
                </div>
            </div>
            
            <div class="session-progress">
                <div class="progress-label">
                    <span>Progress: ${session.items_scanned} / ${session.items_expected} items</span>
                    <span>${session.progress_percentage}%</span>
                </div>
                <div class="progress-bar-container">
                    <div class="progress-bar-fill" style="width: ${session.progress_percentage}%"></div>
                </div>
            </div>
            
            <div class="session-progress">
                <div class="progress-label">
                    <span>Total Qty: ${totalQtyScanned} / ${totalQtyExpected} units</span>
                    <span>${qtyPercent}%</span>
                </div>
                <div class="progress-bar-container">
                    <div class="progress-bar-fill" style="width: ${qtyPercent}%"></div>
                </div>
            </div>
            
            ${renderAuditLog(session.audit_logs)}
            
            <div class="session-actions">
                ${actions.map(action => `
                    <button class="btn btn-${action.type}" data-action="${action.action}" data-session-id="${session.session_id}">
                        ${action.label}
                    </button>
                `).join('')}
            </div>
        </div>
    `;
}

/**
 * Render audit log
 */
function renderAuditLog(logs) {
    if (!logs || logs.length === 0) {
        return '';
    }
    
    const recentLogs = logs.slice(-5).reverse(); // Show last 5 entries
    
    return `
        <div class="audit-log">
            <h4>Recent Activity</h4>
            <div class="audit-log-entries">
                ${recentLogs.map(log => {
                    const timestamp = new Date(log.timestamp).toLocaleString();
                    return `
                        <div class="audit-entry">
                            <span class="audit-timestamp">${timestamp}</span>
                            <span class="audit-action ${log.action}">${log.action.replace('_', ' ')}</span>
                            <span class="audit-details">${log.user}${log.details ? ': ' + log.details : ''}</span>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `;
}

/**
 * Get available actions for a session
 */
function getActionsForSession(session) {
    const actions = [];
    
    if (session.status === 'in_progress') {
        actions.push({ action: 'force-cancel', label: 'Force Cancel', type: 'danger' });
        actions.push({ action: 'force-assign', label: 'Reassign', type: 'warning' });
        actions.push({ action: 'takeover', label: 'Take Over', type: 'primary' });
    } else if (session.status === 'draft') {
        actions.push({ action: 'force-cancel', label: 'Cancel Draft', type: 'danger' });
        actions.push({ action: 'force-assign', label: 'Assign', type: 'warning' });
        actions.push({ action: 'takeover', label: 'Claim', type: 'success' });
    }
    
    // View details always available
    actions.push({ action: 'view-details', label: 'View Details', type: 'secondary' });
    
    return actions;
}

/**
 * Wire up action buttons for a session
 */
function wireSessionActions(session) {
    const card = document.querySelector(`[data-session-id="${session.session_id}"]`);
    if (!card) return;
    
    const buttons = card.querySelectorAll('[data-action]');
    buttons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const action = btn.dataset.action;
            const sessionId = btn.dataset.sessionId;
            handleAction(action, sessionId, session);
        });
    });
}

/**
 * Handle action button click
 */
async function handleAction(action, sessionId, session) {
    let result;
    
    switch (action) {
        case 'view-details':
            await progressModals.showSessionDetails(session);
            break;
        case 'force-cancel':
            result = await progressModals.confirmForceCancel(session.order_number, session.current_owner);
            if (result.confirmed) {
                await executeForceCancel(sessionId, result.reason);
            }
            break;
        case 'force-assign':
            result = await progressModals.confirmForceAssign(session.order_number, session.current_owner);
            if (result.confirmed && result.user) {
                await executeForceAssign(sessionId, result.user);
            } else if (result.confirmed && !result.user) {
                await progressModals.alertValidationError('username');
            }
            break;
        case 'takeover':
            result = await progressModals.confirmTakeover(session.order_number, session.current_owner);
            if (result.confirmed) {
                await executeTakeover(sessionId, session);
            }
            break;
    }
}

/**
 * Execute force cancel action
 */
async function executeForceCancel(sessionId, reason) {
    try {
        const response = await fetch(`${getApiUrl()}/v1/magento/dashboard/sessions/${sessionId}/force-cancel`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeaders()
            },
            body: JSON.stringify({ reason: reason || undefined })
        });
        
        if (!response.ok) {
            let detail = 'Failed to cancel session';
            try { const err = await response.json(); detail = err.detail || detail; } catch {}
            throw new Error(detail);
        }
        
        // WebSocket event will update the list
        await loadSessions(false);
    } catch (error) {
        console.error('[OrderProgress] Force cancel failed:', error);
        await progressModals.alertError(`Action failed: ${error.message}`);
    }
}

/**
 * Execute force assign action
 */
async function executeForceAssign(sessionId, targetUser) {
    try {
        const response = await fetch(`${getApiUrl()}/v1/magento/dashboard/sessions/${sessionId}/force-assign`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeaders()
            },
            body: JSON.stringify({ target_user_id: targetUser })
        });
        
        if (!response.ok) {
            let detail = 'Failed to assign session';
            try { const err = await response.json(); detail = err.detail || detail; } catch {}
            throw new Error(detail);
        }
        
        await progressModals.alertActionCompleted('assigned', 'session');
        await loadSessions(false);
    } catch (error) {
        console.error('[OrderProgress] Force assign failed:', error);
        await progressModals.alertError(`Action failed: ${error.message}`);
    }
}

/**
 * Execute takeover action
 */
async function executeTakeover(sessionId, session) {
    try {
        const response = await fetch(`${getApiUrl()}/v1/magento/dashboard/sessions/${sessionId}/takeover`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeaders()
            }
        });
        if (!response.ok) {
            let detail = 'Failed to takeover session';
            try { const err = await response.json(); detail = err.detail || detail; } catch {}
            throw new Error(detail);
        }
        
        const result = await response.json();
        await progressModals.alertActionCompleted('takeover', session.order_number);
        
        // If the backend returned order/invoice, redirect into the active session page
        if (result.order_number && result.invoice_number) {
            const path = `/inventory/order-fulfillment/session-${result.order_number}-${result.invoice_number}`;
            if (window.navigate) {
                window.navigate(path);
            } else {
                history.pushState({ path }, '', path);
                location.reload();
            }
        } else {
            console.warn('[OrderProgress] No order/invoice in takeover result, staying on dashboard');
            await loadSessions(false);
        }
    } catch (error) {
        console.error('[OrderProgress] Takeover failed:', error);
        await progressModals.alertError(`Action failed: ${error.message}`);
    }
}

/**
 * Render full audit log for modal
 */
function renderFullAuditLog(logs) {
    if (!logs || logs.length === 0) {
        return '<p>No activity logged yet.</p>';
    }
    
    const reversedLogs = [...logs].reverse();
    
    return `
        <div class="audit-log-entries" style="max-height: 400px;">
            ${reversedLogs.map(log => {
                const timestamp = new Date(log.timestamp).toLocaleString();
                return `
                    <div class="audit-entry">
                        <span class="audit-timestamp">${timestamp}</span>
                        <span class="audit-action ${log.action}">${log.action.replace('_', ' ')}</span>
                        <span class="audit-details">${log.user}${log.details ? ': ' + log.details : ''}</span>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

/**
 * Update statistics
 */
function updateStats() {
    const stats = {
        inProgress: 0,
        draft: 0,
        completed: 0,
        cancelled: 0
    };
    
    currentSessions.forEach(session => {
        switch (session.status) {
            case 'in_progress':
                stats.inProgress++;
                break;
            case 'draft':
                stats.draft++;
                break;
            case 'completed':
                stats.completed++;
                break;
            case 'cancelled':
                stats.cancelled++;
                break;
        }
    });
    
    const inProgressEl = document.getElementById('statInProgress');
    const draftEl = document.getElementById('statDraft');
    const completedEl = document.getElementById('statCompleted');
    const cancelledEl = document.getElementById('statCancelled');
    
    // Exit if DOM elements don't exist (navigated away)
    if (!inProgressEl || !draftEl || !completedEl || !cancelledEl) return;
    
    inProgressEl.textContent = stats.inProgress;
    draftEl.textContent = stats.draft;
    completedEl.textContent = stats.completed;
    cancelledEl.textContent = stats.cancelled;
}

// Initialize on module load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
