// PodStudio for Windows: Win32 window + Direct3D 11 + Dear ImGui. A single self-contained executable.
#define WIN32_LEAN_AND_MEAN
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <d3d11.h>
#include <dwmapi.h>
#include <dxgi1_3.h>

#include <cstdlib>
#include <cwchar>
#include <imgui.h>
#include <backends/imgui_impl_dx11.h>
#include <backends/imgui_impl_win32.h>

#include "app.h"
#include "theme.h"

extern IMGUI_IMPL_API LRESULT ImGui_ImplWin32_WndProcHandler(HWND hWnd, UINT msg, WPARAM wParam, LPARAM lParam);

namespace {

ID3D11Device* g_dev = nullptr;
ID3D11DeviceContext* g_ctx = nullptr;
IDXGISwapChain* g_swap = nullptr;
ID3D11RenderTargetView* g_rtv = nullptr;
UINT g_resize_w = 0, g_resize_h = 0;
float g_scale = 1.0f, g_new_scale = 1.0f;
bool g_scale_changed = false, g_occluded = false;

void create_rtv() {
    ID3D11Texture2D* back = nullptr;
    g_swap->GetBuffer(0, IID_PPV_ARGS(&back));
    if (back) { g_dev->CreateRenderTargetView(back, nullptr, &g_rtv); back->Release(); }
}
void release_rtv() { if (g_rtv) { g_rtv->Release(); g_rtv = nullptr; } }

bool create_device(HWND hwnd) {
    const D3D_FEATURE_LEVEL levels[] = {D3D_FEATURE_LEVEL_11_0, D3D_FEATURE_LEVEL_10_0};
    // The flip model (Windows 10) paces frames more steadily and costs the compositor less than the older blit model;
    // fall back to the older one if the driver won't take it. No GPU at all (a VM, remote desktop): WARP, the software rasteriser.
    const DXGI_SWAP_EFFECT effects[] = {DXGI_SWAP_EFFECT_FLIP_DISCARD, DXGI_SWAP_EFFECT_DISCARD};
    const D3D_DRIVER_TYPE drivers[] = {D3D_DRIVER_TYPE_HARDWARE, D3D_DRIVER_TYPE_WARP};
    for (D3D_DRIVER_TYPE drv : drivers) {
        for (DXGI_SWAP_EFFECT fx : effects) {
            DXGI_SWAP_CHAIN_DESC sd{};
            sd.BufferCount = 2; sd.BufferDesc.Format = DXGI_FORMAT_R8G8B8A8_UNORM;
            sd.BufferUsage = DXGI_USAGE_RENDER_TARGET_OUTPUT; sd.OutputWindow = hwnd; sd.SampleDesc.Count = 1;
            sd.Windowed = TRUE; sd.SwapEffect = fx;
            D3D_FEATURE_LEVEL got;
            if (SUCCEEDED(D3D11CreateDeviceAndSwapChain(nullptr, drv, nullptr, 0, levels, 2, D3D11_SDK_VERSION, &sd, &g_swap, &g_dev, &got, &g_ctx))) {
                create_rtv();
                return true;
            }
        }
    }
    return false;
}

void cleanup_device() {
    release_rtv();
    if (g_swap) { g_swap->Release(); g_swap = nullptr; }
    if (g_ctx) { g_ctx->Release(); g_ctx = nullptr; }
    if (g_dev) { g_dev->Release(); g_dev = nullptr; }
}

LRESULT WINAPI wnd_proc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
    if (ImGui_ImplWin32_WndProcHandler(hwnd, msg, wp, lp)) return true;
    switch (msg) {
        case WM_SIZE:
            if (wp != SIZE_MINIMIZED) { g_resize_w = LOWORD(lp); g_resize_h = HIWORD(lp); }
            return 0;
        case WM_GETMINMAXINFO: {
            auto* mm = reinterpret_cast<MINMAXINFO*>(lp);
            const float s = ImGui_ImplWin32_GetDpiScaleForHwnd(hwnd);
            mm->ptMinTrackSize.x = LONG(1180 * s); mm->ptMinTrackSize.y = LONG(700 * s);
            return 0;
        }
        case WM_DPICHANGED: {
            g_new_scale = float(HIWORD(wp)) / 96.0f; g_scale_changed = true;
            const RECT* r = reinterpret_cast<RECT*>(lp);
            SetWindowPos(hwnd, nullptr, r->left, r->top, r->right - r->left, r->bottom - r->top, SWP_NOZORDER | SWP_NOACTIVATE);
            return 0;
        }
        case WM_SYSCOMMAND:
            if ((wp & 0xfff0) == SC_KEYMENU) return 0;   // no Alt menu
            break;
        case WM_DESTROY: PostQuitMessage(0); return 0;
    }
    return DefWindowProcW(hwnd, msg, wp, lp);
}

}  // namespace

