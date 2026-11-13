"""Entry point used by PyInstaller; source launch: python -m kontur.desktop."""
from kontur.desktop import main

if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        import os
        if os.name == "nt":
            import ctypes
            from kontur.store import Error
            message = str(exc) if isinstance(exc, Error) else "Контур не смог запуститься.\n" + type(exc).__name__ + ": " + str(exc)
            ctypes.windll.user32.MessageBoxW(None, message, "Контур", 16)
        raise
