import ctypes
import os
from ctypes import wintypes


class LASTINPUTINFO(ctypes.Structure):
    _fields_ = [("cbSize", wintypes.UINT), ("dwTime", wintypes.DWORD)]


def seconds_since_last_input() -> float:
    """Return only the age of the last input event; never read its contents."""
    if os.name != "nt":
        return 0.0
    info = LASTINPUTINFO()
    info.cbSize = ctypes.sizeof(LASTINPUTINFO)
    if not ctypes.windll.user32.GetLastInputInfo(ctypes.byref(info)):
        return 0.0
    ctypes.windll.kernel32.GetTickCount64.restype = ctypes.c_ulonglong
    tick_now = ctypes.windll.kernel32.GetTickCount64() & 0xFFFFFFFF
    return ((tick_now - info.dwTime) & 0xFFFFFFFF) / 1000.0
