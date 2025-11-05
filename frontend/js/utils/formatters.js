// Date formatting utility
export function formatDate(dateString) {
  if (!dateString) return 'N/A';
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-GB', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return dateString;
  }
}

// Currency formatting utilities
export function formatCurrency(amount, currencySymbol = '£') {
  if (amount === null || amount === undefined) return '-';
  return `${currencySymbol}${parseFloat(amount).toFixed(2)}`;
}

// Number formatting utilities
export function formatNumber(num) {
  if (num === null || num === undefined) return '-';
  return num.toLocaleString();
}
