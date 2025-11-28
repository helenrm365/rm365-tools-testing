// Sidebar Animation Fallback
// This provides JavaScript-based animation as a fallback if CSS animations don't work

(function() {
    'use strict';
    
    // Check if CSS transitions are supported
    function supportsTransitions() {
        const testEl = document.createElement('div');
        const props = ['transition', 'WebkitTransition', 'MozTransition', 'OTransition'];
        return props.some(prop => testEl.style[prop] !== undefined);
    }
    
    // Check if user has reduced motion preference
    function prefersReducedMotion() {
        return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }
    
    // JavaScript-based animation fallback
    function animateElement(element, properties, duration = 400) {
        if (prefersReducedMotion()) {
            // Instantly apply final values if user prefers reduced motion
            Object.keys(properties).forEach(prop => {
                element.style[prop] = properties[prop];
            });
            return;
        }
        
        const startTime = performance.now();
        const startValues = {};
        
        Object.keys(properties).forEach(prop => {
            if (prop === 'width') {
                startValues[prop] = element.offsetWidth;
            } else if (prop === 'opacity') {
                startValues[prop] = parseFloat(window.getComputedStyle(element).opacity) || 0;
            }
        });
        
        function animate(currentTime) {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            
            // Easing function (cubic-bezier approximation)
            const eased = progress < 0.5 
                ? 2 * progress * progress 
                : 1 - Math.pow(-2 * progress + 2, 2) / 2;
            
            Object.keys(properties).forEach(prop => {
                const startValue = startValues[prop];
                const endValue = parseFloat(properties[prop]);
                const currentValue = startValue + (endValue - startValue) * eased;
                
                if (prop === 'width') {
                    element.style.width = currentValue + 'px';
                } else if (prop === 'opacity') {
                    element.style.opacity = currentValue;
                }
            });
            
            if (progress < 1) {
                requestAnimationFrame(animate);
            }
        }
        
        requestAnimationFrame(animate);
    }
    
    function initSidebarFallback() {
        const sidebar = document.getElementById('sidebar');
        if (!sidebar) return;
        
        // Only use fallback if CSS transitions aren't supported or working
        if (supportsTransitions()) {
            return;
        }
        let isExpanded = false;
        let animating = false;
        
        function expandSidebar() {
            if (animating || isExpanded) return;
            animating = true;
            isExpanded = true;
            
            // Animate sidebar width
            animateElement(sidebar, { width: '260' }, 400);
            
            // Animate labels
            const labels = sidebar.querySelectorAll('.label');
            labels.forEach((label, index) => {
                setTimeout(() => {
                    animateElement(label, { opacity: '1' }, 300);
                    label.style.transform = 'translateX(0)';
                }, index * 50 + 100);
            });
            
            setTimeout(() => { animating = false; }, 450);
        }
        
        function collapseSidebar() {
            if (animating || !isExpanded) return;
            animating = true;
            isExpanded = false;
            
            // Animate labels first
            const labels = sidebar.querySelectorAll('.label');
            labels.forEach((label) => {
                animateElement(label, { opacity: '0' }, 200);
                label.style.transform = 'translateX(-10px)';
            });
            
            // Then animate sidebar width
            setTimeout(() => {
                animateElement(sidebar, { width: '80' }, 300);
            }, 100);
            
            setTimeout(() => { animating = false; }, 450);
        }
        
        // Add event listeners
        sidebar.addEventListener('mouseenter', expandSidebar);
        sidebar.addEventListener('mouseleave', collapseSidebar);
    }
    
    // Force enable fallback for testing
    function forceJSAnimation() {
        const sidebar = document.getElementById('sidebar');
        if (!sidebar) return;
        
        // Disable CSS transitions
        sidebar.style.transition = 'none';
        const labels = sidebar.querySelectorAll('.label');
        labels.forEach(label => {
            label.style.transition = 'none';
        });
        initSidebarFallback();
    }
    
    // Auto-initialize
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initSidebarFallback);
    } else {
        initSidebarFallback();
    }
    
    // Expose for testing
    window.SidebarFallback = {
        init: initSidebarFallback,
        forceJS: forceJSAnimation,
        supportsTransitions: supportsTransitions,
        prefersReducedMotion: prefersReducedMotion
    };
})();
