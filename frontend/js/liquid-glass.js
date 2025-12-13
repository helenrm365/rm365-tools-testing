// Liquid Glass Toggle Logic
(function() {
    const STORAGE_KEY = 'liquidGlassEnabled';
    
    function initLiquidGlass() {
        // Create toggle UI
        const container = document.createElement('div');
        container.className = 'liquid-glass-toggle-container';
        container.innerHTML = `
            <span class="liquid-glass-label">Liquid Glass</span>
            <label class="lg-switch">
                <input type="checkbox" id="liquidGlassToggle">
                <span class="lg-slider"></span>
            </label>
        `;
        document.body.appendChild(container);

        const toggle = document.getElementById('liquidGlassToggle');
        
        // Check saved state
        const isEnabled = localStorage.getItem(STORAGE_KEY) === 'true';
        toggle.checked = isEnabled;
        if (isEnabled) {
            enableLiquidGlass();
        }

        // Event listener
        toggle.addEventListener('change', (e) => {
            if (e.target.checked) {
                enableLiquidGlass();
                localStorage.setItem(STORAGE_KEY, 'true');
            } else {
                disableLiquidGlass();
                localStorage.setItem(STORAGE_KEY, 'false');
            }
        });
    }

    function enableLiquidGlass() {
        document.body.classList.add('liquid-glass-mode');
        
        // Inject CSS if not already present
        if (!document.getElementById('liquid-glass-styles')) {
            const timestamp = new Date().getTime() + 5;
            
            const link = document.createElement('link');
            link.id = 'liquid-glass-styles';
            link.rel = 'stylesheet';
            link.href = `/css/components/liquid-glass/glass-components.css?v=${timestamp}`;
            document.head.appendChild(link);
            
            const sidebarLink = document.createElement('link');
            sidebarLink.id = 'liquid-glass-sidebar';
            sidebarLink.rel = 'stylesheet';
            sidebarLink.href = `/css/sidebar/liquid-glass/sidebar.css?v=${timestamp}`;
            document.head.appendChild(sidebarLink);

            const attendanceLink = document.createElement('link');
            attendanceLink.id = 'liquid-glass-attendance';
            attendanceLink.rel = 'stylesheet';
            attendanceLink.href = `/css/attendance/liquid-glass/attendance.css?v=${timestamp}`;
            document.head.appendChild(attendanceLink);

            const enrollmentLink = document.createElement('link');
            enrollmentLink.id = 'liquid-glass-enrollment';
            enrollmentLink.rel = 'stylesheet';
            enrollmentLink.href = `/css/enrollment/liquid-glass/enrollment.css?v=${timestamp}`;
            document.head.appendChild(enrollmentLink);

            const homeLink = document.createElement('link');
            homeLink.id = 'liquid-glass-home';
            homeLink.rel = 'stylesheet';
            homeLink.href = `/css/home/liquid-glass/home.css?v=${timestamp}`;
            document.head.appendChild(homeLink);

            const inventoryLink = document.createElement('link');
            inventoryLink.id = 'liquid-glass-inventory';
            inventoryLink.rel = 'stylesheet';
            inventoryLink.href = `/css/inventory/liquid-glass/inventory.css?v=${timestamp}`;
            document.head.appendChild(inventoryLink);

            const labelsLink = document.createElement('link');
            labelsLink.id = 'liquid-glass-labels';
            labelsLink.rel = 'stylesheet';
            labelsLink.href = `/css/labels/liquid-glass/labels.css?v=${timestamp}`;
            document.head.appendChild(labelsLink);

            const magentoLink = document.createElement('link');
            magentoLink.id = 'liquid-glass-magentodata';
            magentoLink.rel = 'stylesheet';
            magentoLink.href = `/css/magentodata/liquid-glass/magentodata.css?v=${timestamp}`;
            document.head.appendChild(magentoLink);

            const ordersLink = document.createElement('link');
            ordersLink.id = 'liquid-glass-orders';
            ordersLink.rel = 'stylesheet';
            ordersLink.href = `/css/orders/liquid-glass/orders.css?v=${timestamp}`;
            document.head.appendChild(ordersLink);

            const salesLink = document.createElement('link');
            salesLink.id = 'liquid-glass-salesdata';
            salesLink.rel = 'stylesheet';
            salesLink.href = `/css/salesdata/liquid-glass/salesdata.css?v=${timestamp}`;
            document.head.appendChild(salesLink);

            const usersLink = document.createElement('link');
            usersLink.id = 'liquid-glass-usermanagement';
            usersLink.rel = 'stylesheet';
            usersLink.href = `/css/usermanagement/liquid-glass/usermanagement.css?v=${timestamp}`;
            document.head.appendChild(usersLink);

            const loginLink = document.createElement('link');
            loginLink.id = 'liquid-glass-login';
            loginLink.rel = 'stylesheet';
            loginLink.href = `/css/login/liquid-glass/login.css?v=${timestamp}`;
            document.head.appendChild(loginLink);
        }

        // Add liquid background if not present
        if (!document.querySelector('.liquid-bg')) {
            const bg = document.createElement('div');
            bg.className = 'liquid-bg';
            bg.innerHTML = `
                <div class="blob blob-1"></div>
                <div class="blob blob-2"></div>
                <div class="blob blob-3"></div>
            `;
            document.body.prepend(bg);
        }
    }

    function disableLiquidGlass() {
        document.body.classList.remove('liquid-glass-mode');
        
        // Remove liquid background
        const bg = document.querySelector('.liquid-bg');
        if (bg) bg.remove();
        
        // Note: We don't remove the CSS links to avoid FOUC if re-enabled, 
        // but the classes won't apply without the body class or specific structure
    }

    // Initialize on load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initLiquidGlass);
    } else {
        initLiquidGlass();
    }
})();
