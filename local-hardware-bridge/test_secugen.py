import secugen
import sys
import os
import ctypes

print(f"Testing SecuGen wrapper...")
print(f"Current directory: {os.getcwd()}")
print(f"Python version: {sys.version}")

try:
    sg = secugen.SGFPLib()
    print("Successfully loaded SGFPLib class")
    
    # Manually call Create to test
    res = sg.dll.SGFPM_Create(ctypes.byref(sg.hFPM))
    print(f"SGFPM_Create result: {res}")
    
    if sg.hFPM:
        print(f"Successfully created SGFPM object. Handle: {sg.hFPM}")
        
        # Initialize with specific device name if possible
        # SG_DEV_FDU09A = 0x12 (18) for Hamster Pro 30
        print("Initializing with SG_DEV_FDU09A (18)...")
        res = sg.dll.SGFPM_Init(sg.hFPM, 0x12)
        print(f"SGFPM_Init result: {res}")
        
        # Enumerate
        ndevs = ctypes.c_ulong(0)
        dev_list = ctypes.POINTER(secugen.SGDeviceList)()
        res = sg.dll.SGFPM_EnumerateDevice(sg.hFPM, ctypes.byref(ndevs), ctypes.byref(dev_list))
        print(f"SGFPM_EnumerateDevice result: {res}")
        print(f"Number of devices found: {ndevs.value}")
        
        if ndevs.value > 0:
            for i in range(ndevs.value):
                dev = dev_list[i]
                print(f"Device {i}: ID={dev.DevID}, Type={dev.DevType}, Name={dev.DevName}")
                
            # Try to open the first device
            print(f"Attempting to open device ID: {dev_list[0].DevID}")
            res = sg.dll.SGFPM_OpenDevice(sg.hFPM, dev_list[0].DevID)
            print(f"SGFPM_OpenDevice result: {res}")
            
            if res == 0:
                print("Device opened successfully!")
                
                # Get Device Info
                info = secugen.SGDeviceInfoParam()
                res = sg.dll.SGFPM_GetDeviceInfo(sg.hFPM, ctypes.byref(info))
                print(f"GetDeviceInfo result: {res}")
                if res == 0:
                    print(f"Image Size: {info.ImageWidth}x{info.ImageHeight}")
                    
                    # Configure
                    print("Configuring...")
                    if sg.Configure(None):
                        print("Configure success")
                    else:
                        print("Configure failed")

                    # Set Brightness
                    print("Setting Brightness to 100...")
                    sg.SetBrightness(100)

                    # Enable Smart Capture
                    print("Enabling Smart Capture...")
                    sg.EnableSmartCapture(True)

                    # Set AutoOn
                    print("Setting AutoOn IR LED...")
                    sg.SetAutoOnIRLedTouchOn(True, True)

                    # Test LED
                    print("Testing LED... Turning ON for 2 seconds")
                    if sg.SetLedOn(True):
                        print("SetLedOn(True) returned success")
                    else:
                        print("SetLedOn(True) returned failure")
                        
                    import time
                    time.sleep(2)
                    sg.SetLedOn(False)
                    print("LED OFF")
                    
                    # Test Capture
                    print("Testing Capture (Timeout 5s, Quality 0)... Please place finger on sensor")
                    template = sg.CaptureTemplate(5000, quality=0)
                    if template:
                        print(f"Capture successful! Template size: {len(template)}")
                    else:
                        print("Capture failed or timed out.")
                        
                    # Test Blocking Capture
                    print("Testing Blocking Capture... Please place finger on sensor")
                    img = sg.CaptureImage()
                    if img:
                        print(f"Blocking Capture successful! Image size: {len(img)}")
                    else:
                        print("Blocking Capture failed.")
                
                sg.dll.SGFPM_CloseDevice(sg.hFPM)
                print("Device closed.")
            else:
                print("Failed to open device.")
        else:
            print("No devices found via EnumerateDevice.")
            
            # Try opening with AUTO anyway
            print("Attempting to open with SG_DEV_AUTO...")
            res = sg.dll.SGFPM_OpenDevice(sg.hFPM, secugen.SG_DEV_AUTO)
            print(f"SGFPM_OpenDevice(AUTO) result: {res}")

    else:
        print("Failed to create SGFPM object (Handle is None)")

    print("Test finished.")
except Exception as e:
    print(f"Test failed with exception: {e}")
    import traceback
    traceback.print_exc()
