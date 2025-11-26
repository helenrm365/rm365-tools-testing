/**
 * Order Progress Dashboard
 * Monitor and manage all pick & pack sessions
 */

import { apiCall } from '../../services/api.js';
import { showNotification } from '../../ui/notifications.js';

let currentSessions = [];
let selectedSessionId = null;
let pendingAction = null;

/**
 * Initialize dashboard
 */
export async function init() {
    console.log('[OrderProgress] Initializing dashboard');
    
    wireEventHandlers();
    await loadSessions();
    
    // Auto-refresh every 30 seconds
    setInterval(async () => {
        await loadSessions(false); // Silent refresh
    }, 30000);
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
    
    // Modal close buttons
    document.getElementById('closeModalBtn')?.addEventListener('click', () => {
        document.getElementById('sessionDetailModal').style.display = 'none';
    });
    
    document.getElementById('closeConfirmBtn')?.addEventListener('click', () => {
        document.getElementById('confirmModal').style.display = 'none';
        pendingAction = null;
    });
    
    document.getElementById('cancelActionBtn')?.addEventListener('click', () => {
        document.getElementById('confirmModal').style.display = 'none';
        pendingAction = null;
    });
    
    document.getElementById('confirmActionBtn')?.addEventListener('click', () => {
        executeAction();
    });
    
    // Close modal on background click
    document.getElementById('sessionDetailModal')?.addEventListener('click', (e) => {
        if (e.target.id === 'sessionDetailModal') {
            e.target.style.display = 'none';
        }
    });
    
    document.getElementById('confirmModal')?.addEventListener('click', (e) => {
        if (e.target.id === 'confirmModal') {
            e.target.style.display = 'none';
            pendingAction = null;
        }
    });
}

/**
 * Load all sessions from API
 */
async function loadSessions(showLoading = true) {
    const includeCompleted = document.getElementById('showCompleted').checked;
    const listContainer = document.getElementById('sessionsList');
    
    if (showLoading) {
        listContainer.innerHTML = '<div class="loading">Loading sessions...</div>';
    }
    
    try {
        const response = await apiCall('/magento/dashboard/sessions', {
            method: 'GET',
            params: { include_completed: includeCompleted }
        });
        
        currentSessions = response.sessions || [];
        renderSessions();
        updateStats();
    } catch (error) {
        console.error('[OrderProgress] Failed to load sessions:', error);
        listContainer.innerHTML = `
            <div class="empty-state">
                <p>Failed to load sessions: ${error.message}</p>
                <button class="btn btn-primary" onclick="location.reload()">Retry</button>
            </div>
        `;
    }
}

/**
 * Render sessions list
 */
function renderSessions() {
    const listContainer = document.getElementById('sessionsList');
    
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
function handleAction(action, sessionId, session) {
    selectedSessionId = sessionId;
    
    switch (action) {
        case 'view-details':
            showSessionDetails(session);
            break;
        case 'force-cancel':
            confirmAction('force-cancel', 'Force Cancel Session', 
                `Are you sure you want to cancel the session for Order #${session.order_number}? ${session.current_owner ? `This will stop ${session.current_owner} from continuing.` : ''}`,
                true); // Show reason input
            break;
        case 'force-assign':
            confirmAction('force-assign', 'Reassign Session',
                `Enter the username to assign Order #${session.order_number} to:`,
                false, true); // Show user input
            break;
        case 'takeover':
            confirmAction('takeover', 'Take Over Session',
                `Are you sure you want to take over Order #${session.order_number}? ${session.current_owner ? `${session.current_owner} will be notified.` : ''}`,
                false);
            break;
    }
}

/**
 * Show confirmation modal
 */
function confirmAction(action, title, message, showReason = false, showUserSelect = false) {
    pendingAction = action;
    
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMessage').textContent = message;
    
    const reasonGroup = document.getElementById('reasonGroup');
    const userSelectGroup = document.getElementById('userSelectGroup');
    
    reasonGroup.style.display = showReason ? 'block' : 'none';
    userSelectGroup.style.display = showUserSelect ? 'block' : 'none';
    
    if (showReason) {
        document.getElementById('actionReason').value = '';
    }
    if (showUserSelect) {
        document.getElementById('targetUser').value = '';
    }
    
    document.getElementById('confirmModal').style.display = 'flex';
}

/**
 * Execute confirmed action
 */
async function executeAction() {
    if (!pendingAction || !selectedSessionId) {
        return;
    }
    
    const reason = document.getElementById('actionReason').value;
    const targetUser = document.getElementById('targetUser').value;
    
    // Close modal
    document.getElementById('confirmModal').style.display = 'none';
    
    try {
        let response;
        
        switch (pendingAction) {
            case 'force-cancel':
                response = await apiCall(`/magento/dashboard/sessions/${selectedSessionId}/force-cancel`, {
                    method: 'POST',
                    body: { reason: reason || undefined }
                });
                showNotification('success', 'Session cancelled successfully');
                break;
                
            case 'force-assign':
                if (!targetUser) {
                    showNotification('error', 'Please enter a username');
                    return;
                }
                response = await apiCall(`/magento/dashboard/sessions/${selectedSessionId}/force-assign`, {
                    method: 'POST',
                    body: { target_user_id: targetUser }
                });
                showNotification('success', `Session assigned to ${targetUser}`);
                break;
                
            case 'takeover':
                response = await apiCall(`/magento/dashboard/sessions/${selectedSessionId}/takeover`, {
                    method: 'POST'
                });
                showNotification('success', 'You have taken over the session');
                break;
        }
        
        // Reload sessions
        await loadSessions(false);
        
    } catch (error) {
        console.error('[OrderProgress] Action failed:', error);
        showNotification('error', `Action failed: ${error.message}`);
    }
    
    pendingAction = null;
    selectedSessionId = null;
}

/**
 * Show session details modal
 */
function showSessionDetails(session) {
    const modal = document.getElementById('sessionDetailModal');
    const modalBody = document.getElementById('modalBody');
    
    const createdAt = new Date(session.created_at).toLocaleString();
    const lastModified = session.last_modified_at 
        ? new Date(session.last_modified_at).toLocaleString()
        : 'N/A';
    
    modalBody.innerHTML = `
        <div style="margin-bottom: 20px;">
            <h3>Order #${session.order_number}</h3>
            <p><strong>Invoice:</strong> ${session.invoice_number}</p>
            <p><strong>Session Type:</strong> ${session.session_type}</p>
            <p><strong>Status:</strong> <span class="status-badge ${session.status}">${session.status.replace('_', ' ')}</span></p>
            <p><strong>Created:</strong> ${createdAt} by ${session.created_by}</p>
            <p><strong>Last Modified:</strong> ${lastModified}${session.last_modified_by ? ' by ' + session.last_modified_by : ''}</p>
            ${session.current_owner ? `<p><strong>Current Owner:</strong> ${session.current_owner}</p>` : ''}
            <p><strong>Progress:</strong> ${session.items_scanned} / ${session.items_expected} items (${session.progress_percentage}%)</p>
        </div>
        
        <h4>Full Activity Log</h4>
        ${renderFullAuditLog(session.audit_logs)}
    `;
    
    modal.style.display = 'flex';
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
    
    document.getElementById('statInProgress').textContent = stats.inProgress;
    document.getElementById('statDraft').textContent = stats.draft;
    document.getElementById('statCompleted').textContent = stats.completed;
    document.getElementById('statCancelled').textContent = stats.cancelled;
}

// Initialize on module load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
