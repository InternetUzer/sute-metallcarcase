"""Entry point used by PyInstaller; source launch: python -m kontur.desktop."""
from kontur.desktop import main

if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        import os
        if os.name == "nt":
            import ctypes
            ctypes.windll.user32.MessageBoxW(None, "Контур не смог запуститься. Проверьте доступ к папке приложения.\n" + type(exc).__name__, "Контур", 16)
        raise
