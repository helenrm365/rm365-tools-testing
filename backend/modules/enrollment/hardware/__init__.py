"""
Hardware module initialization for enrollment devices.
"""

from .nfc_reader import read_nfc_uid, NFCReaderError, test_nfc_reader
from .fingerprint_reader import (
    read_fingerprint_template, 
    FingerprintCaptureError, 
    test_fingerprint_reader,
    get_fingerprint_info
)

__all__ = [
    'read_nfc_uid',
    'NFCReaderError', 
    'test_nfc_reader',
    'read_fingerprint_template',
    'FingerprintCaptureError',
    'test_fingerprint_reader',
    'get_fingerprint_info'
]
