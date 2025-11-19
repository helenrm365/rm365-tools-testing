"""
RM365 Local Hardware Bridge Service
Runs on local PC to interface with fingerprint readers and RFID card readers
Allows cloud-hosted frontend to access local USB hardware
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn
import base64
import logging
from typing import Optional

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


class FingerprintResponse(BaseModel):
    status: str
    template_b64: Optional[str] = None
    error: Optional[str] = None


class CardResponse(BaseModel):
    status: str
    uid: Optional[str] = None
    error: Optional[str] = None


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
        # This is a placeholder - actual implementation depends on SecuGen SDK
        # import secugen  # Uncomment when SDK is installed
        # return secugen.is_device_connected()
        return False  # Return False until SDK is configured
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
    
    Args:
        timeout: Timeout in milliseconds (default: 8000)
        
    Returns:
        FingerprintResponse with base64-encoded template or error
    """
    logger.info(f"Fingerprint scan requested (timeout: {timeout}ms)")
    
    try:
        # Import SecuGen SDK here (lazy import)
        # Uncomment and modify when you have the SDK installed
        """
        from secugen import SGFPLib
        
        # Initialize SecuGen device
        sg = SGFPLib()
        if not sg.Init():
            raise Exception("Failed to initialize SecuGen device")
        
        # Capture fingerprint
        template = sg.CaptureTemplate(timeout)
        
        if not template:
            return FingerprintResponse(
                status="error",
                error="No fingerprint detected within timeout period"
            )
        
        # Encode template as base64
        template_b64 = base64.b64encode(template).decode('utf-8')
        
        logger.info("Fingerprint captured successfully")
        return FingerprintResponse(
            status="success",
            template_b64=template_b64
        )
        """
        
        # Placeholder response until SDK is installed
        raise HTTPException(
            status_code=501,
            detail={
                "error": "SecuGen SDK not installed",
                "instructions": [
                    "1. Download SecuGen SDK from https://www.secugen.com/",
                    "2. Install the SDK on this PC",
                    "3. Connect your SecuGen fingerprint reader",
                    "4. Uncomment the SecuGen integration code in this file",
                    "5. Restart this service"
                ]
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error scanning fingerprint: {e}")
        return FingerprintResponse(
            status="error",
            error=str(e)
        )


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
        # Uncomment when SecuGen SDK is installed
        """
        from secugen import SGFPLib
        
        sg = SGFPLib()
        if not sg.Init():
            return {"ErrorCode": 55, "TemplateBase64": None, "BMPBase64": None}  # Device not found
        
        # Capture fingerprint with image
        template, image = sg.CaptureTemplateWithImage(timeout, template_format)
        
        if not template:
            return {"ErrorCode": 54, "TemplateBase64": None, "BMPBase64": None}  # Timeout
        
        # Encode as base64
        template_b64 = base64.b64encode(template).decode('utf-8')
        image_b64 = base64.b64encode(image).decode('utf-8') if image else None
        
        logger.info("SecuGen capture successful")
        return {
            "ErrorCode": 0,  # Success
            "TemplateBase64": template_b64,
            "BMPBase64": image_b64
        }
        """
        
        # Return timeout error until SDK is installed
        return {
            "ErrorCode": 55,  # Device not found
            "TemplateBase64": None,
            "BMPBase64": None,
            "__note": "SecuGen SDK not installed. Install from https://www.secugen.com/"
        }
        
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
async def match_fingerprint(template1_b64: str, template2_b64: str):
    """
    Match two fingerprint templates using SecuGen matcher
    
    Args:
        template1_b64: First template (base64 encoded)
        template2_b64: Second template (base64 encoded)
        
    Returns:
        Match score (0-100, higher is better match)
    """
    try:
        # Uncomment when SecuGen SDK is installed
        """
        from secugen import SGFPLib
        
        sg = SGFPLib()
        if not sg.Init():
            raise Exception("Failed to initialize SecuGen device")
        
        # Decode templates
        template1 = base64.b64decode(template1_b64)
        template2 = base64.b64decode(template2_b64)
        
        # Match templates
        score = sg.MatchTemplate(template1, template2)
        
        return {
            "status": "success",
            "score": score,
            "matched": score >= 60  # Typical threshold
        }
        """
        
        raise HTTPException(
            status_code=501,
            detail="SecuGen SDK not installed. See /fingerprint/scan endpoint for setup instructions."
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error matching fingerprints: {e}")
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
    
    uvicorn.run(
        app,
        host="127.0.0.1",  # Only accessible from this PC
        port=8080,
        log_level="info"
    )
