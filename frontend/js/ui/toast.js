// Toast notification system - stacking toasts with newest at bottom
export function showToast(message, type = 'info') {
    // Create toast container if it doesn't exist
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            z-index: 10000;
            display: flex;
            flex-direction: column-reverse;
            gap: 10px;
            max-width: 400px;
            pointer-events: none;
        `;
        document.body.appendChild(container);
    }
    
    // Create toast element - use unique class name to avoid CSS conflicts
    const toast = document.createElement('div');
    toast.className = `stacking-toast stacking-toast-${type}`;
    
    // Set colors based on type
    const colors = {
        success: { bg: '#10b981', icon: '✓' },
        error: { bg: '#ef4444', icon: '✕' },
        warning: { bg: '#f59e0b', icon: '⚠' },
        info: { bg: '#3b82f6', icon: 'ℹ' }
    };
    
    const color = colors[type] || colors.info;
    
    // Use position: relative (not fixed) so toasts stack in the flex container
    toast.style.cssText = `
        position: relative;
        background: ${color.bg};
        color: white;
        padding: 12px 16px;
        border-radius: 8px;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        display: flex;
        align-items: center;
        gap: 10px;
        animation: slideInFromBottom 0.3s ease-out;
        font-size: 14px;
        line-height: 1.5;
        pointer-events: auto;
    `;
    
    toast.innerHTML = `
        <span style="font-size: 18px; font-weight: bold;">${color.icon}</span>
        <span style="flex: 1;">${message}</span>
    `;
    
    // Insert at BEGINNING so it appears at bottom visually (due to column-reverse)
    container.insertBefore(toast, container.firstChild);
    
    // Auto-remove after 4 seconds - fade up and out like a card leaving the deck
    setTimeout(() => {
        toast.style.animation = 'fadeUpAndOut 0.4s ease-out forwards';
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
            // Remove container if empty
            if (container.children.length === 0 && container.parentNode) {
                container.parentNode.removeChild(container);
            }
        }, 400);
    }, 4000);
}

// Add animations to document if not already present
if (typeof document !== 'undefined') {
    const styleId = 'toast-animations';
    if (!document.getElementById(styleId)) {
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
            @keyframes slideInFromBottom {
                from {
                    transform: translateY(50px);
                    opacity: 0;
                }
                to {
                    transform: translateY(0);
                    opacity: 1;
                }
            }
            @keyframes fadeUpAndOut {
                from {
                    transform: translateY(0);
                    opacity: 1;
                }
                to {
                    transform: translateY(-20px);
                    opacity: 0;
                }
            }
        `;
        document.head.appendChild(style);
    }
}
