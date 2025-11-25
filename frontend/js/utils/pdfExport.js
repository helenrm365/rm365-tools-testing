// frontend/js/utils/pdfExport.js

/**
 * Export condensed sales data to PDF
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
 * Export sales data table to PDF
 * @param {Array} data - Array of sales data objects
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
        const primaryColor = [0, 120, 212]; // Blue
        const headerBg = [240, 240, 240]; // Light gray
        
        // Title
        doc.setFontSize(18);
        doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
        doc.text(`${region.toUpperCase()} Sales Data - ${viewType}`, 14, 20);
        
        // Subtitle with date and search info
        doc.setFontSize(10);
        doc.setTextColor(100, 100, 100);
        const currentDate = new Date().toLocaleDateString('en-GB', { 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
        });
        let subtitle = `Generated: ${currentDate}`;
        if (searchTerm) {
            subtitle += ` | Search: "${searchTerm}"`;
        }
        doc.text(subtitle, 14, 28);
        
        // Summary info
        doc.setFontSize(9);
        doc.text(`Total SKUs: ${data.length}`, 14, 35);
        
        // Table headers
        const headers = [['#', 'SKU', 'Product Name', 'Total Qty']];
        
        // Table data - prepare rows
        const rows = data.map((item, index) => [
            (index + 1).toString(),
            item.sku || 'N/A',
            truncateText(item.name || 'N/A', 40),
            (item.total_qty || 0).toString()
        ]);
        
        // Calculate total quantity
        const totalQty = data.reduce((sum, item) => sum + (item.total_qty || 0), 0);
        
        // Add table
        doc.autoTable({
            head: headers,
            body: rows,
            startY: 40,
            theme: 'grid',
            headStyles: {
                fillColor: primaryColor,
                textColor: 255,
                fontStyle: 'bold',
                fontSize: 9
            },
            bodyStyles: {
                fontSize: 8,
                textColor: 50
            },
            columnStyles: {
                0: { cellWidth: 15, halign: 'center' },  // #
                1: { cellWidth: 40 },                      // SKU
                2: { cellWidth: 80 },                      // Product Name
                3: { cellWidth: 25, halign: 'right' }     // Total Qty
            },
            alternateRowStyles: {
                fillColor: [250, 250, 250]
            },
            margin: { top: 40, left: 14, right: 14 },
            didDrawPage: function(data) {
                // Footer with page numbers
                const pageCount = doc.internal.getNumberOfPages();
                doc.setFontSize(8);
                doc.setTextColor(150);
                for (let i = 1; i <= pageCount; i++) {
                    doc.setPage(i);
                    doc.text(
                        `Page ${i} of ${pageCount}`,
                        doc.internal.pageSize.width / 2,
                        doc.internal.pageSize.height - 10,
                        { align: 'center' }
                    );
                }
            }
        });
        
        // Add summary row after table
        const finalY = doc.lastAutoTable.finalY + 5;
        doc.setFontSize(9);
        doc.setFont(undefined, 'bold');
        doc.text(`Total Quantity: ${totalQty.toLocaleString()}`, 14, finalY);
        
        // Generate filename
        const dateStr = new Date().toISOString().split('T')[0];
        const searchStr = searchTerm ? `_search-${sanitizeFilename(searchTerm)}` : '';
        const viewStr = viewType.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
        const filename = `${region}-sales-${viewStr}${searchStr}_${dateStr}.pdf`;
        
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
