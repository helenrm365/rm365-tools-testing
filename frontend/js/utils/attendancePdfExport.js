// frontend/js/utils/attendancePdfExport.js

/**
 * Export attendance logs to PDF with RM365 branding
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
 * Export attendance logs to PDF
 * @param {Array} logs - Array of attendance log objects
 * @param {string} startDate - Start date of the report period
 * @param {string} endDate - End date of the report period
 * @param {boolean} openPrint - Whether to open print dialog instead of downloading
 */
export async function exportAttendanceToPDF(logs, startDate, endDate, openPrint = false) {
    try {
        // Load jsPDF
        const jspdf = await loadJsPDF();
        const { jsPDF } = jspdf;
        
        // Create new PDF document (A4, portrait)
        const doc = new jsPDF();
        
        // Theme colors matching RM365 branding
        const brandGreen = [139, 195, 74];      // #8bc34a - Primary brand color
        const darkGreen = [122, 184, 45];       // #7ab82d - Darker shade
        const headerText = [26, 26, 26];        // #1a1a1a - Dark text
        const bodyText = [51, 51, 51];          // #333333 - Body text
        const lightGray = [245, 245, 245];      // #f5f5f5 - Light background
        const mediumGray = [102, 102, 102];     // #666666 - Secondary text
        const borderGray = [229, 231, 235];     // #e5e7eb - Borders
        const clockInGreen = [212, 237, 218];   // Light green for clock in
        const clockOutRed = [248, 215, 218];    // Light red for clock out
        
        // Try to load and add logo
        try {
            const logoImage = await loadImageAsBase64('/assets/RM365_Logo_New.png');
            // Calculate proportional dimensions - max width 40mm
            const maxLogoWidth = 40;
            const aspectRatio = logoImage.height / logoImage.width;
            const logoWidth = maxLogoWidth;
            const logoHeight = maxLogoWidth * aspectRatio;
            // Add logo at top right with proper aspect ratio
            doc.addImage(logoImage.dataURL, 'PNG', doc.internal.pageSize.width - 54, 10, logoWidth, logoHeight);
        } catch (error) {
            console.warn('Could not load logo:', error);
            // Continue without logo
        }
        
        // Header with brand color accent bar
        doc.setFillColor(brandGreen[0], brandGreen[1], brandGreen[2]);
        doc.rect(0, 0, doc.internal.pageSize.width, 6, 'F');
        
        // Title Section
        doc.setFontSize(22);
        doc.setTextColor(headerText[0], headerText[1], headerText[2]);
        doc.setFont(undefined, 'bold');
        doc.text('ATTENDANCE LOGS REPORT', 14, 22);
        
        // Subtitle with brand accent
        doc.setFontSize(11);
        doc.setTextColor(brandGreen[0], brandGreen[1], brandGreen[2]);
        doc.setFont(undefined, 'normal');
        doc.text(`${startDate} to ${endDate}`, 14, 29);
        
        // Metadata Section
        doc.setFontSize(9);
        doc.setFont(undefined, 'normal');
        doc.setTextColor(mediumGray[0], mediumGray[1], mediumGray[2]);
        
        const currentDate = new Date().toLocaleDateString('en-GB', { 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
        
        let metaY = 36;
        
        // Info box with light background
        doc.setFillColor(lightGray[0], lightGray[1], lightGray[2]);
        doc.roundedRect(14, metaY - 3, doc.internal.pageSize.width - 28, 12, 2, 2, 'F');
        
        // Date and record count
        doc.setTextColor(bodyText[0], bodyText[1], bodyText[2]);
        doc.setFont(undefined, 'bold');
        doc.text('Generated:', 18, metaY + 2);
        doc.setFont(undefined, 'normal');
        doc.text(currentDate, 40, metaY + 2);
        
        doc.setFont(undefined, 'bold');
        doc.text('Total Records:', 120, metaY + 2);
        doc.setFont(undefined, 'normal');
        doc.text(logs.length.toString(), 150, metaY + 2);
        
        // Calculate statistics
        const clockInCount = logs.filter(log => log.direction === 'in').length;
        const clockOutCount = logs.filter(log => log.direction === 'out').length;
        
        // Table headers
        const headers = [['Employee', 'Date', 'Time', 'Action']];
        
        // Table data - prepare rows with formatted action
        const rows = logs.map(log => [
            log.employee || 'N/A',
            log.date || 'N/A',
            log.time || 'N/A',
            log.direction === 'in' ? '✓ Clock In' : '✗ Clock Out'
        ]);
        
        // Add table with enhanced styling
        doc.autoTable({
            head: headers,
            body: rows,
            startY: metaY + 14,
            theme: 'plain',
            styles: {
                fontSize: 9,
                cellPadding: 5,
                textColor: bodyText,
                overflow: 'ellipsize',
                valign: 'middle',
                lineColor: borderGray,
                lineWidth: 0.1
            },
            headStyles: {
                fillColor: brandGreen,
                textColor: [255, 255, 255],
                fontStyle: 'bold',
                fontSize: 10,
                minCellHeight: 12,
                halign: 'left'
            },
            columnStyles: {
                0: { cellWidth: 60, fontStyle: 'bold', textColor: headerText },
                1: { cellWidth: 35, halign: 'center' },
                2: { cellWidth: 30, halign: 'center' },
                3: { cellWidth: 'auto', halign: 'center', fontStyle: 'bold' }
            },
            alternateRowStyles: {
                fillColor: lightGray
            },
            didParseCell: function(data) {
                // Color code the action column
                if (data.section === 'body' && data.column.index === 3) {
                    const action = data.cell.raw;
                    if (action && action.includes('Clock In')) {
                        data.cell.styles.textColor = [21, 87, 36]; // Dark green text
                        data.cell.styles.fillColor = clockInGreen;
                    } else if (action && action.includes('Clock Out')) {
                        data.cell.styles.textColor = [114, 28, 36]; // Dark red text
                        data.cell.styles.fillColor = clockOutRed;
                    }
                }
            },
            didDrawCell: function(data) {
                // Add subtle border to cells
                if (data.section === 'body') {
                    doc.setDrawColor(borderGray[0], borderGray[1], borderGray[2]);
                    doc.setLineWidth(0.1);
                }
            },
            margin: { top: 40, left: 14, right: 14 },
            didDrawPage: function(data) {
                // Header on each page (except first)
                if (doc.internal.getCurrentPageInfo().pageNumber > 1) {
                    // Brand accent bar
                    doc.setFillColor(brandGreen[0], brandGreen[1], brandGreen[2]);
                    doc.rect(0, 0, doc.internal.pageSize.width, 4, 'F');
                    
                    // Page title
                    doc.setFontSize(10);
                    doc.setTextColor(mediumGray[0], mediumGray[1], mediumGray[2]);
                    doc.setFont(undefined, 'normal');
                    doc.text(`Attendance Logs - ${startDate} to ${endDate}`, 14, 10);
                }
                
                // Footer with page numbers and brand accent
                const pageCount = doc.internal.getNumberOfPages();
                const pageHeight = doc.internal.pageSize.height;
                const pageWidth = doc.internal.pageSize.width;
                
                // Footer line
                doc.setDrawColor(brandGreen[0], brandGreen[1], brandGreen[2]);
                doc.setLineWidth(0.5);
                doc.line(14, pageHeight - 15, pageWidth - 14, pageHeight - 15);
                
                // Page number
                doc.setFontSize(8);
                doc.setTextColor(mediumGray[0], mediumGray[1], mediumGray[2]);
                doc.setFont(undefined, 'normal');
                const footerText = `Page ${doc.internal.getCurrentPageInfo().pageNumber} of ${pageCount}`;
                doc.text(footerText, pageWidth / 2, pageHeight - 10, { align: 'center' });
                
                // RM365 branding
                doc.setFontSize(7);
                doc.setTextColor(brandGreen[0], brandGreen[1], brandGreen[2]);
                doc.text('RM365', 14, pageHeight - 10);
            }
        });
        
        // Add summary section with statistics
        const finalY = doc.lastAutoTable.finalY + 8;
        
        // Check if we need a new page for summary
        if (finalY > doc.internal.pageSize.height - 40) {
            doc.addPage();
            const summaryY = 20;
            addSummaryBoxes(doc, summaryY, clockInCount, clockOutCount, logs.length, brandGreen, clockInGreen, clockOutRed, bodyText, headerText);
        } else {
            addSummaryBoxes(doc, finalY, clockInCount, clockOutCount, logs.length, brandGreen, clockInGreen, clockOutRed, bodyText, headerText);
        }
        
        // Generate filename
        const dateStr = new Date().toISOString().split('T')[0];
        const filename = `attendance-logs-${startDate}-to-${endDate}_${dateStr}.pdf`;
        
        if (openPrint) {
            // Open print dialog
            doc.autoPrint();
            window.open(doc.output('bloburl'), '_blank');
        } else {
            // Download the PDF
            doc.save(filename);
        }
        
        return { success: true, filename };
    } catch (error) {
        console.error('Error generating attendance PDF:', error);
        throw error;
    }
}

/**
 * Add summary statistics boxes to the PDF
 */
function addSummaryBoxes(doc, startY, clockInCount, clockOutCount, totalCount, brandGreen, clockInGreen, clockOutRed, bodyText, headerText) {
    const boxWidth = 55;
    const boxHeight = 18;
    const spacing = 8;
    const startX = (doc.internal.pageSize.width - (boxWidth * 3 + spacing * 2)) / 2;
    
    // Total Records Box (Green)
    doc.setFillColor(brandGreen[0], brandGreen[1], brandGreen[2]);
    doc.roundedRect(startX, startY, boxWidth, boxHeight, 2, 2, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(9);
    doc.setFont(undefined, 'bold');
    doc.text('TOTAL RECORDS', startX + boxWidth / 2, startY + 6, { align: 'center' });
    doc.setFontSize(16);
    doc.text(totalCount.toString(), startX + boxWidth / 2, startY + 14, { align: 'center' });
    
    // Clock In Box (Light Green)
    doc.setFillColor(clockInGreen[0], clockInGreen[1], clockInGreen[2]);
    doc.roundedRect(startX + boxWidth + spacing, startY, boxWidth, boxHeight, 2, 2, 'F');
    doc.setTextColor(21, 87, 36);
    doc.setFontSize(9);
    doc.text('CLOCK IN', startX + boxWidth + spacing + boxWidth / 2, startY + 6, { align: 'center' });
    doc.setFontSize(16);
    doc.text(clockInCount.toString(), startX + boxWidth + spacing + boxWidth / 2, startY + 14, { align: 'center' });
    
    // Clock Out Box (Light Red)
    doc.setFillColor(clockOutRed[0], clockOutRed[1], clockOutRed[2]);
    doc.roundedRect(startX + (boxWidth + spacing) * 2, startY, boxWidth, boxHeight, 2, 2, 'F');
    doc.setTextColor(114, 28, 36);
    doc.setFontSize(9);
    doc.text('CLOCK OUT', startX + (boxWidth + spacing) * 2 + boxWidth / 2, startY + 6, { align: 'center' });
    doc.setFontSize(16);
    doc.text(clockOutCount.toString(), startX + (boxWidth + spacing) * 2 + boxWidth / 2, startY + 14, { align: 'center' });
}
