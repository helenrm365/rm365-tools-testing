// frontend/js/utils/dashboardExport.js

/**
 * Export dashboard data (Real-Time Status, Punctuality & Compliance) to PDF or CSV
 * Uses jsPDF library loaded from CDN
 */

/**
 * Load jsPDF library dynamically
 */
async function loadJsPDF() {
    if (window.jspdf) {
        return window.jspdf;
    }
    
    return new Promise((resolve, reject) => {
        // Load jsPDF
        const jsPDFScript = document.createElement('script');
        jsPDFScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
        jsPDFScript.onload = () => {
            // Load autoTable plugin
            const autoTableScript = document.createElement('script');
            autoTableScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js';
            autoTableScript.onload = () => {
                if (window.jspdf) {
                    resolve(window.jspdf);
                } else {
                    reject(new Error('jsPDF failed to load'));
                }
            };
            autoTableScript.onerror = () => reject(new Error('Failed to load jsPDF autoTable'));
            document.head.appendChild(autoTableScript);
        };
        jsPDFScript.onerror = () => reject(new Error('Failed to load jsPDF'));
        document.head.appendChild(jsPDFScript);
    });
}

/**
 * Convert image to base64 data URL and get dimensions
 */
async function loadImageAsBase64(imagePath) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'Anonymous';
        img.onload = function() {
            const canvas = document.createElement('canvas');
            canvas.width = this.width;
            canvas.height = this.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(this, 0, 0);
            try {
                const dataURL = canvas.toDataURL('image/png');
                resolve({
                    dataURL,
                    width: this.width,
                    height: this.height
                });
            } catch (e) {
                reject(e);
            }
        };
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = imagePath;
    });
}

/**
 * Theme colors matching RM365 branding
 */
const THEME = {
    brandGreen: [139, 195, 74],      // #8bc34a - Primary brand color
    darkGreen: [122, 184, 45],       // #7ab82d - Darker shade
    headerText: [26, 26, 26],        // #1a1a1a - Dark text
    bodyText: [51, 51, 51],          // #333333 - Body text
    lightGray: [245, 245, 245],      // #f5f5f5 - Light background
    mediumGray: [102, 102, 102],     // #666666 - Secondary text
    borderGray: [229, 231, 235],     // #e5e7eb - Borders
    warningOrange: [255, 152, 0],    // #ff9800 - Warning
    errorRed: [244, 67, 54],         // #f44336 - Error
    infoBlue: [33, 150, 243],        // #2196f3 - Info
    successGreen: [76, 175, 80],     // #4caf50 - Success
    clockInGreen: [212, 237, 218],   // Light green for clock in
    clockOutRed: [248, 215, 218],    // Light red for clock out
    lateOrange: [255, 243, 224],     // Light orange for late
    earlyYellow: [255, 253, 231],    // Light yellow for early
    missingPurple: [243, 229, 245],  // Light purple for missing
};

/**
 * Report type configurations
 */
const REPORT_CONFIGS = {
    // Real-Time Status reports
    attendance: {
        title: 'TODAY\'S ATTENDANCE REPORT',
        subtitle: 'Employees currently clocked in',
        icon: '✓',
        columns: ['Employee', 'Location', 'First Clock In', 'Current Status'],
        mapRow: (item) => [
            item.name || 'N/A',
            item.location || '-',
            item.time || '-',
            formatStatus(item.status)
        ],
        accentColor: THEME.successGreen,
        summaryLabel: 'Total Present'
    },
    absences: {
        title: 'TODAY\'S ABSENCES REPORT',
        subtitle: 'Employees not clocked in today',
        icon: '✗',
        columns: ['Employee', 'Location', 'Expected Start', 'Status'],
        mapRow: (item) => [
            item.name || 'N/A',
            item.location || '-',
            item.expected_time || '-',
            'Absent'
        ],
        accentColor: THEME.errorRed,
        summaryLabel: 'Total Absent'
    },
    breaks: {
        title: 'ACTIVE BREAKS REPORT',
        subtitle: 'Employees currently on break',
        icon: '☕',
        columns: ['Employee', 'Location', 'Break Started', 'Duration'],
        mapRow: (item) => [
            item.name || 'N/A',
            item.location || '-',
            item.time || '-',
            item.duration || '-'
        ],
        accentColor: THEME.infoBlue,
        summaryLabel: 'On Break'
    },
    // Punctuality & Compliance reports
    late: {
        title: 'LATE ARRIVALS REPORT',
        subtitle: 'Employees who arrived late',
        icon: '⏰',
        columns: ['Employee', 'Location', 'Date', 'Arrival Time'],
        mapRow: (item) => [
            item.name || 'N/A',
            item.location || '-',
            formatDate(item.date),
            item.time || '-'
        ],
        accentColor: THEME.warningOrange,
        summaryLabel: 'Late Arrivals'
    },
    early: {
        title: 'EARLY DEPARTURES REPORT',
        subtitle: 'Employees who left early',
        icon: '🚪',
        columns: ['Employee', 'Location', 'Date', 'Departure Time'],
        mapRow: (item) => [
            item.name || 'N/A',
            item.location || '-',
            formatDate(item.date),
            item.time || '-'
        ],
        accentColor: THEME.warningOrange,
        summaryLabel: 'Early Departures'
    },
    missing: {
        title: 'MISSING PUNCHES REPORT',
        subtitle: 'Employees with incomplete time records',
        icon: '⚠',
        columns: ['Employee', 'Location', 'Date', 'Issue'],
        mapRow: (item) => [
            item.name || 'N/A',
            item.location || '-',
            formatDate(item.date),
            item.issue || '-'
        ],
        accentColor: THEME.errorRed,
        summaryLabel: 'Missing Punches'
    }
};

