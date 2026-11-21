import sys

if "--self-test" in sys.argv[1:]:                       # no window: check this install and exit
    from .selftest import run
    raise SystemExit(run())

from .app import main
raise SystemExit(main())
