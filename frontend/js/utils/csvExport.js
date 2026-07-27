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

    downloadCsv(csvContent, filename);

    return { success: true, filename };
}

// Column definitions for the Full Data (per-order line item) export
const FULL_DATA_COLUMNS = [
    { header: 'Order Number', key: 'order_number' },
    { header: 'Created At', key: 'created_at' },
    { header: 'Product SKU', key: 'sku' },
    { header: 'Product Name', key: 'name' },
    { header: 'Product Qty', key: 'qty' },
    { header: 'Original Price', key: 'original_price' },
    { header: 'Special Price', key: 'special_price' },
    { header: 'Status', key: 'status' },
    { header: 'Currency', key: 'currency' },
    { header: 'Grand Total', key: 'grand_total' },
    { header: 'Customer Email', key: 'customer_email' },
    { header: 'Customer Full Name', key: 'customer_full_name' },
    { header: 'Billing Address', key: 'billing_address' },
    { header: 'Shipping Address', key: 'shipping_address' },
    { header: 'Shipping Method', key: 'shipping_method' },
    { header: 'Customer Group Code', key: 'customer_group_code' }
];

/**
 * Export Full Data (order line items) to CSV.
 * @param {Array} data - Array of order line item objects
 * @param {string} region - Region code (uk, fr, nl, all)
 * @param {string} filterSlug - Slug describing the applied filters (used in the filename)
 * @param {string} searchTerm - Optional search term used
 */
export function exportFullDataToCSV(data, region, filterSlug = '', searchTerm = '') {
    if (!data || data.length === 0) {
        throw new Error('No data to export');
    }

    // The "all" view carries a region column
    const columns = region === 'all'
        ? [{ header: 'Region', key: 'region' }, ...FULL_DATA_COLUMNS]
        : FULL_DATA_COLUMNS;

    let csvContent = columns.map(c => escapeCsvField(c.header)).join(',') + '\n';
    data.forEach(row => {
        csvContent += columns.map(c => escapeCsvField(row[c.key] ?? '')).join(',') + '\n';
    });

    const dateStr = new Date().toISOString().split('T')[0];
    const filterStr = filterSlug ? `_${sanitizeFilename(filterSlug, 60)}` : '';
    const searchStr = searchTerm ? `_search-${sanitizeFilename(searchTerm)}` : '';
    const filename = `${region}-sales-full-data${filterStr}${searchStr}_${dateStr}.csv`;

    downloadCsv(csvContent, filename);

    return { success: true, filename, rows: data.length };
}

/**
 * Trigger a CSV download. A UTF-8 BOM is prepended so Excel reads accented
 * characters (French/Dutch names and addresses) correctly.
 */
function downloadCsv(csvContent, filename) {
    const blob = new Blob(['﻿' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
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
function sanitizeFilename(text, maxLength = 30) {
    return text.replace(/[^a-zA-Z0-9\-_]/g, '_').substring(0, maxLength);
}
