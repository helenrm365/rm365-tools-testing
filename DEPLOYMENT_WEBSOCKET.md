# WebSocket Deployment Checklist for Railway

## Current Issue
The WebSocket collaboration feature works locally but fails on Railway production because the dependencies aren't installed yet.

## Error You're Seeing
```
[WebSocket] Cannot join room: not connected
[WebSocket] Connection error: i: websocket error
```

This is **expected** because Railway hasn't deployed the WebSocket dependencies yet.

## Solution: Deploy WebSocket to Railway

### Step 1: Verify Local Installation
Make sure it works locally first:

```powershell
cd backend
pip install python-socketio aioredis
python app.py
```

You should see:
```
✅ WebSocket support enabled at /ws
```

### Step 2: Commit and Push Changes

```powershell
# From repository root
git status
git add .
git commit -m "Add real-time collaboration with WebSocket support"
git push origin main
```

### Step 3: Railway Will Auto-Deploy

Railway will automatically:
1. Detect the push to `main` branch
2. Build using `backend/Dockerfile`
3. Install dependencies from `backend/requirements.txt` (including `python-socketio` and `aioredis`)
4. Deploy the new version

### Step 4: Verify Deployment

1. **Check Railway logs** for:
   ```
   ✅ WebSocket support enabled at /ws
   ```

2. **If you see this instead:**
   ```
   ⚠️  WebSocket dependencies not installed
   ```
   Then Railway didn't install the dependencies. Check the build logs.

3. **Test the WebSocket endpoint:**
   ```
   https://rm365-tools-testing-production.up.railway.app/ws/socket.io/
   ```
   Should return a Socket.IO handshake response (not a 404)

### Step 5: Test in Production

1. Open your production app: `https://rm365-tools-testing.pages.dev`
2. Navigate to Inventory Management
3. Open in two browser tabs
4. You should see presence indicators at the top
5. No more WebSocket errors in console

## Current Code Status

✅ **Graceful Degradation Implemented**
- The app won't crash if WebSocket isn't available
- On localhost: Shows error toast
- On production: Fails silently, logs to console
- Regular inventory management continues to work

✅ **WebSocket Configuration**
- Polling fallback enabled for Railway compatibility
- CORS configured for production domains
- Automatic reconnection enabled

## If Railway Still Has Issues

### Check 1: Dockerfile Installs Requirements

Verify `backend/Dockerfile` has:
```dockerfile
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
```

### Check 2: Requirements.txt Has Dependencies

Verify `backend/requirements.txt` includes:
```
python-socketio
aioredis
```

### Check 3: Railway Environment

Some Railway deployments may need explicit configuration:
1. Go to Railway dashboard
2. Select your service
3. Check "Deploy Logs" for any errors during `pip install`
4. Verify the service is using the correct Dockerfile

### Check 4: WebSocket Port/Path

Railway might need specific configuration for WebSocket upgrades. If issues persist:

1. Check if Railway supports WebSocket (it should)
2. Verify no proxy/load balancer is blocking WebSocket connections
3. Try changing transport order in `websocket.js` (already set to `['polling', 'websocket']`)

## Alternative: Disable WebSocket Temporarily

If you need the production site working NOW without collaboration:

**Option 1: Comment out WebSocket initialization**
```javascript
// In frontend/js/modules/inventory/management.js
// await initCollaboration();  // Temporarily disabled
```

**Option 2: Remove WebSocket mount**
```python
# In backend/app.py
# Comment out the WebSocket section temporarily
```

## Testing Locally Before Deploy

```powershell
# Terminal 1: Start backend
cd backend
python app.py

# Terminal 2: Test WebSocket
# Open: http://localhost:8000/test-collaboration.html
# Click "Connect" - should connect successfully

# Terminal 3: Test inventory
# Open two tabs: http://localhost:8000/inventory/management
# Both should show presence
```

## Expected Timeline

1. **Push to Git**: Immediate
2. **Railway Build**: 2-5 minutes
3. **Railway Deploy**: 1-2 minutes
4. **Total**: ~5-7 minutes until WebSocket is live

## Next Steps

**Right now, do this:**

```powershell
git add .
git commit -m "Add WebSocket collaboration + graceful degradation"
git push origin main
```

Then **wait 5-7 minutes** and refresh your production site. The WebSocket errors should be gone!

---

**Status**: The code is ready and will work as soon as Railway redeploys with the new dependencies.
