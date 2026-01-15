import ctypes
import logging

logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

SCARD_SCOPE_USER = 0
SCARD_S_SUCCESS = 0
SCARD_E_NO_READERS_AVAILABLE = 0x8010002E

winscard = ctypes.windll.winscard

hContext = ctypes.c_ulong()

# Establish context
rv = winscard.SCardEstablishContext(SCARD_SCOPE_USER, None, None, ctypes.byref(hContext))
print(f"SCardEstablishContext: {rv:08X} (Success: {rv == SCARD_S_SUCCESS})")

if rv == SCARD_S_SUCCESS:
    try:
        # Get reader list size
        pcchReaders = ctypes.c_ulong()
        rv = winscard.SCardListReadersW(hContext, None, None, ctypes.byref(pcchReaders))
        
        print(f"SCardListReadersW (size): {rv:08X}")
        print(f"Buffer size needed: {pcchReaders.value}")
        
        if rv == SCARD_E_NO_READERS_AVAILABLE:
            print("No readers available")
        elif rv == SCARD_S_SUCCESS:
            # Get reader names
            readers_buffer = ctypes.create_unicode_buffer(pcchReaders.value)
            rv = winscard.SCardListReadersW(hContext, None, readers_buffer, ctypes.byref(pcchReaders))
            
            print(f"SCardListReadersW (get): {rv:08X}")
            print(f"Raw buffer value: {repr(readers_buffer.value)}")
            
            # Parse multi-string buffer (null-terminated strings, double-null at end)
            readers = []
            i = 0
            while i < pcchReaders.value:
                # Read until null terminator
                current = ""
                while i < pcchReaders.value and readers_buffer[i] != '\0':
                    current += readers_buffer[i]
                    i += 1
                
                if current:
                    readers.append(current)
                    print(f"Found reader: {current}")
                
                # Move past the null terminator
                i += 1
                
                # Check if we hit the double-null (end of list)
                if i >= pcchReaders.value or readers_buffer[i] == '\0':
                    break
            
            print(f"\nTotal readers found: {len(readers)}")
            for i, reader in enumerate(readers):
                print(f"  {i+1}. {reader}")
                
    finally:
        winscard.SCardReleaseContext(hContext)
