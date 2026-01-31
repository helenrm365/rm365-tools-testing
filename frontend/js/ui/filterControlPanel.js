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
      // Get computed styles for padding
      const computedStyle = window.getComputedStyle(filterPanelBody);
      const paddingTop = parseFloat(computedStyle.paddingTop) || 0;
      const paddingBottom = parseFloat(computedStyle.paddingBottom) || 0;
      const gap = parseFloat(computedStyle.gap) || 0;
      
      // Use getBoundingClientRect for precise measurement of the entire body content
      // This works for any content structure inside filter-panel-body
      const children = Array.from(filterPanelBody.children);
      if (children.length === 0) return paddingTop + paddingBottom;
      
      // Calculate total height by measuring each child and their margins
      let totalHeight = 0;
      children.forEach((child, index) => {
        const rect = child.getBoundingClientRect();
        const childStyle = window.getComputedStyle(child);
        const marginTop = parseFloat(childStyle.marginTop) || 0;
        const marginBottom = parseFloat(childStyle.marginBottom) || 0;
        
        totalHeight += rect.height + marginTop + marginBottom;
        
        // Add gap between children (not after last child)
        if (index < children.length - 1 && gap > 0) {
          totalHeight += gap;
        }
      });
      
      // Add container padding and a small buffer for safety
      return totalHeight + paddingTop + paddingBottom + 16;
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
        // Add expanded class after transition completes to enable overflow: visible
        setTimeout(() => {
          filterPanelBody.classList.add('expanded');
        }, config.animationDuration);
      } else {
        // Collapsing: remove expanded class immediately
        filterPanelBody.classList.remove('expanded');
        filterPanelBody.style.maxHeight = '0';
        filterPanelBody.classList.add('collapsed');
        filterPanelCollapseBtn.classList.add('collapsed');
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
