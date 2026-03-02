/**
 * Filter Control Panel Component
 * Handles dynamic collapsible filter panel with smooth animations
 * 
 * Usage:
 * FilterControlPanel.init('filterPanelCollapseBtn', 'filterPanelBody');
 * 
 * HTML Structure Required:
 * <div class="unified-filter-panel">
 *   <div class="filter-panel-header">
 *     <button id="filterPanelCollapseBtn" class="filter-panel-collapse collapsed">
 *       <i class="fas fa-chevron-up"></i>
 *     </button>
 *   </div>
 *   <div class="filter-panel-body collapsed" id="filterPanelBody">
 *     <div class="filter-panel-grid">
 *       <!-- Content here -->
 *     </div>
 *   </div>
 * </div>
 */

const FilterControlPanel = {
  /**
   * Initialize the filter control panel
   * @param {string} collapseButtonId - ID of the collapse button
   * @param {string} panelBodyId - ID of the panel body
   * @param {Object} options - Optional configuration
   * @param {number} options.animationDuration - Animation duration in ms (default: 450)
   */
  init(collapseButtonId, panelBodyId, options = {}) {
    const filterPanelCollapseBtn = document.getElementById(collapseButtonId);
    const filterPanelBody = document.getElementById(panelBodyId);
    
    if (!filterPanelCollapseBtn || !filterPanelBody) {
      console.warn(`FilterControlPanel: Could not find elements with IDs '${collapseButtonId}' or '${panelBodyId}'`);
      return null;
    }

    const config = {
      animationDuration: options.animationDuration || 450
    };

    const getContentHeight = () => {
      // If collapsed, we need to temporarily uncollapse to measure
      const wasCollapsed = filterPanelBody.classList.contains('collapsed');
      if (wasCollapsed) {
        // Remove collapsed to allow children to render at natural size
        // Use visibility:hidden to prevent flash
        filterPanelBody.style.visibility = 'hidden';
        filterPanelBody.classList.remove('collapsed');
        filterPanelBody.style.maxHeight = 'none';
      }

      // Batch-read all child rects (single reflow)
      const children = filterPanelBody.children;
      if (children.length === 0) {
        if (wasCollapsed) {
          filterPanelBody.classList.add('collapsed');
          filterPanelBody.style.maxHeight = '0';
          filterPanelBody.style.visibility = '';
        }
        return 0;
      }

      const rects = [];
      for (let i = 0; i < children.length; i++) {
        rects.push(children[i].getBoundingClientRect());
      }
      const top = rects[0].top;
      const bottom = rects[rects.length - 1].bottom;
      // Account for margins not captured by getBoundingClientRect
      const lastMargin = parseFloat(getComputedStyle(children[children.length - 1]).marginBottom) || 0;
      const firstMargin = parseFloat(getComputedStyle(children[0]).marginTop) || 0;
      const height = Math.ceil(bottom - top + firstMargin + lastMargin);

      // Restore collapsed state immediately (before paint)
      if (wasCollapsed) {
        filterPanelBody.classList.add('collapsed');
        filterPanelBody.style.maxHeight = '0';
        filterPanelBody.style.visibility = '';
      }

      return height;
    };
    
    // Set initial height when expanded (with slight delay for DOM)
    setTimeout(() => {
      if (!filterPanelBody.classList.contains('collapsed')) {
        filterPanelBody.style.maxHeight = getContentHeight() + 'px';
      } else {
        // Set max-height to 0 explicitly for collapsed state so first animation works
        filterPanelBody.style.maxHeight = '0';
      }
    }, 50);
    
    filterPanelCollapseBtn.addEventListener('click', () => {
      if (filterPanelBody.classList.contains('collapsed')) {
        // Expanding: measure first, then expand
        const height = getContentHeight();
        filterPanelBody.classList.remove('collapsed');
        filterPanelCollapseBtn.classList.remove('collapsed');
        // Use requestAnimationFrame to ensure smooth transition
        requestAnimationFrame(() => {
          filterPanelBody.style.maxHeight = height + 'px';
        });
        // After transition: enable overflow for dropdowns, keep pixel height
        setTimeout(() => {
          filterPanelBody.classList.add('expanded');
        }, config.animationDuration);
      } else {
        // Collapsing: add collapsed class immediately (for header margin, gap, opacity)
        // then animate max-height to 0 (inline style overrides the CSS max-height: 0)
        filterPanelBody.classList.remove('expanded');
        filterPanelBody.classList.add('collapsed');
        filterPanelCollapseBtn.classList.add('collapsed');
        // Inline style drives the transition since it overrides the class value
        filterPanelBody.style.maxHeight = '0';
      }
    });
    
    // Update height on window resize
    let resizeTimeout;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        if (!filterPanelBody.classList.contains('collapsed')) {
          filterPanelBody.style.maxHeight = getContentHeight() + 'px';
        }
      }, 100);
    });

    // Return API for external control
    return {
      expand() {
        if (filterPanelBody.classList.contains('collapsed')) {
          filterPanelCollapseBtn.click();
        }
      },
      collapse() {
        if (!filterPanelBody.classList.contains('collapsed')) {
          filterPanelCollapseBtn.click();
        }
      },
      toggle() {
        filterPanelCollapseBtn.click();
      },
      isExpanded() {
        return !filterPanelBody.classList.contains('collapsed');
      },
      updateHeight() {
        if (!filterPanelBody.classList.contains('collapsed')) {
          filterPanelBody.style.maxHeight = getContentHeight() + 'px';
        }
      }
    };
  }
};

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = FilterControlPanel;
}