/**
 * Format status for display
 */
function formatStatus(status) {
    const statusLabels = {
        'in': 'Clocked In',
        'out': 'Clocked Out',
        'on_break': 'On Break',
        'absent': 'Absent'
    };
    return statusLabels[status] || status || '-';
}

/**
 * Format date for display
 */
function formatDate(dateStr) {
    if (!dateStr) return '-';
    try {
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-GB', { 
            day: '2-digit', 
            month: 'short', 
            year: 'numeric' 
        });
    } catch {
        return dateStr;
    }
}

/**
 * Get current date/time formatted
 */
function getCurrentDateTime() {
    return new Date().toLocaleDateString('en-GB', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

/**
 * Export data to PDF
 * @param {Array} data - Array of data objects
 * @param {string} reportType - Type of report (attendance, absences, breaks, late, early, missing)
 * @param {Object} filters - Current filter settings
 * @param {boolean} openPrint - Whether to open print dialog instead of downloading
 */
export async function exportDashboardToPDF(data, reportType, filters = {}, openPrint = false) {
    try {
        const config = REPORT_CONFIGS[reportType];
        if (!config) {
            throw new Error(`Unknown report type: ${reportType}`);
        }

        // Load jsPDF
        const jspdf = await loadJsPDF();
        const { jsPDF } = jspdf;
        
        // Create new PDF document (A4, portrait)
        const doc = new jsPDF();
        
        // Try to load and add logo
        try {
            const logoImage = await loadImageAsBase64('/assets/RM365_Logo_New.png');
            const maxLogoWidth = 40;
            const aspectRatio = logoImage.height / logoImage.width;
            const logoWidth = maxLogoWidth;
            const logoHeight = maxLogoWidth * aspectRatio;
            doc.addImage(logoImage.dataURL, 'PNG', doc.internal.pageSize.width - 54, 10, logoWidth, logoHeight);
        } catch (error) {
            console.warn('Could not load logo:', error);
        }
        
        // Header with brand color accent bar
        doc.setFillColor(config.accentColor[0], config.accentColor[1], config.accentColor[2]);
        doc.rect(0, 0, doc.internal.pageSize.width, 6, 'F');
        
        // Title Section
        doc.setFontSize(20);
        doc.setTextColor(THEME.headerText[0], THEME.headerText[1], THEME.headerText[2]);
        doc.setFont(undefined, 'bold');
        doc.text(config.title, 14, 22);
        
        // Subtitle with accent color
        doc.setFontSize(11);
        doc.setTextColor(config.accentColor[0], config.accentColor[1], config.accentColor[2]);
        doc.setFont(undefined, 'normal');
        doc.text(config.subtitle, 14, 29);
        
        // Metadata Section
        doc.setFontSize(9);
        doc.setFont(undefined, 'normal');
        doc.setTextColor(THEME.mediumGray[0], THEME.mediumGray[1], THEME.mediumGray[2]);
        
        let metaY = 36;
        
        // Info box with light background
        doc.setFillColor(THEME.lightGray[0], THEME.lightGray[1], THEME.lightGray[2]);
        const hasFilters = filters.location || filters.dateRange || filters.nameSearch;
        const infoBoxHeight = hasFilters ? 20 : 12;
        doc.roundedRect(14, metaY - 3, doc.internal.pageSize.width - 28, infoBoxHeight, 2, 2, 'F');
        
        // Date and record count
        doc.setTextColor(THEME.bodyText[0], THEME.bodyText[1], THEME.bodyText[2]);
        doc.setFont(undefined, 'bold');
        doc.text('Generated:', 18, metaY + 2);
        doc.setFont(undefined, 'normal');
        doc.text(getCurrentDateTime(), 40, metaY + 2);
        
        doc.setFont(undefined, 'bold');
        doc.text('Total Records:', 120, metaY + 2);
        doc.setFont(undefined, 'normal');
        doc.text(data.length.toString(), 150, metaY + 2);
        
        // Show active filters if any
        if (hasFilters) {
            metaY += 8;
            doc.setFont(undefined, 'bold');
            doc.text('Filters:', 18, metaY + 2);
            doc.setFont(undefined, 'normal');
            
            let filterText = [];
            if (filters.location) filterText.push(`Location: ${filters.location}`);
            if (filters.dateRange) filterText.push(`Date: ${filters.dateRange}`);
            if (filters.nameSearch) filterText.push(`Employee: ${filters.nameSearch}`);
            doc.text(filterText.join(' | '), 40, metaY + 2);
        }
        
        // Table data
        const headers = [config.columns];
        const rows = data.map(config.mapRow);
        
        // Calculate start Y based on info box
        const tableStartY = metaY + infoBoxHeight + 2;
        
        // Determine column widths based on report type
        let columnStyles = {};
        if (['attendance', 'absences', 'breaks'].includes(reportType)) {
            columnStyles = {
                0: { cellWidth: 55 },  // Employee
                1: { cellWidth: 40 },  // Location
                2: { cellWidth: 35, halign: 'center' },  // Time
                3: { cellWidth: 'auto', halign: 'center' }  // Status
            };
        } else {
            columnStyles = {
                0: { cellWidth: 50 },  // Employee
                1: { cellWidth: 40 },  // Location
                2: { cellWidth: 35, halign: 'center' },  // Date
                3: { cellWidth: 'auto', halign: 'center' }  // Time/Issue
            };
        }
        
        // Add table with enhanced styling
        doc.autoTable({
            head: headers,
            body: rows,
            startY: tableStartY,
            theme: 'plain',
            styles: {
                fontSize: 9,
                cellPadding: 5,
                textColor: THEME.bodyText,
                overflow: 'ellipsize',
                valign: 'middle',
                lineColor: THEME.borderGray,
                lineWidth: 0.1
            },
            headStyles: {
                fillColor: config.accentColor,
                textColor: [255, 255, 255],
                fontStyle: 'bold',
                fontSize: 10,
                minCellHeight: 12,
                halign: 'left'
            },
            columnStyles: columnStyles,
            alternateRowStyles: {
                fillColor: THEME.lightGray
            },
            didParseCell: function(cellData) {
                // Apply special styling for status column
                if (cellData.section === 'body' && cellData.column.index === 3) {
                    const cellValue = cellData.cell.raw?.toLowerCase();
                    if (cellValue?.includes('clocked in') || cellValue?.includes('present')) {
                        cellData.cell.styles.textColor = [21, 87, 36];
                        cellData.cell.styles.fillColor = THEME.clockInGreen;
                    } else if (cellValue?.includes('clocked out') || cellValue?.includes('absent')) {
                        cellData.cell.styles.textColor = [114, 28, 36];
                        cellData.cell.styles.fillColor = THEME.clockOutRed;
                    } else if (cellValue?.includes('break')) {
                        cellData.cell.styles.textColor = [13, 71, 161];
                        cellData.cell.styles.fillColor = [227, 242, 253];
                    }
                }
            },
            margin: { top: 40, left: 14, right: 14 },
            didDrawPage: function(pageData) {
                // Header on subsequent pages
                if (doc.internal.getCurrentPageInfo().pageNumber > 1) {
                    doc.setFillColor(config.accentColor[0], config.accentColor[1], config.accentColor[2]);
                    doc.rect(0, 0, doc.internal.pageSize.width, 4, 'F');
                    
                    doc.setFontSize(10);
                    doc.setTextColor(THEME.mediumGray[0], THEME.mediumGray[1], THEME.mediumGray[2]);
                    doc.setFont(undefined, 'normal');
                    doc.text(config.title, 14, 10);
                }
                
                // Footer with page numbers
                const pageCount = doc.internal.getNumberOfPages();
                const pageHeight = doc.internal.pageSize.height;
                const pageWidth = doc.internal.pageSize.width;
                
                // Footer line
                doc.setDrawColor(config.accentColor[0], config.accentColor[1], config.accentColor[2]);
                doc.setLineWidth(0.5);
                doc.line(14, pageHeight - 15, pageWidth - 14, pageHeight - 15);
                
                // Page number
                doc.setFontSize(8);
                doc.setTextColor(THEME.mediumGray[0], THEME.mediumGray[1], THEME.mediumGray[2]);
                doc.setFont(undefined, 'normal');
                const footerText = `Page ${doc.internal.getCurrentPageInfo().pageNumber} of ${pageCount}`;
                doc.text(footerText, pageWidth / 2, pageHeight - 10, { align: 'center' });
                
                // RM365 branding
                doc.setFontSize(7);
                doc.setTextColor(THEME.brandGreen[0], THEME.brandGreen[1], THEME.brandGreen[2]);
                doc.text('RM365', 14, pageHeight - 10);
            }
        });
        
        // Add summary section
        const finalY = doc.lastAutoTable.finalY + 10;
        
        if (finalY < doc.internal.pageSize.height - 40) {
            addSummaryBox(doc, finalY, data.length, config.summaryLabel, config.accentColor);
        }
        
        // Generate filename
        const dateStr = new Date().toISOString().split('T')[0];
        const filename = `${reportType}-report_${dateStr}.pdf`;
        
        if (openPrint) {
            doc.autoPrint();
            window.open(doc.output('bloburl'), '_blank');
        } else {
            doc.save(filename);
        }
        
        return { success: true, filename };
    } catch (error) {
        console.error('Error generating PDF:', error);
        throw error;
    }
}

/**
 * Add summary box to PDF
 */
function addSummaryBox(doc, startY, count, label, accentColor) {
    const boxWidth = 80;
    const boxHeight = 22;
    const startX = (doc.internal.pageSize.width - boxWidth) / 2;
    
    // Summary Box
    doc.setFillColor(accentColor[0], accentColor[1], accentColor[2]);
    doc.roundedRect(startX, startY, boxWidth, boxHeight, 3, 3, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(10);
    doc.setFont(undefined, 'bold');
    doc.text(label.toUpperCase(), startX + boxWidth / 2, startY + 8, { align: 'center' });
    doc.setFontSize(18);
    doc.text(count.toString(), startX + boxWidth / 2, startY + 18, { align: 'center' });
}

/**
 * Export data to CSV
 * @param {Array} data - Array of data objects
 * @param {string} reportType - Type of report
 * @param {Object} filters - Current filter settings
 */
export function exportDashboardToCSV(data, reportType, filters = {}) {
    try {
        const config = REPORT_CONFIGS[reportType];
        if (!config) {
            throw new Error(`Unknown report type: ${reportType}`);
        }

        // CSV headers
        const headers = config.columns;
        
        // Map data to rows
        const rows = data.map(config.mapRow);
        
        // Build CSV content
        let csvContent = '';
        
        // Add metadata as comments
        csvContent += `# ${config.title}\n`;
        csvContent += `# Generated: ${getCurrentDateTime()}\n`;
        if (filters.location) csvContent += `# Location Filter: ${filters.location}\n`;
        if (filters.dateRange) csvContent += `# Date Range: ${filters.dateRange}\n`;
        if (filters.nameSearch) csvContent += `# Employee Filter: ${filters.nameSearch}\n`;
        csvContent += `# Total Records: ${data.length}\n`;
        csvContent += '#\n';
        
        // Add headers
        csvContent += headers.map(h => `"${h}"`).join(',') + '\n';
        
        // Add data rows
        rows.forEach(row => {
            csvContent += row.map(cell => {
                // Escape quotes and wrap in quotes
                const escaped = String(cell || '').replace(/"/g, '""');
                return `"${escaped}"`;
            }).join(',') + '\n';
        });
        
        // Create and download file
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        const dateStr = new Date().toISOString().split('T')[0];
        const filename = `${reportType}-report_${dateStr}.csv`;
        
        link.setAttribute('href', url);
        link.setAttribute('download', filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        
        return { success: true, filename };
    } catch (error) {
        console.error('Error generating CSV:', error);
        throw error;
    }
}

/**
 * Get available report types and their labels
 */
export function getReportTypes() {
    return {
        realtime: [
            { value: 'attendance', label: 'Today\'s Attendance' },
            { value: 'absences', label: 'Today\'s Absences' },
            { value: 'breaks', label: 'Active Breaks' }
        ],
        punctuality: [
            { value: 'late', label: 'Late Arrivals' },
            { value: 'early', label: 'Early Departures' },
            { value: 'missing', label: 'Missing Punches' }
        ]
    };
}

/**
 * Export multiple sections combined into one PDF document
 * @param {Object} sectionsData - Object with reportType as key and data array as value
 * @param {string} sectionName - The section name (realtime or punctuality)
 * @param {Object} filters - Current filter settings
 */
export async function exportCombinedPDF(sectionsData, sectionName, filters = {}) {
    try {
        // Load jsPDF
        const jspdf = await loadJsPDF();
        const { jsPDF } = jspdf;
        
        // Create new PDF document (A4, portrait)
        const doc = new jsPDF();
        
        const sectionTitle = sectionName === 'realtime' 
            ? 'REAL-TIME STATUS REPORT' 
            : 'PUNCTUALITY & COMPLIANCE REPORT';
        const sectionSubtitle = sectionName === 'realtime'
            ? 'Combined attendance, absences, and breaks'
            : 'Combined late arrivals, early departures, and missing punches';
        const sectionAccentColor = sectionName === 'realtime' ? THEME.successGreen : THEME.warningOrange;
        
        // Try to load and add logo
        try {
            const logoImage = await loadImageAsBase64('/assets/RM365_Logo_New.png');
            const maxLogoWidth = 40;
            const aspectRatio = logoImage.height / logoImage.width;
            const logoWidth = maxLogoWidth;
            const logoHeight = maxLogoWidth * aspectRatio;
            doc.addImage(logoImage.dataURL, 'PNG', doc.internal.pageSize.width - 54, 10, logoWidth, logoHeight);
        } catch (error) {
            console.warn('Could not load logo:', error);
        }
        
        // Header with brand color accent bar
        doc.setFillColor(sectionAccentColor[0], sectionAccentColor[1], sectionAccentColor[2]);
        doc.rect(0, 0, doc.internal.pageSize.width, 6, 'F');
        
        // Title Section
        doc.setFontSize(20);
        doc.setTextColor(THEME.headerText[0], THEME.headerText[1], THEME.headerText[2]);
        doc.setFont(undefined, 'bold');
        doc.text(sectionTitle, 14, 22);
        
        // Subtitle with accent color
        doc.setFontSize(11);
        doc.setTextColor(sectionAccentColor[0], sectionAccentColor[1], sectionAccentColor[2]);
        doc.setFont(undefined, 'normal');
        doc.text(sectionSubtitle, 14, 29);
        
        // Metadata Section
        doc.setFontSize(9);
        doc.setFont(undefined, 'normal');
        doc.setTextColor(THEME.mediumGray[0], THEME.mediumGray[1], THEME.mediumGray[2]);
        
        let metaY = 36;
        
        // Info box with light background
        doc.setFillColor(THEME.lightGray[0], THEME.lightGray[1], THEME.lightGray[2]);
        const hasFilters = filters.location || filters.dateRange || filters.nameSearch;
        const infoBoxHeight = hasFilters ? 20 : 12;
        doc.roundedRect(14, metaY - 3, doc.internal.pageSize.width - 28, infoBoxHeight, 2, 2, 'F');
        
        // Date and record count
        doc.setTextColor(THEME.bodyText[0], THEME.bodyText[1], THEME.bodyText[2]);
        doc.setFont(undefined, 'bold');
        doc.text('Generated:', 18, metaY + 2);
        doc.setFont(undefined, 'normal');
        doc.text(getCurrentDateTime(), 40, metaY + 2);
        
        const totalRecords = Object.values(sectionsData).reduce((sum, arr) => sum + (arr?.length || 0), 0);
        doc.setFont(undefined, 'bold');
        doc.text('Total Records:', 120, metaY + 2);
        doc.setFont(undefined, 'normal');
        doc.text(totalRecords.toString(), 150, metaY + 2);
        
        // Show active filters if any
        if (hasFilters) {
            metaY += 8;
            doc.setFont(undefined, 'bold');
            doc.text('Filters:', 18, metaY + 2);
            doc.setFont(undefined, 'normal');
            
            let filterText = [];
            if (filters.location) filterText.push(`Location: ${filters.location}`);
            if (filters.dateRange) filterText.push(`Date: ${filters.dateRange}`);
            if (filters.nameSearch) filterText.push(`Employee: ${filters.nameSearch}`);
            doc.text(filterText.join(' | '), 40, metaY + 2);
        }
        
        let currentY = metaY + infoBoxHeight + 5;
        let isFirstSection = true;
        
        // Add each section's data
        for (const [reportType, data] of Object.entries(sectionsData)) {
            if (!data || data.length === 0) continue;
            
            const config = REPORT_CONFIGS[reportType];
            if (!config) continue;
            
            // Add page break if not enough space (except for first section)
            if (!isFirstSection && currentY > doc.internal.pageSize.height - 80) {
                doc.addPage();
                currentY = 20;
            }
            
            // Section header
            doc.setFontSize(12);
            doc.setTextColor(config.accentColor[0], config.accentColor[1], config.accentColor[2]);
            doc.setFont(undefined, 'bold');
            doc.text(`${config.icon} ${config.title} (${data.length} records)`, 14, currentY);
            currentY += 5;
            
            // Table data
            const headers = [config.columns];
            const rows = data.map(config.mapRow);
            
            // Determine column widths based on report type
            let columnStyles = {};
            if (['attendance', 'absences', 'breaks'].includes(reportType)) {
                columnStyles = {
                    0: { cellWidth: 55 },  // Employee
                    1: { cellWidth: 40 },  // Location
                    2: { cellWidth: 35, halign: 'center' },  // Time
                    3: { cellWidth: 'auto', halign: 'center' }  // Status
                };
            } else {
                columnStyles = {
                    0: { cellWidth: 50 },  // Employee
                    1: { cellWidth: 40 },  // Location
                    2: { cellWidth: 35, halign: 'center' },  // Date
                    3: { cellWidth: 'auto', halign: 'center' }  // Time/Issue
                };
            }
            
            // Add table
            doc.autoTable({
                head: headers,
                body: rows,
                startY: currentY,
                theme: 'plain',
                styles: {
                    fontSize: 8,
                    cellPadding: 4,
                    textColor: THEME.bodyText,
                    overflow: 'ellipsize',
                    valign: 'middle',
                    lineColor: THEME.borderGray,
                    lineWidth: 0.1
                },
                headStyles: {
                    fillColor: config.accentColor,
                    textColor: [255, 255, 255],
                    fontStyle: 'bold',
                    fontSize: 9,
                    minCellHeight: 10,
                    halign: 'left'
                },
                columnStyles: columnStyles,
                alternateRowStyles: {
                    fillColor: THEME.lightGray
                },
                margin: { top: 20, left: 14, right: 14 },
                didDrawPage: function(pageData) {
                    // Header on subsequent pages
                    if (doc.internal.getCurrentPageInfo().pageNumber > 1) {
                        doc.setFillColor(sectionAccentColor[0], sectionAccentColor[1], sectionAccentColor[2]);
                        doc.rect(0, 0, doc.internal.pageSize.width, 4, 'F');
                        
                        doc.setFontSize(10);
                        doc.setTextColor(THEME.mediumGray[0], THEME.mediumGray[1], THEME.mediumGray[2]);
                        doc.setFont(undefined, 'normal');
                        doc.text(sectionTitle, 14, 10);
                    }
                }
            });
            
            currentY = doc.lastAutoTable.finalY + 15;
            isFirstSection = false;
        }
        
        // Add page numbers to all pages
        const pageCount = doc.internal.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
            doc.setPage(i);
            const pageHeight = doc.internal.pageSize.height;
            const pageWidth = doc.internal.pageSize.width;
            
            // Footer line
            doc.setDrawColor(sectionAccentColor[0], sectionAccentColor[1], sectionAccentColor[2]);
            doc.setLineWidth(0.5);
            doc.line(14, pageHeight - 15, pageWidth - 14, pageHeight - 15);
            
            // Page number
            doc.setFontSize(8);
            doc.setTextColor(THEME.mediumGray[0], THEME.mediumGray[1], THEME.mediumGray[2]);
            doc.setFont(undefined, 'normal');
            doc.text(`Page ${i} of ${pageCount}`, pageWidth / 2, pageHeight - 10, { align: 'center' });
            
            // RM365 branding
            doc.setFontSize(7);
            doc.setTextColor(THEME.brandGreen[0], THEME.brandGreen[1], THEME.brandGreen[2]);
            doc.text('RM365', 14, pageHeight - 10);
        }
        
        // Generate filename
        const dateStr = new Date().toISOString().split('T')[0];
        const filename = `${sectionName}-combined-report_${dateStr}.pdf`;
        
        doc.save(filename);
        
        return { success: true, filename };
    } catch (error) {
        console.error('Error generating combined PDF:', error);
        throw error;
    }
}

/**
 * Export multiple sections combined into one CSV file
 * @param {Object} sectionsData - Object with reportType as key and data array as value
 * @param {string} sectionName - The section name (realtime or punctuality)
 * @param {Object} filters - Current filter settings
 */
export function exportCombinedCSV(sectionsData, sectionName, filters = {}) {
    try {
        const sectionTitle = sectionName === 'realtime' 
            ? 'REAL-TIME STATUS REPORT' 
            : 'PUNCTUALITY & COMPLIANCE REPORT';
        
        // Build CSV content
        let csvContent = '';
        
        // Add metadata as comments
        csvContent += `# ${sectionTitle}\n`;
        csvContent += `# Generated: ${getCurrentDateTime()}\n`;
        if (filters.location) csvContent += `# Location Filter: ${filters.location}\n`;
        if (filters.dateRange) csvContent += `# Date Range: ${filters.dateRange}\n`;
        if (filters.nameSearch) csvContent += `# Employee Filter: ${filters.nameSearch}\n`;
        
        const totalRecords = Object.values(sectionsData).reduce((sum, arr) => sum + (arr?.length || 0), 0);
        csvContent += `# Total Records: ${totalRecords}\n`;
        csvContent += '#\n';
        
        // Add each section's data
        for (const [reportType, data] of Object.entries(sectionsData)) {
            if (!data || data.length === 0) continue;
            
            const config = REPORT_CONFIGS[reportType];
            if (!config) continue;
            
            // Section header
            csvContent += `\n# ${config.title} (${data.length} records)\n`;
            
            // Add headers
            csvContent += config.columns.map(h => `"${h}"`).join(',') + '\n';
            
            // Map data to rows
            const rows = data.map(config.mapRow);
            
            // Add data rows
            rows.forEach(row => {
                csvContent += row.map(cell => {
                    const escaped = String(cell || '').replace(/"/g, '""');
                    return `"${escaped}"`;
                }).join(',') + '\n';
            });
        }
        
        // Create and download file
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        const dateStr = new Date().toISOString().split('T')[0];
        const filename = `${sectionName}-combined-report_${dateStr}.csv`;
        
        link.setAttribute('href', url);
        link.setAttribute('download', filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        
        return { success: true, filename };
    } catch (error) {
        console.error('Error generating combined CSV:', error);
        throw error;
    }
}

/**
 * Export individual employee attendance card to PDF
 * @param {Object} employeeData - Employee summary data from card
 * @param {Array} logs - Array of attendance logs for the employee
 * @param {Object} filters - Current filter settings including date range
 */
export async function exportEmployeeCardToPDF(employeeData, logs, filters = {}) {
    try {
        // Load jsPDF
        const jspdf = await loadJsPDF();
        const { jsPDF } = jspdf;
        
        // Create new PDF document (A4, portrait)
        const doc = new jsPDF();
        
        // Try to load and add logo
        try {
            const logoImage = await loadImageAsBase64('/assets/RM365_Logo_New.png');
            const maxLogoWidth = 40;
            const aspectRatio = logoImage.height / logoImage.width;
            const logoWidth = maxLogoWidth;
            const logoHeight = maxLogoWidth * aspectRatio;
            doc.addImage(logoImage.dataURL, 'PNG', doc.internal.pageSize.width - 54, 10, logoWidth, logoHeight);
        } catch (error) {
            console.warn('Could not load logo:', error);
        }
        
        // Header with brand color accent bar
        doc.setFillColor(THEME.brandGreen[0], THEME.brandGreen[1], THEME.brandGreen[2]);
        doc.rect(0, 0, doc.internal.pageSize.width, 6, 'F');
        
        // Title Section
        doc.setFontSize(20);
        doc.setTextColor(THEME.headerText[0], THEME.headerText[1], THEME.headerText[2]);
        doc.setFont(undefined, 'bold');
        doc.text('EMPLOYEE ATTENDANCE REPORT', 14, 22);
        
        // Employee name subtitle
        doc.setFontSize(14);
        doc.setTextColor(THEME.brandGreen[0], THEME.brandGreen[1], THEME.brandGreen[2]);
        doc.setFont(undefined, 'normal');
        doc.text(employeeData.name, 14, 30);
        
        // Metadata Section
        let metaY = 38;
        
        // Info box with light background
        doc.setFillColor(THEME.lightGray[0], THEME.lightGray[1], THEME.lightGray[2]);
        doc.roundedRect(14, metaY - 3, doc.internal.pageSize.width - 28, 12, 2, 2, 'F');
        
        doc.setFontSize(9);
        doc.setTextColor(THEME.bodyText[0], THEME.bodyText[1], THEME.bodyText[2]);
        doc.setFont(undefined, 'bold');
        doc.text('Generated:', 18, metaY + 2);
        doc.setFont(undefined, 'normal');
        doc.text(getCurrentDateTime(), 40, metaY + 2);
        
        if (filters.dateRange) {
            doc.setFont(undefined, 'bold');
            doc.text('Date Range:', 100, metaY + 2);
            doc.setFont(undefined, 'normal');
            doc.text(filters.dateRange, 125, metaY + 2);
        }
        
        let currentY = metaY + 18;
        
        // Today's Summary Section
        doc.setFontSize(12);
        doc.setTextColor(THEME.brandGreen[0], THEME.brandGreen[1], THEME.brandGreen[2]);
        doc.setFont(undefined, 'bold');
        doc.text("TODAY'S SUMMARY", 14, currentY);
        currentY += 5;
        
        // Summary cards layout
        const cardWidth = 42;
        const cardHeight = 25;
        const cardGap = 4;
        const startX = 14;
        
        const summaryItems = [
            { label: 'Arrival', value: employeeData.firstIn || '-', icon: '→' },
            { label: 'Lunch', value: employeeData.lunchTime || '-', icon: '🍽' },
            { label: 'Hours Worked', value: employeeData.hoursWorked || '-', icon: '⏱' },
            { label: 'Leave Time', value: employeeData.lastOut || '-', icon: '←' }
        ];
        
        summaryItems.forEach((item, index) => {
            const x = startX + (cardWidth + cardGap) * index;
            
            // Card background
            doc.setFillColor(THEME.lightGray[0], THEME.lightGray[1], THEME.lightGray[2]);
            doc.roundedRect(x, currentY, cardWidth, cardHeight, 2, 2, 'F');
            
            // Card border
            doc.setDrawColor(THEME.borderGray[0], THEME.borderGray[1], THEME.borderGray[2]);
            doc.setLineWidth(0.2);
            doc.roundedRect(x, currentY, cardWidth, cardHeight, 2, 2, 'S');
            
            // Label
            doc.setFontSize(8);
            doc.setTextColor(THEME.mediumGray[0], THEME.mediumGray[1], THEME.mediumGray[2]);
            doc.setFont(undefined, 'normal');
            doc.text(item.label, x + cardWidth / 2, currentY + 8, { align: 'center' });
            
            // Value
            doc.setFontSize(12);
            doc.setTextColor(THEME.headerText[0], THEME.headerText[1], THEME.headerText[2]);
            doc.setFont(undefined, 'bold');
            doc.text(String(item.value), x + cardWidth / 2, currentY + 18, { align: 'center' });
        });
        
        currentY += cardHeight + 15;
        
        // Attendance Logs Section
        doc.setFontSize(12);
        doc.setTextColor(THEME.brandGreen[0], THEME.brandGreen[1], THEME.brandGreen[2]);
        doc.setFont(undefined, 'bold');
        doc.text(`ATTENDANCE LOGS (${logs.length} records)`, 14, currentY);
        currentY += 5;
        
        if (logs && logs.length > 0) {
            // Prepare table data
            const headers = [['Date', 'Time', 'Direction', 'Location']];
            const rows = logs.map(log => [
                formatDate(log.date),
                log.time || '-',
                log.direction === 'in' ? 'Clock In' : 'Clock Out',
                log.location || '-'
            ]);
            
            // Add table
            doc.autoTable({
                head: headers,
                body: rows,
                startY: currentY,
                theme: 'plain',
                styles: {
                    fontSize: 9,
                    cellPadding: 4,
                    textColor: THEME.bodyText,
                    overflow: 'ellipsize',
                    valign: 'middle',
                    lineColor: THEME.borderGray,
                    lineWidth: 0.1
                },
                headStyles: {
                    fillColor: THEME.brandGreen,
                    textColor: [255, 255, 255],
                    fontStyle: 'bold',
                    fontSize: 9,
                    minCellHeight: 10,
                    halign: 'left'
                },
                columnStyles: {
                    0: { cellWidth: 45 },
                    1: { cellWidth: 30, halign: 'center' },
                    2: { cellWidth: 35, halign: 'center' },
                    3: { cellWidth: 'auto' }
                },
                alternateRowStyles: {
                    fillColor: THEME.lightGray
                },
                didParseCell: function(cellData) {
                    // Apply special styling for direction column
                    if (cellData.section === 'body' && cellData.column.index === 2) {
                        const cellValue = cellData.cell.raw?.toLowerCase();
                        if (cellValue?.includes('clock in')) {
                            cellData.cell.styles.textColor = [21, 87, 36];
                            cellData.cell.styles.fillColor = THEME.clockInGreen;
                        } else if (cellValue?.includes('clock out')) {
                            cellData.cell.styles.textColor = [114, 28, 36];
                            cellData.cell.styles.fillColor = THEME.clockOutRed;
                        }
                    }
                },
                margin: { top: 20, left: 14, right: 14 },
                didDrawPage: function(pageData) {
                    // Header on subsequent pages
                    if (doc.internal.getCurrentPageInfo().pageNumber > 1) {
                        doc.setFillColor(THEME.brandGreen[0], THEME.brandGreen[1], THEME.brandGreen[2]);
                        doc.rect(0, 0, doc.internal.pageSize.width, 4, 'F');
                        
                        doc.setFontSize(10);
                        doc.setTextColor(THEME.mediumGray[0], THEME.mediumGray[1], THEME.mediumGray[2]);
                        doc.setFont(undefined, 'normal');
                        doc.text(`${employeeData.name} - Attendance Report`, 14, 10);
                    }
                }
            });
        } else {
            doc.setFontSize(10);
            doc.setTextColor(THEME.mediumGray[0], THEME.mediumGray[1], THEME.mediumGray[2]);
            doc.text('No attendance logs found for the selected date range.', 14, currentY + 5);
        }
        
        // Add page numbers to all pages
        const pageCount = doc.internal.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
            doc.setPage(i);
            const pageHeight = doc.internal.pageSize.height;
            const pageWidth = doc.internal.pageSize.width;
            
            // Footer line
            doc.setDrawColor(THEME.brandGreen[0], THEME.brandGreen[1], THEME.brandGreen[2]);
            doc.setLineWidth(0.5);
            doc.line(14, pageHeight - 15, pageWidth - 14, pageHeight - 15);
            
            // Page number
            doc.setFontSize(8);
            doc.setTextColor(THEME.mediumGray[0], THEME.mediumGray[1], THEME.mediumGray[2]);
            doc.setFont(undefined, 'normal');
            doc.text(`Page ${i} of ${pageCount}`, pageWidth / 2, pageHeight - 10, { align: 'center' });
            
            // RM365 branding
            doc.setFontSize(7);
            doc.setTextColor(THEME.brandGreen[0], THEME.brandGreen[1], THEME.brandGreen[2]);
            doc.text('RM365', 14, pageHeight - 10);
        }
        
        // Generate filename
        const dateStr = new Date().toISOString().split('T')[0];
        const safeEmployeeName = employeeData.name.replace(/[^a-zA-Z0-9]/g, '_');
        const filename = `${safeEmployeeName}_attendance_${dateStr}.pdf`;
        
        doc.save(filename);
        
        return { success: true, filename };
    } catch (error) {
        console.error('Error generating employee PDF:', error);
        throw error;
    }
}

/**
 * Export individual employee attendance card to CSV
 * @param {Object} employeeData - Employee summary data from card
 * @param {Array} logs - Array of attendance logs for the employee
 * @param {Object} filters - Current filter settings including date range
 */
export function exportEmployeeCardToCSV(employeeData, logs, filters = {}) {
    try {
        // Build CSV content
        let csvContent = '';
        
        // Add metadata as comments
        csvContent += `# EMPLOYEE ATTENDANCE REPORT\n`;
        csvContent += `# Employee: ${employeeData.name}\n`;
        csvContent += `# Generated: ${getCurrentDateTime()}\n`;
        if (filters.dateRange) csvContent += `# Date Range: ${filters.dateRange}\n`;
        csvContent += '#\n';
        
        // Today's Summary Section
        csvContent += '\n# TODAY\'S SUMMARY\n';
        csvContent += '"Metric","Value"\n';
        csvContent += `"Arrival","${employeeData.firstIn || '-'}"\n`;
        csvContent += `"Lunch","${employeeData.lunchTime || '-'}"\n`;
        csvContent += `"Hours Worked","${employeeData.hoursWorked || '-'}"\n`;
        csvContent += `"Leave Time","${employeeData.lastOut || '-'}"\n`;
        
        // Attendance Logs Section
        csvContent += `\n# ATTENDANCE LOGS (${logs.length} records)\n`;
        csvContent += '"Date","Time","Direction","Location"\n';
        
        // Add data rows
        logs.forEach(log => {
            const row = [
                formatDate(log.date),
                log.time || '-',
                log.direction === 'in' ? 'Clock In' : 'Clock Out',
                log.location || '-'
            ];
            csvContent += row.map(cell => {
                const escaped = String(cell || '').replace(/"/g, '""');
                return `"${escaped}"`;
            }).join(',') + '\n';
        });
        
        // Create and download file
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        const dateStr = new Date().toISOString().split('T')[0];
        const safeEmployeeName = employeeData.name.replace(/[^a-zA-Z0-9]/g, '_');
        const filename = `${safeEmployeeName}_attendance_${dateStr}.csv`;
        
        link.setAttribute('href', url);
        link.setAttribute('download', filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        
        return { success: true, filename };
    } catch (error) {
        console.error('Error generating employee CSV:', error);
        throw error;
    }
}
