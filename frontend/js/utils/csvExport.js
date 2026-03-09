// frontend/js/utils/csvExport.js

/**
 * Export magento data to CSV
 * @param {Array} data - Array of magento data objects
 * @param {string} region - Region code (uk, fr, nl, all)
 * @param {string} viewType - Type of view ('6-Month' or custom range label)
 * @param {string} searchTerm - Optional search term used
 */
export function exportToCSV(data, region, viewType, searchTerm = '') {
    if (!data || data.length === 0) {
        throw new Error('No data to export');
    }

    const isAllRegion = region === 'all';

    // Build CSV headers
    const headers = isAllRegion
        ? ['SKU', 'Product Name', 'UK Qty', 'FR Qty', 'Total Qty', 'Last Updated']
        : ['SKU', 'Product Name', 'Total Qty', 'Last Updated'];

    // Build CSV rows
    const rows = data.map(item => {
        if (isAllRegion) {
            return [
                item.sku || '',
                item.name || '',
                item.uk_qty || 0,
                item.fr_qty || 0,
                item.total_qty || 0,
                item.last_updated || ''
            ];
        }
        return [
            item.sku || '',
            item.name || '',
            item.total_qty || 0,
            item.last_updated || ''
        ];
    });

    // Build CSV content with proper escaping
    let csvContent = headers.map(h => escapeCsvField(h)).join(',') + '\n';
    rows.forEach(row => {
        csvContent += row.map(cell => escapeCsvField(cell)).join(',') + '\n';
    });

    // Generate filename
    const dateStr = new Date().toISOString().split('T')[0];
    const searchStr = searchTerm ? `_search-${sanitizeFilename(searchTerm)}` : '';
    const viewStr = viewType.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    const filename = `${region}-magento-data-${viewStr}${searchStr}_${dateStr}.csv`;

    // Create blob and trigger download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    return { success: true, filename };
}

/**
 * Escape a field for CSV output
 */
function escapeCsvField(value) {
    const str = String(value == null ? '' : value);
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}

/**
 * Sanitize filename by removing invalid characters
 */
function sanitizeFilename(text) {
    return text.replace(/[^a-zA-Z0-9\-_]/g, '_').substring(0, 30);
}
