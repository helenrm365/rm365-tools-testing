import ctypes
from ctypes import wintypes
import os
import sys

# Constants
SG_DEV_UNKNOWN = 0
SG_DEV_FDP02 = 0x01
SG_DEV_FDU02 = 0x03
SG_DEV_FDU03 = 0x04       # Hamster Plus
SG_DEV_FDU04 = 0x05       # Hamster IV
SG_DEV_FDU05 = 0x06       # HU20
SG_DEV_FDU06 = 0x07       # UPx
SG_DEV_FDU07 = 0x08       # U10
SG_DEV_FDU07A = 0x09      # U10-AP
SG_DEV_FDU08 = 0x0A       # U20A
SG_DEV_FDU08P = 0x0B      # U20-AP
SG_DEV_FDU06P = 0x0C      # UPx-P
SG_DEV_FDUSDA = 0x0D      # U20-ASF-BT (SPP/Serial)
SG_DEV_FDUSDA_BLE = 0x0E  # U20-ASF-BT (BLE)
SG_DEV_FDU08X = 0x0F      # U20-ASFX (USB)
SG_DEV_FDU09 = 0x10       # U30
SG_DEV_FDU08A = 0x11      # U20-AP
SG_DEV_FDU09A = 0x12      # U30
SG_DEV_FDU10A = 0x13      # U-AIR
SG_DEV_FDU06AP = 0x16     # UPx-AP, Hamster Pro v2
SG_DEV_FDU08AL = 0x17     # U20-AL
SG_DEV_AUTO = 0xFF

SG_IMPTYPE_LP = 0x00
SG_IMPTYPE_LR = 0x01
SG_IMPTYPE_NP = 0x02
SG_IMPTYPE_NR = 0x03

# Error Codes
SGFDX_ERROR_NONE = 0
SGFDX_ERROR_CREATION_FAILED = 1
SGFDX_ERROR_FUNCTION_FAILED = 2
SGFDX_ERROR_INVALID_PARAM = 3
SGFDX_ERROR_NOT_USED = 4
SGFDX_ERROR_DLLLOAD_FAILED = 5
SGFDX_ERROR_DLLLOAD_FAILED_DRV = 6
SGFDX_ERROR_DLLLOAD_FAILED_ALGO = 7
SGFDX_ERROR_NO_LONGER_SUPPORTED = 8
SGFDX_ERROR_DLLLOAD_FAILED_WSQ = 9

SGFDX_ERROR_SYSLOAD_FAILED = 51
SGFDX_ERROR_INITIALIZE_FAILED = 52
SGFDX_ERROR_LINE_DROPPED = 53
SGFDX_ERROR_TIME_OUT = 54
SGFDX_ERROR_DEVICE_NOT_FOUND = 55
SGFDX_ERROR_DRVLOAD_FAILED = 56
SGFDX_ERROR_WRONG_IMAGE = 57
SGFDX_ERROR_LACK_OF_BANDWIDTH = 58
SGFDX_ERROR_DEV_ALREADY_OPEN = 59
SGFDX_ERROR_GETSN_FAILED = 60
SGFDX_ERROR_UNSUPPORTED_DEV = 61
SGFDX_ERROR_FAKE_FINGER = 62
SGFDX_ERROR_FAKE_INITIALIZE_FAILED = 63

SGFDX_ERROR_FEAT_NUMBER = 101
SGFDX_ERROR_INVALID_TEMPLATE_TYPE = 102
SGFDX_ERROR_INVALID_TEMPLATE1 = 103
SGFDX_ERROR_INVALID_TEMPLATE2 = 104
SGFDX_ERROR_EXTRACT_FAIL = 105
SGFDX_ERROR_MATCH_FAIL = 106

# Template Formats
TEMPLATE_FORMAT_ANSI378 = 0x0100
TEMPLATE_FORMAT_SG400 = 0x0200
TEMPLATE_FORMAT_ISO19794 = 0x0300

# Structures
class SGFingerInfo(ctypes.Structure):
    _fields_ = [
        ("FingerNumber", ctypes.c_ushort),
        ("ViewNumber", ctypes.c_ushort),
        ("ImpressionType", ctypes.c_ushort),
        ("ImageQuality", ctypes.c_ushort),
    ]

class SGDeviceList(ctypes.Structure):
    _fields_ = [
        ("DevName", ctypes.c_ulong),
        ("DevID", ctypes.c_ulong),
        ("DevType", ctypes.c_ushort),
        ("DevSN", ctypes.c_ubyte * 16),
    ]

