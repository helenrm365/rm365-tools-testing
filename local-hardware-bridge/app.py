"""
RM365 Local Hardware Bridge Service
Runs on local PC to interface with fingerprint readers and RFID card readers
Allows cloud-hosted frontend to access local USB hardware
"""

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel
import uvicorn
import base64
import logging
from typing import Optional, List

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="RM365 Local Hardware Bridge",
    description="Local service for fingerprint and card reader hardware access",
    version="1.0.0"
)

# CORS configuration - allow your Cloudflare frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://rm365-tools-testing.pages.dev",
        "https://*.pages.dev",  # Cloudflare preview deployments
        "http://localhost:5000",
        "http://127.0.0.1:5000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def add_private_network_header(request: Request, call_next):
    response = await call_next(request)
    response.headers["Access-Control-Allow-Private-Network"] = "true"
    return response

@app.options("/{rest_of_path:path}")
async def preflight_handler(request: Request, rest_of_path: str):
    response = Response()
    response.headers["Access-Control-Allow-Origin"] = request.headers.get("Origin", "*")
    response.headers["Access-Control-Allow-Methods"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "*"
    response.headers["Access-Control-Allow-Private-Network"] = "true"
    return response



class FingerprintResponse(BaseModel):
    status: str
    template_b64: Optional[str] = None
    error: Optional[str] = None


class CardResponse(BaseModel):
    status: str
    uid: Optional[str] = None
    error: Optional[str] = None


class MatchRequest(BaseModel):
    template1_b64: str
    template2_b64: str


class CandidateTemplate(BaseModel):
    id: str
    template_b64: str
    name: Optional[str] = None


class BatchMatchRequest(BaseModel):
    probe_template_b64: str
    candidates: List[CandidateTemplate]
    threshold: Optional[int] = 80


@app.get("/")
def root():
    return {
        "service": "RM365 Local Hardware Bridge",
        "status": "running",
        "endpoints": {
            "health": "/health",
            "fingerprint": "/fingerprint/scan",
            "card": "/card/scan",
        }
    }


@app.get("/health")
def health():
    """Health check endpoint"""
    return {
        "status": "ok",
        "service": "local-hardware-bridge",
        "fingerprint_available": check_fingerprint_hardware(),
        "card_available": check_card_hardware(),
    }


def check_fingerprint_hardware() -> bool:
    """Check if fingerprint reader hardware is available"""
    try:
        # Try to import SecuGen libraries
        import secugen
        sg = secugen.SGFPLib()
        if sg.Init():
            sg.Close()
            return True
        return False
    except ImportError:
        return False
    except Exception as e:
        logger.error(f"Error checking fingerprint hardware: {e}")
        return False


def check_card_hardware() -> bool:
    """Check if card reader hardware is available"""
    try:
        import serial
        import serial.tools.list_ports
        
        # List all available COM ports
        ports = list(serial.tools.list_ports.comports())
        
        # Try to find a card reader on common ports
        # You can also check by device description or VID/PID
        for port in ports:
            try:
                # Try to open the port briefly to see if it's accessible
                ser = serial.Serial(port.device, 9600, timeout=0.5)
                ser.close()
                logger.info(f"Found potential card reader on {port.device}")
                return True
            except (serial.SerialException, OSError):
                continue
        
        return False
    except ImportError:
        logger.warning("pyserial not installed")
        return False
    except Exception as e:
        logger.error(f"Error checking card hardware: {e}")
        return False


@app.post("/fingerprint/scan", response_model=FingerprintResponse)
async def scan_fingerprint(timeout: int = 8000):
    """
    Scan fingerprint using SecuGen reader
    """
    print(f"--- Fingerprint scan requested (timeout: {timeout}ms) ---")
    logger.info(f"Fingerprint scan requested (timeout: {timeout}ms)")
    
    try:
        import secugen
        
        # Initialize SecuGen device
        print("Initializing SecuGen device...")
        sg = secugen.SGFPLib()
        
        # Try explicit init for Hamster Pro 30
        print("Attempting Init with SG_DEV_FDU09A...")
        if not sg.Init(secugen.SG_DEV_FDU09A): 
             print("Init with SG_DEV_FDU09A failed. Attempting Init with SG_DEV_AUTO...")
             if not sg.Init(secugen.SG_DEV_AUTO): # Fallback to Auto
                print("Init with SG_DEV_AUTO failed.")
                raise Exception("Failed to initialize SecuGen device")
        
        print("Device initialized successfully.")
        
        try:
            # Capture fingerprint
            print("Starting CaptureTemplate...")
            print("Please place finger on the sensor now.")
            
            # Note: Hamster Pro 30 (U30) uses IR detection. 
            # The light might not turn on until you place your finger.
            # We use quality=0 to accept any quality image to avoid timeouts on dry fingers
            template = sg.CaptureTemplate(timeout, quality=0)
            
            if not template:
                print("CaptureTemplate returned None (Timeout or Error)")
                return FingerprintResponse(
                    status="error",
                    error="No fingerprint detected within timeout period"
                )
            
            print(f"Capture successful. Template size: {len(template)}")
            
            # Encode template as base64
            template_b64 = base64.b64encode(template).decode('utf-8')
            
            logger.info("Fingerprint captured successfully")
            return FingerprintResponse(
                status="success",
                template_b64=template_b64
            )
        finally:
            print("Closing device...")
            sg.Close()
            print("Device closed.")
        
    except ImportError:
        print("ImportError: secugen module not found or DLL missing")
        raise HTTPException(
            status_code=501,
            detail={
                "error": "SecuGen SDK not installed properly",
                "instructions": [
                    "Ensure secugen.py and lib/sgfplib.dll are present"
                ]
            }
        )
    except Exception as e:
        print(f"Error scanning fingerprint: {e}")
        logger.error(f"Error scanning fingerprint: {e}")
        return FingerprintResponse(
            status="error",
            error=str(e)
        )


# Global SecuGen instance to keep device open
_sg_device = None

def get_secugen_device():
    global _sg_device
    try:
        import secugen
        if _sg_device is None:
            _sg_device = secugen.SGFPLib()
            
            # Try specific device first (Hamster Pro 30)
            if not _sg_device.Init(secugen.SG_DEV_FDU09A):
                # Fallback to auto
                if not _sg_device.Init(secugen.SG_DEV_AUTO):
                    _sg_device = None
                    return None
            
            # Configure once
            _sg_device.EnableSmartCapture(True)
            # Disable AutoOn to ensure the sensor is active during capture
            # This fixes issues with dry fingers not triggering the touch sensor
            _sg_device.SetAutoOnIRLedTouchOn(False, False)
            logger.info("SecuGen device initialized and kept open.")
            
        return _sg_device
    except Exception as e:
        logger.error(f"Failed to initialize SecuGen: {e}")
        _sg_device = None
        return None

import struct

def create_bmp_from_raw(raw_data, width, height):
    """
    Wraps raw grayscale pixel data in a BMP container
    """
    # BMP File Header (14 bytes)
    # 0-1: 'BM'
    # 2-5: File size
    # 6-9: Reserved (0)
    # 10-13: Offset to pixel data (14 + 40 + 1024 = 1078)
    
    # BMP Info Header (40 bytes)
    # 14-17: Header size (40)
    # 18-21: Width
    # 22-25: Height (negative for top-down)
    # 26-27: Planes (1)
    # 28-29: Bits per pixel (8)
    # 30-33: Compression (0)
    # 34-37: Image size
    # 38-41: X pixels per meter
    # 42-45: Y pixels per meter
    # 46-49: Colors used (256)
    # 50-53: Important colors (256)
    
    # Color Palette (1024 bytes)
    # 256 entries of (B, G, R, A)
    
    file_size = 14 + 40 + 1024 + len(raw_data)
    offset = 1078
    
    # File Header
    bmp = b'BM'
    bmp += struct.pack('<I', file_size)
    bmp += b'\x00\x00\x00\x00'
    bmp += struct.pack('<I', offset)
    
    # Info Header
    bmp += struct.pack('<I', 40)
    bmp += struct.pack('<i', width)
    bmp += struct.pack('<i', -height) # Negative height for top-down
    bmp += struct.pack('<H', 1)
    bmp += struct.pack('<H', 8)
    bmp += struct.pack('<I', 0)
    bmp += struct.pack('<I', len(raw_data))
    bmp += struct.pack('<i', 0)
    bmp += struct.pack('<i', 0)
    bmp += struct.pack('<I', 256)
    bmp += struct.pack('<I', 256)
    
    # Color Palette (Grayscale)
    for i in range(256):
        bmp += struct.pack('BBBB', i, i, i, 0)
        
    # Pixel Data
    bmp += raw_data
    
    return bmp

@app.post("/SGIFPCapture")
async def secugen_capture(payload: dict = None):
    """
    SecuGen-compatible endpoint for fingerprint capture
    Mimics the SecuGen WebAPI format for compatibility
    
    Expected payload: { Timeout: int, TemplateFormat: str, FakeDetection: int }
    Returns: { ErrorCode: int, TemplateBase64: str, BMPBase64: str }
    """
    if not payload:
        payload = {}
    
    timeout = payload.get('Timeout', 10000)
    template_format = payload.get('TemplateFormat', 'ANSI')
    
    logger.info(f"SecuGen capture requested (timeout: {timeout}ms, format: {template_format})")
    
    try:
        sg = get_secugen_device()
        if not sg:
            logger.error("SecuGen Init failed: Device not found")
            return {"ErrorCode": 55, "TemplateBase64": None, "BMPBase64": None}  # Device not found
        
        try:
            # Capture fingerprint with image
            logger.info("Starting CaptureTemplateWithImage...")
            # Use quality=0 to accept any image (prevents timeouts on dry fingers)
            template, image, width, height = sg.CaptureTemplateWithImage(timeout, template_format, quality=0)
            
            if not template:
                logger.warning("CaptureTemplateWithImage returned None (Timeout)")
                return {"ErrorCode": 54, "TemplateBase64": None, "BMPBase64": None}  # Timeout
            
            # Encode as base64
            template_b64 = base64.b64encode(template).decode('utf-8')
            
            image_b64 = None
            if image and width > 0 and height > 0:
                bmp_data = create_bmp_from_raw(image, width, height)
                image_b64 = base64.b64encode(bmp_data).decode('utf-8')
            
            logger.info(f"SecuGen capture successful! Template size: {len(template)}")
            return {
                "ErrorCode": 0,  # Success
                "TemplateBase64": template_b64,
                "BMPBase64": image_b64
            }
        except Exception as e:
            # If capture fails (e.g. device disconnected), reset global instance
            logger.error(f"Capture failed, resetting device: {e}")
            global _sg_device
            if _sg_device:
                try:
                    _sg_device.Close()
                except:
                    pass
            _sg_device = None
            return {"ErrorCode": 10004, "TemplateBase64": None, "BMPBase64": None}
            
    except Exception as e:
        logger.error(f"SecuGen capture error: {e}")
        return {
            "ErrorCode": 10004,  # Service access error
            "TemplateBase64": None,
            "BMPBase64": None
        }


@app.post("/card/scan", response_model=CardResponse)
async def scan_card(timeout: int = 5):
    """
    Scan RFID card reader
    
    Args:
        timeout: Timeout in seconds (default: 5)
        
    Returns:
        CardResponse with card UID or error
    """
    logger.info(f"Card scan requested (timeout: {timeout}s)")
    
    try:
        import serial
        import serial.tools.list_ports
        import time
        
        # Auto-detect card reader
        ports = list(serial.tools.list_ports.comports())
        ser = None
        connected_port = None
        
        # Try each available port
        for port_info in ports:
            try:
                logger.info(f"Trying port {port_info.device}...")
                ser = serial.Serial(port_info.device, 9600, timeout=1)
                connected_port = port_info.device
                logger.info(f"Connected to {connected_port}")
                break
            except (serial.SerialException, OSError):
                continue
        
        if not ser:
            return CardResponse(
                status="error",
                error="No card reader found. Please connect your RFID reader and try again."
            )
        
        # Wait for card
        logger.info(f"Waiting for card (timeout: {timeout}s)...")
        start_time = time.time()
        
        while time.time() - start_time < timeout:
            try:
                if ser.in_waiting > 0:
                    # Read data from card reader
                    data = ser.readline().decode('ascii', errors='ignore').strip()
                    
                    # Filter out empty or invalid data
                    if data and len(data) >= 8:  # Minimum UID length
                        ser.close()
                        logger.info(f"Card scanned successfully: {data[:4]}...{data[-4:]}")
                        return CardResponse(
                            status="success",
                            uid=data
                        )
            except UnicodeDecodeError:
                # Some card readers send binary data
                try:
                    ser.reset_input_buffer()
                    raw_data = ser.read(ser.in_waiting)
                    if raw_data:
                        uid = raw_data.hex().upper()
                        if len(uid) >= 8:
                            ser.close()
                            logger.info(f"Card scanned (hex): {uid[:4]}...{uid[-4:]}")
                            return CardResponse(
                                status="success",
                                uid=uid
                            )
                except:
                    pass
            
            time.sleep(0.1)
        
        ser.close()
        return CardResponse(
            status="error",
            error=f"No card detected within {timeout} seconds. Please try again."
        )
        
    except ImportError:
        raise HTTPException(
            status_code=501,
            detail={
                "error": "pyserial not installed",
                "instructions": [
                    "Install pyserial: pip install pyserial",
                    "Or run: pip install -r requirements.txt"
                ]
            }
        )
    except Exception as e:
        logger.error(f"Error scanning card: {e}")
        return CardResponse(
            status="error",
            error=f"Card reader error: {str(e)}"
        )


@app.post("/fingerprint/match")
async def match_fingerprint(request: MatchRequest):
    """
    Match two fingerprint templates using SecuGen matcher
    
    Args:
        request: MatchRequest containing two base64 encoded templates
        
    Returns:
        Match score (0-100, higher is better match)
    """
    try:
        import secugen
        
        sg = secugen.SGFPLib()
        if not sg.Init(secugen.SG_DEV_FDU09A):
             if not sg.Init(secugen.SG_DEV_AUTO):
                raise Exception("Failed to initialize SecuGen device")
        
        try:
            # Decode templates
            template1 = base64.b64decode(request.template1_b64)
            template2 = base64.b64decode(request.template2_b64)
            
            # Match templates
            score = sg.MatchTemplate(template1, template2)
            
            return {
                "status": "success",
                "score": score,
                "matched": score >= 60  # Typical threshold
            }
        finally:
            sg.Close()
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error matching fingerprints: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/fingerprint/match_batch")
async def match_fingerprint_batch(request: BatchMatchRequest):
    """
    Match a probe fingerprint against a list of candidates efficiently.
    Initializes the matcher once and iterates through candidates.
    
    Args:
        request: BatchMatchRequest containing probe template and list of candidates
        
    Returns:
        Best match result
    """
    try:
        import secugen
        
        sg = secugen.SGFPLib()
        if not sg.Init(secugen.SG_DEV_FDU09A):
             if not sg.Init(secugen.SG_DEV_AUTO):
                raise Exception("Failed to initialize SecuGen device")
        
        try:
            # Decode probe template
            probe_template = base64.b64decode(request.probe_template_b64)
            
            best_score = 0
            best_match = None
            
            for candidate in request.candidates:
                try:
                    candidate_template = base64.b64decode(candidate.template_b64)
                    score = sg.MatchTemplate(probe_template, candidate_template)
                    
                    if score > best_score:
                        best_score = score
                        best_match = candidate
                except Exception:
                    continue
            
            threshold = request.threshold or 60
            
            return {
                "status": "success",
                "best_score": best_score,
                "matched": best_score >= threshold,
                "match": best_match if best_score >= threshold else None
            }
        finally:
            sg.Close()
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error matching fingerprints batch: {e}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    logger.info("=" * 60)
    logger.info("RM365 Local Hardware Bridge Service")
    logger.info("=" * 60)
    logger.info("Starting service on http://127.0.0.1:8080")
    logger.info("")
    logger.info("This service provides local hardware access for:")
    logger.info("  - SecuGen fingerprint readers")
    logger.info("  - RFID card readers")
    logger.info("")
    logger.info("Make sure to:")
    logger.info("  1. Connect your hardware devices")
    logger.info("  2. Install required SDKs and drivers")
    logger.info("  3. Configure the code for your specific hardware")
    logger.info("=" * 60)
    logger.info("")
    
    import os
    ssl_keyfile = "key.pem"
    ssl_certfile = "cert.pem"
    
    # Force HTTP mode to avoid certificate issues and simplify PNA
    # if os.path.exists(ssl_keyfile) and os.path.exists(ssl_certfile):
    #     logger.info(f"SSL certificates found. Starting in HTTPS mode.")
    #     uvicorn.run(
    #         app,
    #         host="127.0.0.1",
    #         port=8080,
    #         log_level="info",
    #         ssl_keyfile=ssl_keyfile,
    #         ssl_certfile=ssl_certfile
    #     )
    # else:
    logger.info("Starting in HTTP mode (Forced).")
    uvicorn.run(
        app,
        host="127.0.0.1",  # Only accessible from this PC
        port=8080,
        log_level="info"
    )
