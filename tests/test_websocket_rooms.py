#!/usr/bin/env python3
"""
Test WebSocket room syncing across Birmingham order pages.
This script connects multiple clients to the same room and verifies 
that events are properly broadcast to all clients in the room.
"""

import asyncio
import socketio
import requests
import json
from datetime import datetime

# Configuration
BASE_URL = "http://localhost:8000"
WS_URL = "http://localhost:8000"

# Get auth token
def get_token():
    response = requests.post(
        f"{BASE_URL}/api/v1/auth/login",
        json={"username": "superadmin", "password": "admin123"}
    )
    return response.json()["access_token"]

class TestClient:
    def __init__(self, name: str, room: str, token: str):
        self.name = name
        self.room = room
        self.token = token
        self.sio = socketio.AsyncClient(logger=False, engineio_logger=False)
        self.received_events = []
        self.connected = False
        
        # Register event handlers
        @self.sio.event
        async def connect():
            self.connected = True
            print(f"[{self.name}] ✅ Connected to WebSocket")
            
        @self.sio.event
        async def disconnect():
            self.connected = False
            print(f"[{self.name}] ❌ Disconnected from WebSocket")
            
        @self.sio.on('board_update')
        async def on_board_update(data):
            self.received_events.append(('board_update', data))
            print(f"[{self.name}] 📦 Received board_update: {json.dumps(data, indent=2)[:200]}...")
            
        @self.sio.on('order_progress_update')
        async def on_order_progress_update(data):
            self.received_events.append(('order_progress_update', data))
            print(f"[{self.name}] 📊 Received order_progress_update: {json.dumps(data, indent=2)[:200]}...")
            
        @self.sio.on('session_status_change')
        async def on_session_status_change(data):
            self.received_events.append(('session_status_change', data))
            print(f"[{self.name}] 🔄 Received session_status_change: {json.dumps(data, indent=2)[:200]}...")
            
        @self.sio.on('item_update')
        async def on_item_update(data):
            self.received_events.append(('item_update', data))
            print(f"[{self.name}] ✏️ Received item_update: {json.dumps(data, indent=2)[:200]}...")
            
        @self.sio.on('*')
        async def catch_all(event, data):
            if event not in ['board_update', 'order_progress_update', 'session_status_change', 'item_update']:
                self.received_events.append((event, data))
                print(f"[{self.name}] 🔔 Received {event}: {json.dumps(data, indent=2)[:100]}...")
    
    async def connect(self):
        try:
            await self.sio.connect(
                WS_URL,
                socketio_path='/ws/socket.io',
                transports=['polling', 'websocket'],
                wait_timeout=10
            )
            await asyncio.sleep(1)
        except Exception as e:
            print(f"[{self.name}] ❌ Connection error: {e}")
            raise
            
    async def join_room(self):
        print(f"[{self.name}] 🚪 Joining room: {self.room}")
        await self.sio.emit('join_inventory_room', {'room': self.room})
        await asyncio.sleep(0.3)
        
    async def leave_room(self):
        print(f"[{self.name}] 🚪 Leaving room: {self.room}")
        await self.sio.emit('leave_room', {'room': self.room})
        await asyncio.sleep(0.3)
        
    async def disconnect(self):
        await self.sio.disconnect()


async def test_room_isolation():
    """Test that events only go to the correct room"""
    print("\n" + "="*60)
    print("TEST: Room Isolation")
    print("="*60)
    
    token = get_token()
    
    # Create clients for different rooms
    bham_client = TestClient("Birmingham-1", "birmingham_orders", token)
    france_client = TestClient("France-1", "france_orders", token)
    
    await bham_client.connect()
    await france_client.connect()
    
    await bham_client.join_room()
    await france_client.join_room()
    
    # Make an API call that triggers a Birmingham event
    print("\n📤 Making API call to trigger Birmingham event...")
    
    headers = {"Authorization": f"Bearer {token}"}
    
    # Get tracking board (this should trigger events to Birmingham room)
    response = requests.get(f"{BASE_URL}/api/v1/magento/tracking/board", headers=headers)
    if response.status_code == 200:
        print("✅ Tracking board fetched successfully")
    
    await asyncio.sleep(1)
    
    print(f"\n📊 Results:")
    print(f"   Birmingham received: {len(bham_client.received_events)} events")
    print(f"   France received: {len(france_client.received_events)} events")
    
    await bham_client.disconnect()
    await france_client.disconnect()


