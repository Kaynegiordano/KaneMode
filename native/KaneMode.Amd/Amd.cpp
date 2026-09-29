// Réglages graphiques AMD (Radeon) de KaneMode : limite d'images par seconde, Radeon Super
// Resolution (RSR), AMD Fluid Motion Frames (AFMF), Radeon Anti-Lag, Radeon Image Sharpening, et
// mesures en direct (images par seconde du jeu, charge, température et puissance du GPU).
//
// Petit programme sans fenêtre lancé par l'hôte (host/lib/amd.js). Il reste ouvert et lit une
// commande par ligne sur son entrée :
//   state                    état de toutes les fonctions
//   live                     mesures en direct
//   set <fonction> <valeur>  règle une fonction puis renvoie l'état complet
// Chaque réponse est une ligne JSON : {"ok":true,"data":...} ou {"ok":false,"error":"..."}.
//
// Il passe par ADLX, la bibliothèque du pilote AMD (amdadlx64.dll, installée avec le pilote). Sans
// GPU AMD, « state » répond {"available":false,"reason":"..."}.
#include "SDK/ADLXHelper/Windows/Cpp/ADLXHelper.h"
#include "SDK/Include/I3DSettings1.h"
#include "SDK/Include/IPerformanceMonitoring.h"

#include <windows.h>
#include <cstdio>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <string>

using namespace adlx;

namespace
{
    ADLXHelper g_adlx;
    IADLXGPUPtr g_gpu;
    IADLX3DSettingsServicesPtr g_3d;
    IADLXPerformanceMonitoringServicesPtr g_perf;
    std::string g_gpuName;
    std::string g_reason;

    std::string Quote(std::string const& s)
    {
        std::string o = "\"";
        for (char c : s) {
            if (c == '"' || c == '\\') { o += '\\'; o += c; }
            else if ((unsigned char)c < 0x20) o += ' ';
            else o += c;
        }
        return o + "\"";
    }
    const char* Bool(adlx_bool b) { return b ? "true" : "false"; }

    bool Init()
    {
        ADLX_RESULT r = g_adlx.Initialize();
        // Pilote plus ancien que le SDK : les fonctions présentes restent utilisables
        if (ADLX_FAILED(r)) r = g_adlx.InitializeWithIncompatibleDriver();
        if (ADLX_FAILED(r)) { g_reason = "Pas de pilote AMD Radeon"; return false; }
        IADLXGPUListPtr gpus;
        if (ADLX_FAILED(g_adlx.GetSystemServices()->GetGPUs(&gpus)) || gpus == nullptr || gpus->Empty()) { g_reason = "Pas de GPU AMD"; return false; }
        if (ADLX_FAILED(gpus->At(gpus->Begin(), &g_gpu)) || g_gpu == nullptr) { g_reason = "GPU AMD illisible"; return false; }
        const char* name = nullptr;
        if (ADLX_SUCCEEDED(g_gpu->Name(&name)) && name) g_gpuName = name;
        if (ADLX_FAILED(g_adlx.GetSystemServices()->Get3DSettingsServices(&g_3d)) || g_3d == nullptr) { g_reason = "Réglages 3D AMD indisponibles"; return false; }
        g_adlx.GetSystemServices()->GetPerformanceMonitoringServices(&g_perf);
        return true;
    }

    // ------------------------------------------------------------------ accès aux fonctions
    IADLX3DChillPtr Chill() { IADLX3DChillPtr p; g_3d->GetChill(g_gpu, &p); adlx_bool s = false; return p && ADLX_SUCCEEDED(p->IsSupported(&s)) && s ? p : nullptr; }
    IADLX3DFrameRateTargetControlPtr Frtc() { IADLX3DFrameRateTargetControlPtr p; g_3d->GetFrameRateTargetControl(g_gpu, &p); adlx_bool s = false; return p && ADLX_SUCCEEDED(p->IsSupported(&s)) && s ? p : nullptr; }
    IADLX3DRadeonSuperResolutionPtr Rsr() { IADLX3DRadeonSuperResolutionPtr p; g_3d->GetRadeonSuperResolution(&p); adlx_bool s = false; return p && ADLX_SUCCEEDED(p->IsSupported(&s)) && s ? p : nullptr; }
    IADLX3DAntiLagPtr AntiLag() { IADLX3DAntiLagPtr p; g_3d->GetAntiLag(g_gpu, &p); adlx_bool s = false; return p && ADLX_SUCCEEDED(p->IsSupported(&s)) && s ? p : nullptr; }
    IADLX3DImageSharpeningPtr Ris() { IADLX3DImageSharpeningPtr p; g_3d->GetImageSharpening(g_gpu, &p); adlx_bool s = false; return p && ADLX_SUCCEEDED(p->IsSupported(&s)) && s ? p : nullptr; }
    IADLX3DAMDFluidMotionFramesPtr Afmf()
    {
        IADLX3DSettingsServices1Ptr s1(g_3d);
        if (s1 == nullptr) return nullptr;
        IADLX3DAMDFluidMotionFramesPtr p;
        s1->GetAMDFluidMotionFrames(&p);
        adlx_bool s = false;
        return p && ADLX_SUCCEEDED(p->IsSupported(&s)) && s ? p : nullptr;
    }

