# Order Fulfillment & Progress Popup Designs

This document outlines all the confirmation popups and modals designed for the Order Fulfillment and Order Progress modules, following the same design pattern as the fingerprint enrollment overwrite popup.

## Design Philosophy

All popups follow a consistent design pattern with:
- **Gradient headers** with color-coded severity (danger/red, warning/orange, primary/blue, success/green)
- **Icon badges** in the header for visual identification
- **Clear messaging** with proper whitespace and line breaks
- **Focused actions** with appropriately styled buttons
- **Keyboard support** (Enter to confirm, Escape to cancel)
- **Overlay click** to dismiss
- **Smooth animations** (slide-in effect)

## Order Fulfillment Popups

### 1. Takeover Request (from another user)
**Scenario:** Another user requests to take over your active session  
**Icon:** 👋  
**Header:** Warning (Orange)  
**Message:** `{username} is requesting to take over your session for order {orderNumber}. Do you want to allow this takeover?`  
**Buttons:** Allow (Warning) | Deny (Gray)

---

### 2. Order In Progress - Takeover Request
**Scenario:** User tries to start a session that's being worked on by someone else  
**Icon:** ⚠️  
**Header:** Warning (Orange)  
**Message:** `This order is currently being worked on by {username}. Would you like to request to take it over?`  
**Buttons:** Request Takeover (Warning) | Cancel (Gray)

---

### 3. Own Order In Progress
**Scenario:** User tries to start a session they're already working on elsewhere  
**Icon:** ⚠️  
**Header:** Warning (Orange)  
**Message:** `This order is being worked on by you in another session. Please complete or cancel that session first.`  
**Buttons:** OK (Warning)

---

### 4. Draft Session Available - Claim
**Scenario:** User finds a draft session (their own or claimable)  
**Icon:** 📝  
**Header:** Primary (Blue)  
**Message:** `You have a draft session for this order. Would you like to continue where you left off?`  
**OR**  
`There is a draft session for this order started by {username}. Would you like to claim it and continue?`  
**Buttons:** Continue (Primary) | Cancel (Gray)

---

### 5. Order Already Completed
**Scenario:** User tries to start a session for a completed order  
**Icon:** ✅  
**Header:** Primary (Blue)  
**Message:** `This order has already been completed. Completed by: {username}. You cannot start a new session for completed orders.`  
**Buttons:** OK (Primary)

---

### 6. Cancelled Session - Start Fresh
**Scenario:** User finds a cancelled session and wants to restart  
**Icon:** 🔄  
**Header:** Primary (Blue)  
**Message:** `There is a cancelled session for this order. Would you like to start a fresh session?`  
**Buttons:** Start Fresh (Primary) | Cancel (Gray)

---

### 7. Complete Session Confirmation
**Scenario:** User clicks "Complete Session"  
**Icon:** ✅  
**Header:** Success (Green)  
**Message:** `Are you sure you want to complete this session? This will finalize all scanned items.`  
**Buttons:** Complete (Success) | Cancel (Gray)

---

### 8. Cancel Session Confirmation
**Scenario:** User clicks "Cancel Session"  
**Icon:** 🗑️  
**Header:** Danger (Red)  
**Message:** `Are you sure you want to cancel this session? All progress will be lost and cannot be recovered.`  
**Buttons:** Cancel Session (Danger) | Keep Working (Gray)

---

### 9. Resume Active Session
**Scenario:** User has an active session when loading the page  
**Icon:** ▶️  
**Header:** Primary (Blue)  
**Message:** `You have an active session for order {orderNumber}. Would you like to resume where you left off?`  
**Buttons:** Resume (Primary) | Start New (Gray)

---

### 10. Session Transferred
**Scenario:** Admin transfers the session to another user  
**Icon:** 🔄  
**Header:** Warning (Orange)  
**Message:** `This session has been transferred to {newOwner}.`  
**Buttons:** OK (Warning)

---

### 11. Session Force Cancelled
**Scenario:** Admin force-cancels the session  
**Icon:** ⛔  
**Header:** Danger (Red)  
**Message:** `This session has been cancelled by an administrator. Reason: {reason}`  
**Buttons:** OK (Danger)

---

### 12. Session Force Taken Over
**Scenario:** Admin force-takes over the session  
**Icon:** 👤  
**Header:** Warning (Orange)  
**Message:** `This session has been taken over by {newOwner}.`  
**Buttons:** OK (Warning)

---

### 13. Session Completed Successfully
**Scenario:** Session completion succeeds  
**Icon:** 🎉  
**Header:** Success (Green)  
**Message:** `Session completed successfully! You can now start a new order.`  
**Buttons:** OK (Success)

---

### 14. Takeover Request Accepted
**Scenario:** Your takeover request was approved  
**Icon:** ✅  
**Header:** Success (Green)  
**Message:** `Your takeover request for order {orderNumber} was accepted!`  
**Buttons:** OK (Success)

