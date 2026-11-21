// Preview build: the same UI on GLFW + OpenGL 3, used to look at the interface and take screenshots while
// developing. The real app is main_win32.cpp.
#include <GLFW/glfw3.h>
#include <imgui.h>
#include <backends/imgui_impl_glfw.h>
#include <backends/imgui_impl_opengl3.h>

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <vector>

#include "app.h"
#include "theme.h"

int main(int argc, char** argv) {
    int page = 0, shot_frames = -1, session = -1, w = 1240, h = 800;
    const char* shot = nullptr;
    bool popup_pad = false;
    for (int i = 1; i < argc; i++) {
        if (!std::strcmp(argv[i], "--page") && i + 1 < argc) page = std::atoi(argv[++i]);
        else if (!std::strcmp(argv[i], "--shot") && i + 1 < argc) shot = argv[++i];
        else if (!std::strcmp(argv[i], "--frames") && i + 1 < argc) shot_frames = std::atoi(argv[++i]);
        else if (!std::strcmp(argv[i], "--session") && i + 1 < argc) session = std::atoi(argv[++i]);
        else if (!std::strcmp(argv[i], "--size") && i + 2 < argc) { w = std::atoi(argv[++i]); h = std::atoi(argv[++i]); }
        else if (!std::strcmp(argv[i], "--editpad")) popup_pad = true;
    }
    if (!glfwInit()) return 1;
    glfwWindowHint(GLFW_CONTEXT_VERSION_MAJOR, 3);
    glfwWindowHint(GLFW_CONTEXT_VERSION_MINOR, 0);
    GLFWwindow* win = glfwCreateWindow(w, h, "PodStudio", nullptr, nullptr);
    if (!win) { std::fprintf(stderr, "no window\n"); return 1; }
    glfwMakeContextCurrent(win);
    glfwSwapInterval(1);
    IMGUI_CHECKVERSION();
    ImGui::CreateContext();
    ImGui::GetIO().IniFilename = nullptr;
    ImGui_ImplGlfw_InitForOpenGL(win, true);
    ImGui_ImplOpenGL3_Init("#version 130");
    theme::setup(1.0f);
    ImGui::GetIO().Fonts->Build();

    ps::App app;
    app.init();
    app.debug_set_page(page);
    if (session >= 0) app.debug_select_session(session);

    int frame = 0;
    while (!glfwWindowShouldClose(win)) {
        glfwPollEvents();
        ImGui_ImplOpenGL3_NewFrame();
        ImGui_ImplGlfw_NewFrame();
        ImGui::NewFrame();
        int fw, fh; glfwGetFramebufferSize(win, &fw, &fh);
        app.frame(ImGui::GetIO().DeltaTime, ImVec2(float(fw), float(fh)));
        if (popup_pad && frame == 5) { ImGui::GetIO().AddKeyEvent(ImGuiKey_None, false); }
        ImGui::Render();
        glViewport(0, 0, fw, fh);
        glClearColor(0.035f, 0.035f, 0.043f, 1.f);
        glClear(GL_COLOR_BUFFER_BIT);
        ImGui_ImplOpenGL3_RenderDrawData(ImGui::GetDrawData());
        if (shot && frame == shot_frames) {
            std::vector<unsigned char> px(size_t(fw) * fh * 3);
            glPixelStorei(GL_PACK_ALIGNMENT, 1);
            glReadPixels(0, 0, fw, fh, GL_RGB, GL_UNSIGNED_BYTE, px.data());
            FILE* f = std::fopen(shot, "wb");
            std::fprintf(f, "P6\n%d %d\n255\n", fw, fh);
            for (int y = fh - 1; y >= 0; y--) std::fwrite(&px[size_t(y) * fw * 3], 1, size_t(fw) * 3, f);
            std::fclose(f);
            break;
        }
        glfwSwapBuffers(win);
        frame++;
    }
    return 0;
}
