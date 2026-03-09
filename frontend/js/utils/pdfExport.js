// frontend/js/utils/pdfExport.js

/**
 * Export aggregated magento data to PDF
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
 * Export magento data table to PDF
 * @param {Array} data - Array of magento data objects
 * @param {string} region - Region code (uk, fr, nl)
 * @param {string} viewType - Type of view ('6-Month' or custom range label)
 * @param {string} searchTerm - Optional search term used
 */
export async function exportToPDF(data, region, viewType, searchTerm = '') {
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
        
        // Try to load and add logo
        let logoY = 15;
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
        doc.text(`${region.toUpperCase()} MAGENTO DATA`, 14, 22);
        
        // Subtitle with brand accent
        doc.setFontSize(11);
        doc.setTextColor(brandGreen[0], brandGreen[1], brandGreen[2]);
        doc.setFont(undefined, 'normal');
        doc.text(viewType, 14, 29);
        
        // Metadata Section with icons/labels
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
        const infoBoxHeight = searchTerm ? 16 : 12;
        doc.roundedRect(14, metaY - 3, doc.internal.pageSize.width - 28, infoBoxHeight, 2, 2, 'F');
        
        // Date and item count
        doc.setTextColor(bodyText[0], bodyText[1], bodyText[2]);
        doc.setFont(undefined, 'bold');
        doc.text('Generated:', 18, metaY + 2);
        doc.setFont(undefined, 'normal');
        doc.text(currentDate, 40, metaY + 2);
        
        doc.setFont(undefined, 'bold');
        doc.text('Total Items:', 120, metaY + 2);
        doc.setFont(undefined, 'normal');
        doc.text(data.length.toString(), 145, metaY + 2);
        
        if (searchTerm) {
            metaY += 6;
            doc.setFont(undefined, 'bold');
            doc.text('Search Filter:', 18, metaY + 2);
            doc.setFont(undefined, 'normal');
            doc.text(`"${searchTerm}"`, 42, metaY + 2);
        }
        
        // Table headers and data depend on region
        const isAllRegion = region === 'all';
        const headers = isAllRegion
            ? [['#', 'SKU', 'Product Name', 'UK Qty', 'FR Qty', 'Total Qty']]
            : [['#', 'SKU', 'Product Name', 'Total Qty']];
        
        // Table data - prepare rows
        const rows = isAllRegion
            ? data.map((item, index) => [
                (index + 1).toString(),
                item.sku || 'N/A',
                truncateText(item.name || 'N/A', 45),
                (item.uk_qty || 0).toLocaleString(),
                (item.fr_qty || 0).toLocaleString(),
                (item.total_qty || 0).toLocaleString()
            ])
            : data.map((item, index) => [
                (index + 1).toString(),
                item.sku || 'N/A',
                truncateText(item.name || 'N/A', 50),
                (item.total_qty || 0).toLocaleString()
            ]);
        
        // Calculate total quantity
        const totalQty = data.reduce((sum, item) => sum + (item.total_qty || 0), 0);
        
        // Column styles depend on region
        const columnStyles = isAllRegion
            ? {
                0: { cellWidth: 12, halign: 'center', textColor: mediumGray, fontStyle: 'normal' },
                1: { cellWidth: 38, fontStyle: 'bold', textColor: headerText },
                2: { cellWidth: 'auto' },
                3: { cellWidth: 22, halign: 'right', fontStyle: 'bold' },
                4: { cellWidth: 22, halign: 'right', fontStyle: 'bold' },
                5: { cellWidth: 25, halign: 'right', fontStyle: 'bold' }
            }
            : {
                0: { cellWidth: 15, halign: 'center', textColor: mediumGray, fontStyle: 'normal' },
                1: { cellWidth: 45, fontStyle: 'bold', textColor: headerText },
                2: { cellWidth: 'auto' },
                3: { cellWidth: 30, halign: 'right', fontStyle: 'bold' }
            };
        
        // Add table with enhanced styling
        doc.autoTable({
            head: headers,
            body: rows,
            startY: metaY + infoBoxHeight + 5,
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
            columnStyles,
            alternateRowStyles: {
                fillColor: lightGray
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
                    doc.text(`${region.toUpperCase()} Magento Data - ${viewType}`, 14, 10);
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
        
        // Add summary section with highlighted total
        const finalY = doc.lastAutoTable.finalY + 8;
        
        // Summary box with brand color
        const summaryBoxY = finalY;
        doc.setFillColor(brandGreen[0], brandGreen[1], brandGreen[2]);
        doc.roundedRect(doc.internal.pageSize.width - 75, summaryBoxY, 61, 12, 2, 2, 'F');
        
        // Total text in white
        doc.setFontSize(11);
        doc.setFont(undefined, 'bold');
        doc.setTextColor(255, 255, 255);
        doc.text('TOTAL QUANTITY:', doc.internal.pageSize.width - 72, summaryBoxY + 5);
        doc.setFontSize(13);
        doc.text(totalQty.toLocaleString(), doc.internal.pageSize.width - 72, summaryBoxY + 9.5);
        
        // Generate filename
        const dateStr = new Date().toISOString().split('T')[0];
        const searchStr = searchTerm ? `_search-${sanitizeFilename(searchTerm)}` : '';
        const viewStr = viewType.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
        const filename = `${region}-magento-data-${viewStr}${searchStr}_${dateStr}.pdf`;
        
        // Save the PDF
        doc.save(filename);
        
        return { success: true, filename };
    } catch (error) {
        console.error('Error generating PDF:', error);
        throw error;
    }
}

/**
 * Truncate text to specified length
 */
function truncateText(text, maxLength) {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
}

/**
 * Sanitize filename by removing invalid characters
 */
function sanitizeFilename(text) {
    return text.replace(/[^a-zA-Z0-9-_]/g, '_').substring(0, 30);
}