---

### 15. Takeover Request Rejected
**Scenario:** Your takeover request was denied  
**Icon:** ❌  
**Header:** Warning (Orange)  
**Message:** `Your takeover request for order {orderNumber} was rejected.`  
**Buttons:** OK (Warning)

---

## Order Progress Dashboard Popups

### 1. Force Cancel Session
**Scenario:** Admin wants to force-cancel an active session  
**Icon:** ⛔  
**Header:** Danger (Red)  
**Message:** `Are you sure you want to force cancel the session for Order #{orderNumber}? Current owner: {currentOwner}. This action will immediately terminate the session and notify the user.`  
**Input Field:** Reason (optional textarea)  
**Buttons:** Force Cancel (Danger) | Cancel (Gray)

---

### 2. Force Assign Session
**Scenario:** Admin wants to reassign a session to another user  
**Icon:** 👤  
**Header:** Warning (Orange)  
**Message:** `Assign the session for Order #{orderNumber} to another user. Current owner: {currentOwner}. The current user will lose access to this session.`  
**Input Field:** Target username (required text input)  
**Buttons:** Assign (Warning) | Cancel (Gray)

---

### 3. Takeover Session
**Scenario:** User/admin wants to take over a session  
**Icon:** 🔄  
**Header:** Warning (Orange)  
**Message:** `Are you sure you want to take over the session for Order #{orderNumber}? Current owner: {currentOwner} will be notified.`  
**Buttons:** Take Over (Warning) | Cancel (Gray)

---

### 4. Session Details View
**Scenario:** User clicks "View Details" on a session  
**Icon:** 📋  
**Header:** Primary (Blue)  
**Message:** Displays full session information including:
- Order number and invoice
- Session type and status
- Created/modified timestamps
- Current owner
- Progress percentage
- Recent activity log (last 5 entries)  
**Buttons:** Close (Primary)

---

### 5. Action Completed Successfully
**Scenario:** An admin action (assign/cancel/takeover) succeeds  
**Icon:** 🎉  
**Header:** Success (Green)  
**Message:** `Session for Order #{orderNumber} has been successfully {action}.`  
**Buttons:** OK (Success)

---

### 6. Validation Error
**Scenario:** Required field missing (e.g., username)  
**Icon:** ⚠️  
**Header:** Warning (Orange)  
**Message:** `Please enter a {fieldName}.`  
**Buttons:** OK (Warning)

---

### 7. Action Failed Error
**Scenario:** API call fails  
**Icon:** ❌  
**Header:** Danger (Red)  
**Message:** `Action failed: {error.message}`  
**Buttons:** OK (Danger)

---

## Implementation Files

### Created Files:
1. **`frontend/js/ui/orderFulfillmentModals.js`** - All order fulfillment popups
2. **`frontend/js/ui/orderProgressModals.js`** - All order progress dashboard popups

### Modified Files:
1. **`frontend/js/modules/inventory/order-fulfillment.js`** - Updated to use new modals
2. **`frontend/js/modules/inventory/order-progress.js`** - Updated to use new modals

## Usage Examples

### Order Fulfillment
```javascript
import * as orderModals from '../../ui/orderFulfillmentModals.js';

// Complete session
const confirmed = await orderModals.confirmCompleteSession(orderNumber);
if (confirmed) {
  // Process completion
}

// Show success
await orderModals.alertSessionCompleted();

// Handle takeover request
const allowed = await orderModals.confirmAllowTakeover(username, orderNumber);
```

### Order Progress
```javascript
import * as progressModals from '../../ui/orderProgressModals.js';

// Force cancel with reason
const result = await progressModals.confirmForceCancel(orderNumber, currentOwner);
if (result.confirmed) {
  await executeCancel(sessionId, result.reason);
}

// Force assign with user input
const result = await progressModals.confirmForceAssign(orderNumber, currentOwner);
if (result.confirmed && result.user) {
  await executeAssign(sessionId, result.user);
}

// View details
await progressModals.showSessionDetails(session);
```

## Color Scheme

- **Danger (Red):** `#e74c3c` to `#c0392b` - Destructive actions
- **Warning (Orange):** `#f39c12` to `#e67e22` - Caution required
- **Primary (Blue):** `#3498db` to `#2980b9` - Informational
- **Success (Green):** `#27ae60` to `#229954` - Positive outcomes
- **Secondary (Gray):** `#6c757d` - Cancel/neutral actions

## Accessibility Features

- ✅ Keyboard navigation (Tab, Enter, Escape)
- ✅ Focus management (auto-focus on appropriate button)
- ✅ Clear visual hierarchy
- ✅ Color-coded severity levels
- ✅ Icon-based visual cues
- ✅ Consistent button placement
- ✅ Click-outside-to-dismiss
- ✅ Smooth animations for better UX
