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
        
        // Set up fonts and colors
        const primaryColor = [40, 40, 40]; // Dark Grey
        const secondaryColor = [100, 100, 100]; // Medium Grey
        
        // Title Section
        doc.setFontSize(20);
        doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
        doc.setFont(undefined, 'bold');
        doc.text(`${region.toUpperCase()} MAGENTO DATA`, 14, 20);
        
        // Metadata Section
        doc.setFontSize(9);
        doc.setFont(undefined, 'normal');
        doc.setTextColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
        
        const currentDate = new Date().toLocaleDateString('en-GB', { 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
        });
        
        let metaY = 28;
        doc.text(`View: ${viewType}`, 14, metaY);
        doc.text(`Date: ${currentDate}`, 80, metaY);
        
        if (searchTerm) {
            metaY += 5;
            doc.text(`Search: "${searchTerm}"`, 14, metaY);
        }
        
        metaY += 5;
        doc.text(`Total Items: ${data.length}`, 14, metaY);
        
        // Table headers
        const headers = [['#', 'SKU', 'Product Name', 'Total Qty']];
        
        // Table data - prepare rows
        const rows = data.map((item, index) => [
            (index + 1).toString(),
            item.sku || 'N/A',
            truncateText(item.name || 'N/A', 50),
            (item.total_qty || 0).toString()
        ]);
        
        // Calculate total quantity
        const totalQty = data.reduce((sum, item) => sum + (item.total_qty || 0), 0);
        
        // Add table
        doc.autoTable({
            head: headers,
            body: rows,
            startY: metaY + 10,
            theme: 'plain',
            styles: {
                fontSize: 9,
                cellPadding: 4,
                textColor: primaryColor,
                overflow: 'ellipsize',
                valign: 'middle'
            },
            headStyles: {
                fillColor: [255, 255, 255],
                textColor: primaryColor,
                fontStyle: 'bold',
                fontSize: 9,
                minCellHeight: 10
            },
            columnStyles: {
                0: { cellWidth: 15, halign: 'center', textColor: secondaryColor },  // #
                1: { cellWidth: 45, fontStyle: 'bold' },                      // SKU
                2: { cellWidth: 'auto' },                      // Product Name
                3: { cellWidth: 25, halign: 'right' }     // Total Qty
            },
            didDrawCell: function(data) {
                // Draw line at the bottom of the header
                if (data.section === 'head' && data.row.index === 0) {
                    doc.setDrawColor(primaryColor[0], primaryColor[1], primaryColor[2]);
                    doc.setLineWidth(0.5);
                    doc.line(data.cell.x, data.cell.y + data.cell.height, data.cell.x + data.cell.width, data.cell.y + data.cell.height);
                }
                // Draw light line at the bottom of each body row for separation
                if (data.section === 'body') {
                    doc.setDrawColor(240, 240, 240);
                    doc.setLineWidth(0.1);
                    doc.line(data.cell.x, data.cell.y + data.cell.height, data.cell.x + data.cell.width, data.cell.y + data.cell.height);
                }
            },
            margin: { top: 40, left: 14, right: 14 },
            didDrawPage: function(data) {
                // Footer with page numbers
                const pageCount = doc.internal.getNumberOfPages();
                doc.setFontSize(8);
                doc.setTextColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
                const footerText = `Page ${doc.internal.getCurrentPageInfo().pageNumber} of ${pageCount}`;
                doc.text(
                    footerText,
                    doc.internal.pageSize.width - 14,
                    doc.internal.pageSize.height - 10,
                    { align: 'right' }
                );
            }
        });
        
        // Add summary row after table
        const finalY = doc.lastAutoTable.finalY + 10;
        
        // Draw a line above the total
        doc.setDrawColor(primaryColor[0], primaryColor[1], primaryColor[2]);
        doc.setLineWidth(0.5);
        doc.line(14, finalY - 5, doc.internal.pageSize.width - 14, finalY - 5);

        doc.setFontSize(10);
        doc.setFont(undefined, 'bold');
        doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
        doc.text(`Total Quantity: ${totalQty.toLocaleString()}`, doc.internal.pageSize.width - 14, finalY, { align: 'right' });
        
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