    // ------------------------------------------------------------------ état
    // Limite d'images par seconde : Radeon Chill avec le minimum égal au maximum (DirectX 9 à 12 et
    // Vulkan), sinon Frame Rate Target Control (plus ancien, surtout DirectX 9 à 11)
    std::string FpsState()
    {
        if (auto c = Chill()) {
            adlx_bool on = false; adlx_int mn = 0, mx = 0; ADLX_IntRange r{};
            c->IsEnabled(&on); c->GetMinFPS(&mn); c->GetMaxFPS(&mx); c->GetFPSRange(&r);
            std::ostringstream o;
            o << "{\"via\":\"chill\",\"on\":" << Bool(on) << ",\"value\":" << mx << ",\"low\":" << mn << ",\"min\":" << r.minValue << ",\"max\":" << r.maxValue << "}";
            return o.str();
        }
        if (auto f = Frtc()) {
            adlx_bool on = false; adlx_int v = 0; ADLX_IntRange r{};
            f->IsEnabled(&on); f->GetFPS(&v); f->GetFPSRange(&r);
            std::ostringstream o;
            o << "{\"via\":\"frtc\",\"on\":" << Bool(on) << ",\"value\":" << v << ",\"min\":" << r.minValue << ",\"max\":" << r.maxValue << "}";
            return o.str();
        }
        return "null";
    }
    std::string SharpState(bool on, adlx_int v, ADLX_IntRange r)
    {
        std::ostringstream o;
        o << "{\"on\":" << Bool(on) << ",\"sharpness\":" << v << ",\"min\":" << r.minValue << ",\"max\":" << r.maxValue << "}";
        return o.str();
    }
    std::string State()
    {
        std::ostringstream o;
        o << "{\"available\":true,\"gpu\":" << Quote(g_gpuName) << ",\"fps\":" << FpsState();
        if (auto p = Rsr()) { adlx_bool on = false; adlx_int v = 0; ADLX_IntRange r{}; p->IsEnabled(&on); p->GetSharpness(&v); p->GetSharpnessRange(&r); o << ",\"rsr\":" << SharpState(on, v, r); }
        else o << ",\"rsr\":null";
        if (auto p = Afmf()) { adlx_bool on = false; p->IsEnabled(&on); o << ",\"afmf\":{\"on\":" << Bool(on) << "}"; }
        else o << ",\"afmf\":null";
        if (auto p = AntiLag()) { adlx_bool on = false; p->IsEnabled(&on); o << ",\"antilag\":{\"on\":" << Bool(on) << "}"; }
        else o << ",\"antilag\":null";
        if (auto p = Ris()) { adlx_bool on = false; adlx_int v = 0; ADLX_IntRange r{}; p->IsEnabled(&on); p->GetSharpness(&v); p->GetSharpnessRange(&r); o << ",\"ris\":" << SharpState(on, v, r); }
        else o << ",\"ris\":null";
        o << "}";
        return o.str();
    }

    std::string Live()
    {
        std::ostringstream o;
        o << "{";
        adlx_int fps = -1;
        if (g_perf) {
            IADLXFPSPtr f;
            // Sans jeu 3D au premier plan, le pilote ne donne pas d'images par seconde
            if (ADLX_SUCCEEDED(g_perf->GetCurrentFPS(&f)) && f) f->FPS(&fps);
        }
        o << "\"fps\":";
        if (fps >= 0) o << fps; else o << "null";
        adlx_double usage = -1, temp = -1, power = -1; adlx_int clock = -1;
        if (g_perf) {
            IADLXGPUMetricsPtr m;
            if (ADLX_SUCCEEDED(g_perf->GetCurrentGPUMetrics(g_gpu, &m)) && m) {
                if (ADLX_FAILED(m->GPUUsage(&usage))) usage = -1;
                if (ADLX_FAILED(m->GPUTemperature(&temp))) temp = -1;
                if (ADLX_FAILED(m->GPUPower(&power))) power = -1;
                if (ADLX_FAILED(m->GPUClockSpeed(&clock))) clock = -1;
            }
        }
        auto num = [&](char const* k, double v, int digits) {
            o << ",\"" << k << "\":";
            if (v < 0) { o << "null"; return; }
            char b[32]; snprintf(b, sizeof b, "%.*f", digits, v); o << b;
        };
        num("gpuUsage", usage, 0);
        num("gpuTemp", temp, 0);
        num("gpuPower", power, 1);
        num("gpuClock", clock, 0);
        o << "}";
        return o.str();
    }