class SGDeviceInfoParam(ctypes.Structure):
    _fields_ = [
        ("DeviceID", ctypes.c_ulong),
        ("DeviceSN", ctypes.c_ubyte * 16),
        ("ComPort", ctypes.c_ulong),
        ("ComSpeed", ctypes.c_ulong),
        ("ImageWidth", ctypes.c_ulong),
        ("ImageHeight", ctypes.c_ulong),
        ("Contrast", ctypes.c_ulong),
        ("Brightness", ctypes.c_ulong),
        ("Gain", ctypes.c_ulong),
        ("ImageDPI", ctypes.c_ulong),
        ("FWVersion", ctypes.c_ulong),
    ]

class SGFPLib:
    def __init__(self):
        self.hFPM = ctypes.c_void_p(0)
        self.dll = None
        self.load_dll()

    def load_dll(self):
        # Determine the path to the DLL
        base_path = os.path.dirname(os.path.abspath(__file__))
        dll_path = os.path.join(base_path, "lib", "sgfplib.dll")
        
        if not os.path.exists(dll_path):
            raise FileNotFoundError(f"DLL not found at {dll_path}")
            
        try:
            self.dll = ctypes.WinDLL(dll_path)
        except Exception as e:
            raise Exception(f"Failed to load DLL: {e}")

        # Define function signatures
        self.dll.SGFPM_Create.argtypes = [ctypes.POINTER(ctypes.c_void_p)]
        self.dll.SGFPM_Create.restype = ctypes.c_ulong

        self.dll.SGFPM_Init.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
        self.dll.SGFPM_Init.restype = ctypes.c_ulong

        self.dll.SGFPM_InitEx.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong]
        self.dll.SGFPM_InitEx.restype = ctypes.c_ulong

        self.dll.SGFPM_OpenDevice.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
        self.dll.SGFPM_OpenDevice.restype = ctypes.c_ulong

        self.dll.SGFPM_CloseDevice.argtypes = [ctypes.c_void_p]
        self.dll.SGFPM_CloseDevice.restype = ctypes.c_ulong

        self.dll.SGFPM_GetImage.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_ubyte)]
        self.dll.SGFPM_GetImage.restype = ctypes.c_ulong

        self.dll.SGFPM_GetImageEx.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_ubyte), ctypes.c_ulong, ctypes.c_void_p, ctypes.c_ulong]
        self.dll.SGFPM_GetImageEx.restype = ctypes.c_ulong

        self.dll.SGFPM_GetDeviceInfo.argtypes = [ctypes.c_void_p, ctypes.POINTER(SGDeviceInfoParam)]
        self.dll.SGFPM_GetDeviceInfo.restype = ctypes.c_ulong

        self.dll.SGFPM_SetTemplateFormat.argtypes = [ctypes.c_void_p, ctypes.c_ushort]
        self.dll.SGFPM_SetTemplateFormat.restype = ctypes.c_ulong

        self.dll.SGFPM_GetMaxTemplateSize.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_ulong)]
        self.dll.SGFPM_GetMaxTemplateSize.restype = ctypes.c_ulong

        self.dll.SGFPM_CreateTemplate.argtypes = [ctypes.c_void_p, ctypes.POINTER(SGFingerInfo), ctypes.POINTER(ctypes.c_ubyte), ctypes.POINTER(ctypes.c_ubyte)]
        self.dll.SGFPM_CreateTemplate.restype = ctypes.c_ulong

        self.dll.SGFPM_MatchTemplate.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_ubyte), ctypes.POINTER(ctypes.c_ubyte), ctypes.c_ulong, ctypes.POINTER(ctypes.c_int)]
        self.dll.SGFPM_MatchTemplate.restype = ctypes.c_ulong
        
        self.dll.SGFPM_EnumerateDevice.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_ulong), ctypes.POINTER(ctypes.POINTER(SGDeviceList))]
        self.dll.SGFPM_EnumerateDevice.restype = ctypes.c_ulong

        self.dll.SGFPM_GetLastError.argtypes = [ctypes.c_void_p]
        self.dll.SGFPM_GetLastError.restype = ctypes.c_ulong

        self.dll.SGFPM_Terminate.argtypes = [ctypes.c_void_p]
        self.dll.SGFPM_Terminate.restype = ctypes.c_ulong

        self.dll.SGFPM_SetLedOn.argtypes = [ctypes.c_void_p, ctypes.c_bool]
        self.dll.SGFPM_SetLedOn.restype = ctypes.c_ulong

        self.dll.SGFPM_Configure.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
        self.dll.SGFPM_Configure.restype = ctypes.c_ulong

        self.dll.SGFPM_SetBrightness.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
        self.dll.SGFPM_SetBrightness.restype = ctypes.c_ulong

        self.dll.SGFPM_EnableSmartCapture.argtypes = [ctypes.c_void_p, ctypes.c_bool]
        self.dll.SGFPM_EnableSmartCapture.restype = ctypes.c_ulong

        self.dll.SGFPM_SetAutoOnIRLedTouchOn.argtypes = [ctypes.c_void_p, ctypes.c_bool, ctypes.c_bool]
        self.dll.SGFPM_SetAutoOnIRLedTouchOn.restype = ctypes.c_ulong

    def Init(self, dev_name=SG_DEV_AUTO):
        if self.hFPM:
            # Already initialized, close first to be safe or just return True if we want to reuse
            # But here we assume we want to re-init
            self.Close()

        res = self.dll.SGFPM_Create(ctypes.byref(self.hFPM))
        if res != SGFDX_ERROR_NONE:
            print(f"SGFPM_Create failed: {res}")
            return False
        
        res = self.dll.SGFPM_Init(self.hFPM, dev_name)
        if res != SGFDX_ERROR_NONE:
            print(f"SGFPM_Init failed: {res}")
            return False
            
        # Try to open the device
        # If SG_DEV_AUTO is used, we might need to enumerate first or just try opening device 0
        # Some versions of the SDK treat SG_DEV_AUTO as "find and open the first one"
        # But let's try to be more explicit if AUTO fails.
        
        res = self.dll.SGFPM_OpenDevice(self.hFPM, SG_DEV_AUTO)
        if res == SGFDX_ERROR_NONE:
            self._configure_device()
            return True
            
        # If AUTO failed, try to enumerate and open the first one
        ndevs = ctypes.c_ulong(0)
        dev_list = ctypes.POINTER(SGDeviceList)()
        res = self.dll.SGFPM_EnumerateDevice(self.hFPM, ctypes.byref(ndevs), ctypes.byref(dev_list))
        
        if res == SGFDX_ERROR_NONE and ndevs.value > 0:
            # Open the first device found
            first_dev_id = dev_list[0].DevID
            res = self.dll.SGFPM_OpenDevice(self.hFPM, first_dev_id)
            if res == SGFDX_ERROR_NONE:
                self._configure_device()
                return True
                
        return False

    def _configure_device(self):
        # Enable Smart Capture and AutoOn for better experience
        self.EnableSmartCapture(True)
        self.SetAutoOnIRLedTouchOn(True, True)
        self.SetBrightness(100)

    def SetLedOn(self, on):
        res = self.dll.SGFPM_SetLedOn(self.hFPM, on)
        return res == SGFDX_ERROR_NONE

    def Configure(self, hwnd=None):
        res = self.dll.SGFPM_Configure(self.hFPM, hwnd)
        return res == SGFDX_ERROR_NONE

    def SetBrightness(self, brightness):
        res = self.dll.SGFPM_SetBrightness(self.hFPM, brightness)
        return res == SGFDX_ERROR_NONE

    def EnableSmartCapture(self, enable):
        res = self.dll.SGFPM_EnableSmartCapture(self.hFPM, enable)
        return res == SGFDX_ERROR_NONE

    def SetAutoOnIRLedTouchOn(self, ir_led, touch_on):
        res = self.dll.SGFPM_SetAutoOnIRLedTouchOn(self.hFPM, ir_led, touch_on)
        return res == SGFDX_ERROR_NONE

    def Close(self):
        if self.hFPM:
            self.dll.SGFPM_CloseDevice(self.hFPM)
            self.dll.SGFPM_Terminate(self.hFPM)
            self.hFPM = None

    def GetDeviceInfo(self):
        info = SGDeviceInfoParam()
        res = self.dll.SGFPM_GetDeviceInfo(self.hFPM, ctypes.byref(info))
        if res != SGFDX_ERROR_NONE:
            return None
        return info

    def CaptureImage(self):
        # 1. Get Device Info to know image size
        info = self.GetDeviceInfo()
        if not info:
            return None
            
        img_width = info.ImageWidth
        img_height = info.ImageHeight
        img_buf_size = img_width * img_height
        
        img_buf = (ctypes.c_ubyte * img_buf_size)()
        
        # 2. Capture Image (Blocking)
        res = self.dll.SGFPM_GetImage(self.hFPM, img_buf)
        if res != SGFDX_ERROR_NONE:
            print(f"SGFPM_GetImage failed with error: {res}")
            return None
            
        return bytes(img_buf)

    def CaptureTemplate(self, timeout=5000, quality=50):
        # 1. Get Device Info to know image size
        info = self.GetDeviceInfo()
        if not info:
            return None
            
        img_width = info.ImageWidth
        img_height = info.ImageHeight
        img_buf_size = img_width * img_height
        
        img_buf = (ctypes.c_ubyte * img_buf_size)()
        
        # Set Template Format to ANSI378
        self.dll.SGFPM_SetTemplateFormat(self.hFPM, TEMPLATE_FORMAT_ANSI378)
        
        # 2. Capture Image
        # Using GetImageEx for timeout support
        res = self.dll.SGFPM_GetImageEx(self.hFPM, img_buf, timeout, None, quality)
        if res != SGFDX_ERROR_NONE:
            print(f"SGFPM_GetImageEx failed with error: {res}")
            return None
            
        # 3. Create Template
        # Get Max Template Size
        max_template_size = ctypes.c_ulong(0)
        self.dll.SGFPM_GetMaxTemplateSize(self.hFPM, ctypes.byref(max_template_size))
        
        template_buf = (ctypes.c_ubyte * max_template_size.value)()
        
        finger_info = SGFingerInfo()
        finger_info.FingerNumber = 1 # Unknown/Default
        finger_info.ViewNumber = 1
        finger_info.ImpressionType = SG_IMPTYPE_LP
        finger_info.ImageQuality = 0 # Will be filled
        
        res = self.dll.SGFPM_CreateTemplate(self.hFPM, ctypes.byref(finger_info), img_buf, template_buf)
        if res != SGFDX_ERROR_NONE:
            return None
            
        # Return the template as bytes
        return bytes(template_buf)

    def CaptureTemplateWithImage(self, timeout=5000, format="ANSI"):
        # 1. Get Device Info to know image size
        info = self.GetDeviceInfo()
        if not info:
            return None, None
            
        img_width = info.ImageWidth
        img_height = info.ImageHeight
        img_buf_size = img_width * img_height
        
        img_buf = (ctypes.c_ubyte * img_buf_size)()
        
        # 2. Capture Image
        res = self.dll.SGFPM_GetImageEx(self.hFPM, img_buf, timeout, None, 50)
        if res != SGFDX_ERROR_NONE:
            return None, None
            
        # 3. Create Template
        max_template_size = ctypes.c_ulong(0)
        self.dll.SGFPM_GetMaxTemplateSize(self.hFPM, ctypes.byref(max_template_size))
        
        template_buf = (ctypes.c_ubyte * max_template_size.value)()
        
        finger_info = SGFingerInfo()
        finger_info.FingerNumber = 1
        finger_info.ViewNumber = 1
        finger_info.ImpressionType = SG_IMPTYPE_LP
        finger_info.ImageQuality = 0
        
        # Set format if needed (default is usually ANSI or SG400 depending on Init)
        # self.dll.SGFPM_SetTemplateFormat(self.hFPM, TEMPLATE_FORMAT_ANSI378)
        
        res = self.dll.SGFPM_CreateTemplate(self.hFPM, ctypes.byref(finger_info), img_buf, template_buf)
        if res != SGFDX_ERROR_NONE:
            return None, bytes(img_buf)
            
        return bytes(template_buf), bytes(img_buf)

    def MatchTemplate(self, template1, template2):
        if not template1 or not template2:
            return 0
            
        t1_buf = (ctypes.c_ubyte * len(template1)).from_buffer_copy(template1)
        t2_buf = (ctypes.c_ubyte * len(template2)).from_buffer_copy(template2)
        
        matched = ctypes.c_int(0)
        # Security Level: SL_NORMAL = 5
        res = self.dll.SGFPM_MatchTemplate(self.hFPM, t1_buf, t2_buf, 5, ctypes.byref(matched))
        
        if res != SGFDX_ERROR_NONE:
            return 0
            
        # The MatchTemplate function returns boolean matched, but we might want a score.
        # SGFPM_GetMatchingScore is better for score.
        
        return 100 if matched.value else 0

