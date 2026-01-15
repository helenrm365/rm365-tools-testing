"""
Quick test to verify ACR1252U NFC reader works
Place a card on the reader when prompted
"""
import acr_reader
import time

print("=" * 60)
print("ACR1252U NFC Reader Test")
print("=" * 60)

# List readers
print("\n1. Checking for readers...")
readers = acr_reader.list_readers()

if not readers:
    print("❌ No readers found!")
    print("\nTroubleshooting:")
    print("- Is the ACR1252U connected via USB?")
    print("- Is the Smart Card service running? (Check services.msc)")
    print("- Is the driver installed?")
    exit(1)

print(f"✅ Found {len(readers)} reader(s):")
for i, reader in enumerate(readers, 1):
    print(f"   {i}. {reader}")

# Scan for card
print("\n2. Waiting for card scan...")
print("   Please tap your NFC card/FOB on the reader...")
print("   (Timeout: 10 seconds)")

success, uid, error = acr_reader.scan_nfc_card(timeout=10)

if success:
    print(f"\n✅ SUCCESS!")
    print(f"   Card UID: {uid}")
    print(f"   Length: {len(uid)} characters")
else:
    print(f"\n❌ FAILED!")
    print(f"   Error: {error}")
    if "No card detected" in error:
        print("\n   Did you tap a card on the reader?")
        print("   Try again and keep the card on the reader for 1-2 seconds")

print("\n" + "=" * 60)