    // ------------------------------------------------------------------ réglages
    void Check(ADLX_RESULT r, char const* what)
    {
        if (ADLX_FAILED(r)) {
            char b[160];
            snprintf(b, sizeof b, "Le pilote AMD a refusé : %s (code %d)", what, (int)r);
            throw std::runtime_error(b);
        }
    }
    int Clamp(int v, ADLX_IntRange r) { return r.maxValue > r.minValue ? (v < r.minValue ? r.minValue : v > r.maxValue ? r.maxValue : v) : v; }

    void SetFps(int value)
    {
        auto c = Chill();
        auto f = Frtc();
        if (!c && !f) throw std::runtime_error("Limite d'images par seconde non prise en charge par ce pilote AMD");
        if (value <= 0) {
            // Aucune limite : les deux mécanismes coupés (l'un a pu être réglé dans AMD Software)
            if (c) Check(c->SetEnabled(false), "Radeon Chill");
            if (f) { adlx_bool on = false; f->IsEnabled(&on); if (on) Check(f->SetEnabled(false), "Frame Rate Target Control"); }
            return;
        }
        if (c) {
            ADLX_IntRange r{}; c->GetFPSRange(&r);
            int v = Clamp(value, r);
            // Minimum au plus bas, puis maximum, puis minimum égal au maximum : l'ordre évite un
            // minimum plus grand que le maximum à un moment donné
            c->SetMinFPS(r.minValue);
            Check(c->SetMaxFPS(v), "limite d'images par seconde");
            c->SetMinFPS(v); // refusé par certains pilotes : la limite haute suffit
            Check(c->SetEnabled(true), "Radeon Chill");
            if (f) { adlx_bool on = false; f->IsEnabled(&on); if (on) f->SetEnabled(false); }
            return;
        }
        ADLX_IntRange r{}; f->GetFPSRange(&r);
        Check(f->SetFPS(Clamp(value, r)), "limite d'images par seconde");
        Check(f->SetEnabled(true), "Frame Rate Target Control");
    }

    void Set(std::string const& what, int value)
    {
        if (what == "fps") return SetFps(value);
        if (what == "rsr" || what == "rsrsharp") {
            auto p = Rsr();
            if (!p) throw std::runtime_error("Radeon Super Resolution non prise en charge");
            if (what == "rsr") return Check(p->SetEnabled(value != 0), "Radeon Super Resolution");
            ADLX_IntRange r{}; p->GetSharpnessRange(&r);
            return Check(p->SetSharpness(Clamp(value, r)), "netteté RSR");
        }
        if (what == "afmf") {
            auto p = Afmf();
            if (!p) throw std::runtime_error("AMD Fluid Motion Frames non pris en charge");
            return Check(p->SetEnabled(value != 0), "AMD Fluid Motion Frames");
        }
        if (what == "antilag") {
            auto p = AntiLag();
            if (!p) throw std::runtime_error("Radeon Anti-Lag non pris en charge");
            return Check(p->SetEnabled(value != 0), "Radeon Anti-Lag");
        }
        if (what == "ris" || what == "rissharp") {
            auto p = Ris();
            if (!p) throw std::runtime_error("Radeon Image Sharpening non pris en charge");
            if (what == "ris") return Check(p->SetEnabled(value != 0), "Radeon Image Sharpening");
            ADLX_IntRange r{}; p->GetSharpnessRange(&r);
            return Check(p->SetSharpness(Clamp(value, r)), "netteté");
        }
        throw std::runtime_error("Fonction AMD inconnue : " + what);
    }

    std::string Handle(std::string const& line, bool ready)
    {
        std::istringstream in(line);
        std::string cmd;
        in >> cmd;
        if (cmd == "state" && !ready) return "{\"available\":false,\"reason\":" + Quote(g_reason) + "}";
        if (!ready) throw std::runtime_error(g_reason);
        if (cmd == "state") return State();
        if (cmd == "live") return Live();
        if (cmd == "set") {
            std::string what; int value = 0;
            if (!(in >> what >> value)) throw std::runtime_error("Commande incomplète");
            Set(what, value);
            return State();
        }
        throw std::runtime_error("Commande inconnue : " + cmd);
    }
}

int main()
{
    // Sortie en UTF-8, une ligne par réponse, envoyée tout de suite
    SetConsoleOutputCP(CP_UTF8);
    std::ios::sync_with_stdio(false);
    bool ready = Init();
    std::cout << "{\"ready\":true}" << std::endl;
    std::string line;
    while (std::getline(std::cin, line)) {
        if (!line.empty() && line.back() == '\r') line.pop_back();
        if (line.empty()) continue;
        std::string reply;
        try { reply = "{\"ok\":true,\"data\":" + Handle(line, ready) + "}"; }
        catch (std::exception const& e) { reply = "{\"ok\":false,\"error\":" + Quote(e.what()) + "}"; }
        std::cout << reply << std::endl;
    }
    // Objets ADLX relâchés avant la fermeture de la bibliothèque
    g_perf = nullptr; g_3d = nullptr; g_gpu = nullptr;
    g_adlx.Terminate();
    return 0;
}
