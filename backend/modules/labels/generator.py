from __future__ import annotations
from typing import List, Dict, Any
from datetime import datetime
import csv
import io


def generate_label_content(data: List[Dict[str, Any]]) -> str:
    """Generate label content from sales data"""
    
    output = io.StringIO()
    
    if not data:
        return ""
    
    # Define CSV headers based on the first record
    headers = list(data[0].keys())
    writer = csv.DictWriter(output, fieldnames=headers)
    
    # Write header
    writer.writeheader()
    
    # Write data rows
    for row in data:
        writer.writerow(row)
    
    content = output.getvalue()
    output.close()
    
    return content


def generate_shipping_labels(data: List[Dict[str, Any]]) -> str:
    """Generate formatted shipping labels"""
    
    labels = []
    
    for item in data:
        label = f"""
========================================
SHIPPING LABEL
========================================
Order: {item.get('order_number', 'N/A')}
Date: {item.get('order_date', 'N/A')}

TO:
{item.get('customer_name', 'N/A')}
{item.get('customer_address', 'N/A')}

PRODUCT:
SKU: {item.get('product_sku', 'N/A')}
Name: {item.get('product_name', 'N/A')}
Qty: {item.get('quantity', 1)}

Shipping: {item.get('shipping_method', 'Standard')}
========================================
"""
        labels.append(label.strip())
    
    return "\n\n".join(labels)


def generate_product_labels(data: List[Dict[str, Any]]) -> str:
    """Generate product labels for warehouse use"""
    
    labels = []
    
    for item in data:
        label = f"""
SKU: {item.get('product_sku', 'N/A')}
{item.get('product_name', 'N/A')}
Qty: {item.get('quantity', 1)}
Order: {item.get('order_number', 'N/A')}
Date: {item.get('order_date', 'N/A')}
"""
        labels.append(label.strip())
    
    return "\n" + "="*30 + "\n".join(labels)


def generate_barcode_data(data: List[Dict[str, Any]]) -> List[Dict[str, str]]:
    """Generate barcode data for label printing"""
    
    barcode_data = []
    
    for item in data:
        barcode_data.append({
            "sku": item.get('product_sku', ''),
            "order": item.get('order_number', ''),
            "customer": item.get('customer_name', ''),
            "quantity": str(item.get('quantity', 1))
        })
    
    return barcode_data
