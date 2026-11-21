import sys

from . import __version__  # noqa: F401  (also prepares the Windows environment before anything imports GTK)

if "--self-test" in sys.argv[1:]:                       # no window: check this install and exit
    from .selftest import run
    raise SystemExit(run())

try:
    from .app import main
    code = main()
except Exception as e:                                   # noqa: BLE001
    if sys.platform != "win32":
        raise
    from .winenv import report_startup_failure
    report_startup_failure(e)
    code = 1
raise SystemExit(code)
