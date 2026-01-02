# Orders Logic & Architecture

## Overview

The Orders domain in this application encompasses two main areas:
1.  **Order Fulfillment**: The operational workflow for picking, packing, and verifying orders.
2.  **Magento Data (Order Reporting)**: The analytical and reporting view of order data.

Both systems are designed to operate on a **Read-Only** basis with the Magento platform, ensuring that the source of truth (Magento) is never directly modified by these tools.

## 1. Order Fulfillment Workflow

The fulfillment process follows a strict linear workflow designed to move orders from Magento's "Processing" state to a verified "Completed" state within the warehouse.

### Workflow Stages

1.  **Order Approval** (`/orders/order-approval`)
    *   **Input**: Fetches orders from Magento with status `processing`.
    *   **Action**: A supervisor or manager reviews the list and "Approves" orders for picking.
    *   **Output**: Creates a local "Approved" session. The order remains `processing` in Magento.
    *   **Purpose**: Controls the flow of work to the warehouse floor.

2.  **Order Fulfillment** (`/orders/order-fulfillment`)
    *   **Input**: List of "Approved" orders.
    *   **Device**: Designed for mobile devices/scanners.
    *   **Action**:
        *   Picker selects an order to "Start Session".
        *   Picker scans items using a barcode scanner.
        *   System validates scans against the Magento Invoice data.
    *   **Output**: Updates session status to `in_progress` and eventually `completed` or `ready_to_check`.

3.  **Order Progress** (`/orders/order-progress`)
    *   **Purpose**: Management Dashboard.
    *   **Action**: Supervisors can view all active sessions, see who is picking what, and perform administrative actions (e.g., force-cancel a session, take over a session from a stuck user).
    *   **Visibility**: Shows detailed progress of every active session.

4.  **Order Tracking** (`/orders/order-tracking`)
    *   **Purpose**: "Big Screen" / Warehouse Display.
    *   **Action**: Read-only view designed to be displayed on a large monitor in the warehouse.
    *   **Visibility**: Shows a high-level Kanban-style board of orders in columns (e.g., "Ready to Pick", "Checking", "Completed") so staff can see the queue at a glance. No interaction is expected here.

## Shared Infrastructure

Both modules share a common connection strategy to the Magento Database.

### Database Integration
Instead of using the slow and rate-limited Magento REST API, the system connects directly to the live Magento MySQL database (UK Region).

*   **Connection Provider**: `backend/modules/magentodata/db.py`
*   **Host**: `rm365uk.hypernode.io` (Configurable via `MAGENTO_DB_HOST_UK`)
*   **Credentials**: Read-only credentials should be used to enforce safety.

## 2. Order Fulfillment Architecture (`backend/modules/orders`)

This module facilitates the warehouse operations described above.

### Architecture
*   **Service Layer (`MagentoService`)**: Handles business logic, session state transitions.
*   **Data Access (`MagentoDBClient`)**: Fetches live order/invoice data from Magento DB.
*   **Repository (`MagentoRepo`)**: Manages local persistence of picking sessions (JSON/DB).

### Technical Workflow
1.  **Fetch**: Queries `sales_order` for orders with `status = 'processing'`.
2.  **Start Session**: Creates a local session based on a Magento Invoice (`sales_invoice`).
3.  **Pick & Scan**: Users scan items. System validates against `sales_invoice_item` data.
4.  **Inventory**: Deducts stock from local `inventory_metadata` upon scan.
5.  **Complete**: Marks session as complete locally. **No write-back to Magento.**

### Key Tables Accessed
*   `sales_order`, `sales_order_item`, `sales_order_address`, `sales_order_payment`
*   `sales_invoice`, `sales_invoice_item`

## 3. Magento Data / Reporting (`backend/modules/magentodata`)

This module provides raw data access and reporting capabilities, similar to tools like eMagicOne Store Manager.

### Architecture
*   **Client (`MagentoDataClient`)**: Executes complex SQL queries to flatten and retrieve order data.
*   **Direct Access**: Bypasses Magento models for performance.

### Capabilities
*   **Bulk Data Retrieval**: Fetches large datasets of orders and items efficiently.
*   **Search & Filter**: Performs SQL-level filtering on `increment_id`, `sku`, `customer_email`, etc.
*   **Flattened View**: Joins `sales_order`, `sales_order_item`, and address tables to provide a comprehensive flat view of order lines.

### Key Tables Accessed
*   `sales_order` (joined with `sales_order_item`)
*   `sales_order_address` (billing and shipping)

## Security & Safety

*   **Read-Only Principle**: Neither module contains logic to `INSERT`, `UPDATE`, or `DELETE` records in the Magento database.
*   **Local State**: All operational state (picking progress, session ownership, audit logs) is stored in the local application database/files, ensuring complete isolation from the ERP's core logic.
