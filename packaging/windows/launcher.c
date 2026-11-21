/* PodStudio.exe: starts the bundled Python on `-m podstudio`, so the program has its own name and icon in the
 * taskbar and Task Manager instead of "python".
 *
 * Layout it expects:  <install>\bin\PodStudio.exe   <install>\bin\libpython3.x.dll   <install>\lib\python3.x\...
 * It tells the app where <install> is through PODSTUDIO_HOME; podstudio/winenv.py does the rest.
 *
 * Built twice from this one file: a windowed PodStudio.exe (no console) and PodStudio-console.exe (-DCONSOLE_APP),
 * which prints to a terminal, e.g.   PodStudio-console.exe --self-test
 */
#define PY_SSIZE_T_CLEAN
#include <Python.h>
#include <windows.h>
#include <stdlib.h>
#include <wchar.h>

static int run(int argc, wchar_t **argv)
{
    wchar_t exe[MAX_PATH * 2];
    DWORD n = GetModuleFileNameW(NULL, exe, (DWORD)(sizeof exe / sizeof exe[0]));
    if (n == 0 || n >= sizeof exe / sizeof exe[0]) {
        MessageBoxW(NULL, L"PodStudio could not work out where it is installed.", L"PodStudio", MB_ICONERROR);
        return 1;
    }

    /* <install>\bin\PodStudio.exe -> <install> */
    wchar_t home[MAX_PATH * 2];
    wcscpy(home, exe);
    for (int cut = 0; cut < 2; cut++) {
        wchar_t *slash = wcsrchr(home, L'\\');
        if (!slash) { MessageBoxW(NULL, L"Unexpected install layout.", L"PodStudio", MB_ICONERROR); return 1; }
        *slash = 0;
    }
    _wputenv_s(L"PODSTUDIO_HOME", home);
    _wputenv_s(L"PODSTUDIO_EXE", exe);

    /* PodStudio.exe [args]  ->  python -I -m podstudio [args] */
    wchar_t **args = (wchar_t **)calloc((size_t)argc + 5, sizeof(wchar_t *));
    int k = 0;
    args[k++] = exe;
    args[k++] = L"-I";
    args[k++] = L"-m";
    args[k++] = L"podstudio";
    for (int i = 1; i < argc; i++) args[k++] = argv[i];
    args[k] = NULL;
    return Py_Main(k, args);
}

#ifdef CONSOLE_APP
int wmain(int argc, wchar_t **argv) { return run(argc, argv); }
#else
int WINAPI wWinMain(HINSTANCE inst, HINSTANCE prev, PWSTR cmd, int show)
{
    (void)inst; (void)prev; (void)cmd; (void)show;
    return run(__argc, __wargv);
}
#endif