async def test_same_room_broadcast():
    """Test that all clients in the same room receive events"""
    print("\n" + "="*60)
    print("TEST: Same Room Broadcast")
    print("="*60)
    
    token = get_token()
    
    # Create multiple clients in the same room (simulating different pages)
    fulfillment = TestClient("OrderFulfillment", "birmingham_orders", token)
    tracking = TestClient("OrderTracking", "birmingham_orders", token)
    progress = TestClient("OrderProgress", "birmingham_orders", token)
    approval = TestClient("OrderApproval", "birmingham_orders", token)
    
    clients = [fulfillment, tracking, progress, approval]
    
    for client in clients:
        await client.connect()
        await client.join_room()
    
    print(f"\n📊 All 4 clients connected to 'birmingham_orders' room")
    
    # Now make an API call that will trigger a board_update event
    print("\n📤 Triggering an order status change...")
    
    headers = {"Authorization": f"Bearer {token}"}
    
    # Get an order to work with
    board = requests.get(f"{BASE_URL}/api/v1/magento/tracking/board", headers=headers).json()
    
    if board.get('ready_to_pick') and len(board['ready_to_pick']) > 0:
        # Find an approved order we can claim
        approved_orders = [o for o in board['ready_to_pick'] if o['status'] == 'approved']
        
        if approved_orders:
            order = approved_orders[0]
            session_id = order['session_id']
            print(f"   Found approved order: {order['order_number']} (session: {session_id})")
            
            # Claim the session (this should emit events to the room)
            claim_resp = requests.post(
                f"{BASE_URL}/api/v1/magento/sessions/{session_id}/claim",
                headers=headers
            )
            print(f"   Claim session response: {claim_resp.status_code}")
            if claim_resp.status_code == 200:
                print(f"   ✅ Session claimed successfully!")
            else:
                print(f"   Response body: {claim_resp.text[:200]}")
        else:
            print("   No approved orders available, will try approving one...")
            # Get any order that can be approved
            if board.get('ready_to_pick'):
                order = board['ready_to_pick'][0]
                order_number = order['order_number']
                print(f"   Approving order: {order_number}")
                approve_resp = requests.post(
                    f"{BASE_URL}/api/v1/magento/tracking/approve-order",
                    headers=headers,
                    json={"order_number": order_number}
                )
                print(f"   Approve order response: {approve_resp.status_code}")
                if approve_resp.status_code != 200:
                    print(f"   Response body: {approve_resp.text[:200]}")
    else:
        print("   No orders in ready_to_pick column")
    
    # Wait for WebSocket events
    await asyncio.sleep(2)
    
    print(f"\n📊 Events received by each 'page':")
    for client in clients:
        events = [e[0] for e in client.received_events]
        print(f"   {client.name}: {events if events else 'No events'}")
    
    for client in clients:
        await client.disconnect()


async def test_leave_room():
    """Test that leaving a room stops receiving events"""
    print("\n" + "="*60)
    print("TEST: Leave Room")
    print("="*60)
    
    token = get_token()
    
    client1 = TestClient("Client-1", "birmingham_orders", token)
    client2 = TestClient("Client-2", "birmingham_orders", token)
    
    await client1.connect()
    await client2.connect()
    
    await client1.join_room()
    await client2.join_room()
    
    print("✅ Both clients joined room")
    
    # Client 2 leaves the room
    await client2.leave_room()
    print("✅ Client-2 left the room")
    
    # Now trigger an event
    headers = {"Authorization": f"Bearer {token}"}
    board = requests.get(f"{BASE_URL}/api/v1/magento/tracking/board", headers=headers).json()
    
    # Wait for any events
    await asyncio.sleep(1)
    
    print(f"\n📊 Results after Client-2 left:")
    print(f"   Client-1 events: {len(client1.received_events)}")
    print(f"   Client-2 events: {len(client2.received_events)}")
    
    await client1.disconnect()
    await client2.disconnect()


async def main():
    print("🧪 WebSocket Room Syncing Tests")
    print("================================")
    print(f"Backend: {BASE_URL}")
    print(f"Time: {datetime.now().isoformat()}")
    
    try:
        await test_same_room_broadcast()
        await test_room_isolation()
        await test_leave_room()
        
        print("\n" + "="*60)
        print("✅ All tests completed!")
        print("="*60)
        
    except Exception as e:
        print(f"\n❌ Test failed with error: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    asyncio.run(main())