int WINAPI wWinMain(HINSTANCE inst, HINSTANCE, PWSTR, int) {
    // One copy at a time: two would fight over the microphone. A second launch brings the first window forward.
    HANDLE single = CreateMutexW(nullptr, TRUE, L"Local\\PodStudio.SingleInstance");
    if (single && GetLastError() == ERROR_ALREADY_EXISTS && !_wgetenv(L"PODSTUDIO_NON_UNIQUE")) {
        if (HWND other = FindWindowW(L"PodStudioWindow", nullptr)) {
            if (IsIconic(other)) ShowWindow(other, SW_RESTORE);
            SetForegroundWindow(other);
        }
        return 0;
    }
    ImGui_ImplWin32_EnableDpiAwareness();
    WNDCLASSEXW wc{sizeof wc, CS_CLASSDC, wnd_proc, 0, 0, inst, nullptr, LoadCursor(nullptr, IDC_ARROW), nullptr, nullptr,
                   L"PodStudioWindow", nullptr};
    wc.hIcon = LoadIconW(inst, MAKEINTRESOURCEW(1));
    wc.hIconSm = wc.hIcon;
    RegisterClassExW(&wc);
    POINT origin{0, 0};
    HMONITOR mon = MonitorFromPoint(origin, MONITOR_DEFAULTTOPRIMARY);
    g_scale = ImGui_ImplWin32_GetDpiScaleForMonitor(mon);
    g_new_scale = g_scale;
    HWND hwnd = CreateWindowW(wc.lpszClassName, L"PodStudio", WS_OVERLAPPEDWINDOW, CW_USEDEFAULT, CW_USEDEFAULT,
                              int(1240 * g_scale), int(800 * g_scale), nullptr, nullptr, inst, nullptr);
    const BOOL dark = TRUE;                              // dark title bar to match the interface
    DwmSetWindowAttribute(hwnd, 20, &dark, sizeof dark);
    const COLORREF caption = RGB(9, 9, 11), text = RGB(250, 250, 250);
    DwmSetWindowAttribute(hwnd, 35, &caption, sizeof caption);
    DwmSetWindowAttribute(hwnd, 36, &text, sizeof text);

    if (!create_device(hwnd)) {
        MessageBoxW(nullptr, L"PodStudio couldn't start Direct3D 11. Please update your graphics driver.", L"PodStudio", MB_ICONERROR);
        return 1;
    }
    ShowWindow(hwnd, SW_SHOWDEFAULT);
    UpdateWindow(hwnd);

    IMGUI_CHECKVERSION();
    ImGui::CreateContext();
    ImGui::GetIO().IniFilename = nullptr;
    ImGui_ImplWin32_Init(hwnd);
    ImGui_ImplDX11_Init(g_dev, g_ctx);
    theme::setup(g_scale);

    ps::App app;
    app.init();
    for (int i = 1; i + 1 < __argc; i++)                  // --page N opens a tab directly (used by the CI screenshots)
        if (std::wcscmp(__wargv[i], L"--page") == 0) app.debug_set_page(_wtoi(__wargv[i + 1]));

    LARGE_INTEGER freq, last;
    QueryPerformanceFrequency(&freq); QueryPerformanceCounter(&last);
    bool done = false;
    while (!done && !app.wants_quit()) {
        MSG msg;
        while (PeekMessage(&msg, nullptr, 0U, 0U, PM_REMOVE)) {
            TranslateMessage(&msg); DispatchMessage(&msg);
            if (msg.message == WM_QUIT) done = true;
        }
        if (done) break;
        if (IsIconic(hwnd) || g_occluded) {                // minimised or hidden: don't spin the CPU and GPU for nothing
            Sleep(60);
            g_occluded = false;
            if (IsIconic(hwnd)) continue;
        }
        if (g_resize_w && g_resize_h) {
            release_rtv();
            g_swap->ResizeBuffers(0, g_resize_w, g_resize_h, DXGI_FORMAT_UNKNOWN, 0);
            g_resize_w = g_resize_h = 0;
            create_rtv();
        }
        if (g_scale_changed) {                           // moved to a monitor with a different DPI: rebuild fonts at the new size
            g_scale_changed = false;
            ImGui_ImplDX11_InvalidateDeviceObjects();
            theme::setup(g_new_scale);
        }
        ImGui_ImplDX11_NewFrame();
        ImGui_ImplWin32_NewFrame();
        ImGui::NewFrame();
        LARGE_INTEGER now; QueryPerformanceCounter(&now);
        float dt = float(double(now.QuadPart - last.QuadPart) / double(freq.QuadPart));
        last = now;
        RECT rc; GetClientRect(hwnd, &rc);
        app.frame(std::min(dt, 0.1f), ImVec2(float(rc.right - rc.left), float(rc.bottom - rc.top)));
        ImGui::Render();
        const float clear[4] = {0.035f, 0.035f, 0.043f, 1.0f};
        g_ctx->OMSetRenderTargets(1, &g_rtv, nullptr);
        g_ctx->ClearRenderTargetView(g_rtv, clear);
        ImGui_ImplDX11_RenderDrawData(ImGui::GetDrawData());
        g_occluded = (g_swap->Present(1, 0) == DXGI_STATUS_OCCLUDED);       // vsync: no tearing, steady frame pacing
    }
    return 0;
}
