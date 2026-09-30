// Réglages graphiques NVIDIA (GeForce, RTX) de KaneMode : limite d'images par seconde (« Max Frame
// Rate » du panneau NVIDIA), mode faible latence, synchronisation verticale, et mesures du GPU.
//
// Réglages : NVAPI (SDK public de NVIDIA, licence MIT), profil global des pilotes (« Driver
// Settings », le même que « Paramètres globaux » du panneau de configuration NVIDIA et de la NVIDIA
// App). Seuls des réglages documentés par NVIDIA (NvApiDriverSettings.h) sont utilisés.
// Mesures : NVML (nvml.dll, installé avec le pilote), chargé à l'exécution. NVIDIA ne donne pas les
// images par seconde d'un jeu : pas de compteur.
#include "Tool.h"
#include "nvapi.h"
#include "NvApiDriverSettings.h"

using namespace tool;

namespace
{
    std::string g_gpuName;

    void Check(NvAPI_Status s, char const* what)
    {
        if (s != NVAPI_OK) {
            NvAPI_ShortString msg = {};
            NvAPI_GetErrorMessage(s, msg);
            char b[256];
            snprintf(b, sizeof b, "Le pilote NVIDIA a refusé : %s (%s)", what, msg);
            throw std::runtime_error(b);
        }
    }

    // ------------------------------------------------------------------ profil global (DRS)
    // Une session par opération : les réglages changés entre-temps dans la NVIDIA App sont relus
    struct Drs
    {
        NvDRSSessionHandle session = nullptr;
        NvDRSProfileHandle profile = nullptr;
        Drs()
        {
            Check(NvAPI_DRS_CreateSession(&session), "ouverture des réglages");
            NvAPI_Status s = NvAPI_DRS_LoadSettings(session);
            if (s == NVAPI_OK) s = NvAPI_DRS_GetCurrentGlobalProfile(session, &profile);
            if (s != NVAPI_OK) { NvAPI_DRS_DestroySession(session); session = nullptr; Check(s, "lecture des réglages"); }
        }
        ~Drs() { if (session) NvAPI_DRS_DestroySession(session); }
        Drs(Drs const&) = delete;
        Drs& operator=(Drs const&) = delete;

        /** Valeur d'un réglage du profil global, ou `fallback` s'il n'y est pas (valeur par défaut). */
        NvU32 Get(NvU32 id, NvU32 fallback)
        {
            NVDRS_SETTING s = {};
            s.version = NVDRS_SETTING_VER;
            return NvAPI_DRS_GetSetting(session, profile, id, &s) == NVAPI_OK ? s.u32CurrentValue : fallback;
        }
        void Put(NvU32 id, NvU32 value, char const* what)
        {
            NVDRS_SETTING s = {};
            s.version = NVDRS_SETTING_VER;
            s.settingId = id;
            s.settingType = NVDRS_DWORD_TYPE;
            s.u32CurrentValue = value;
            Check(NvAPI_DRS_SetSetting(session, profile, &s), what);
        }
        /** Réglage rendu à sa valeur par défaut (ne rien laisser derrière soi). */
        void Reset(NvU32 id, char const* what)
        {
            NvAPI_Status s = NvAPI_DRS_RestoreProfileDefaultSetting(session, profile, id);
            if (s != NVAPI_SETTING_NOT_FOUND) Check(s, what);
        }
        void Save() { Check(NvAPI_DRS_SaveSettings(session), "enregistrement des réglages"); }
    };

    // Limite d'images : 20 à 1000 i/s dans le panneau NVIDIA
    constexpr int FPS_MIN = 20, FPS_MAX = 1000;

    // ------------------------------------------------------------------ mesures (NVML)
    typedef int nvmlReturn;
    typedef void* nvmlDevice;
    struct nvmlUtilization { unsigned int gpu, memory; };
    struct Nvml
    {
        HMODULE dll = nullptr;
        nvmlDevice device = nullptr;
        nvmlReturn (*Init)() = nullptr;
        nvmlReturn (*Shutdown)() = nullptr;
        nvmlReturn (*ByIndex)(unsigned int, nvmlDevice*) = nullptr;
        nvmlReturn (*Utilization)(nvmlDevice, nvmlUtilization*) = nullptr;
        nvmlReturn (*Temperature)(nvmlDevice, int, unsigned int*) = nullptr;
        nvmlReturn (*Power)(nvmlDevice, unsigned int*) = nullptr;
        nvmlReturn (*Clock)(nvmlDevice, int, unsigned int*) = nullptr;

        template <class F> bool Load(F& f, char const* name) { f = reinterpret_cast<F>(GetProcAddress(dll, name)); return f != nullptr; }
        void Open()
        {
            // Pilotes actuels : System32 ; anciens : dossier NVSMI
            dll = LoadLibraryExW(L"nvml.dll", nullptr, LOAD_LIBRARY_SEARCH_SYSTEM32);
            if (!dll) dll = LoadLibraryExW(L"C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvml.dll", nullptr, LOAD_WITH_ALTERED_SEARCH_PATH);
            if (!dll) return;
            if (!Load(Init, "nvmlInit_v2") || !Load(Shutdown, "nvmlShutdown") || !Load(ByIndex, "nvmlDeviceGetHandleByIndex_v2")) { FreeLibrary(dll); dll = nullptr; return; }
            Load(Utilization, "nvmlDeviceGetUtilizationRates");
            Load(Temperature, "nvmlDeviceGetTemperature");
            Load(Power, "nvmlDeviceGetPowerUsage");
            Load(Clock, "nvmlDeviceGetClockInfo");
            if (Init() != 0 || ByIndex(0, &device) != 0) { device = nullptr; }
        }
        void Close()
        {
            if (dll) { if (Shutdown) Shutdown(); FreeLibrary(dll); dll = nullptr; }
        }
    } g_nvml;
}

bool tool::Init(std::string& reason)
{
    if (NvAPI_Initialize() != NVAPI_OK) { reason = "Pas de pilote NVIDIA"; return false; }
    NvPhysicalGpuHandle gpus[NVAPI_MAX_PHYSICAL_GPUS] = {};
    NvU32 count = 0;
    if (NvAPI_EnumPhysicalGPUs(gpus, &count) != NVAPI_OK || count == 0) { reason = "Pas de GPU NVIDIA"; return false; }
    NvAPI_ShortString name = {};
    if (NvAPI_GPU_GetFullName(gpus[0], name) == NVAPI_OK) g_gpuName = name;
    if (g_gpuName.rfind("NVIDIA ", 0) != 0 && !g_gpuName.empty()) g_gpuName = "NVIDIA " + g_gpuName;
    g_nvml.Open();
    return true;
}

std::string tool::State()
{
    Drs d;
    std::ostringstream o;
    o << "{\"available\":true,\"vendor\":\"nvidia\",\"gpu\":" << Quote(g_gpuName);
    // Limite d'images (0 : aucune)
    NvU32 frl = d.Get(FRL_FPS_ID, FRL_FPS_DISABLED);
    o << ",\"fps\":{\"via\":\"frl\",\"on\":" << Bool(frl != FRL_FPS_DISABLED) << ",\"value\":" << frl << ",\"min\":" << FPS_MIN << ",\"max\":" << FPS_MAX << "}";
    // Mode faible latence « Activé » : une seule image préparée d'avance (au lieu du choix du jeu)
    NvU32 pre = d.Get(PRERENDERLIMIT_ID, PRERENDERLIMIT_APP_CONTROLLED);
    o << ",\"antilag\":{\"on\":" << Bool(pre == 1) << "}";
    // Synchronisation verticale : 0 = choix du jeu, 1 = forcée, 2 = coupée, 3 = autre (panneau NVIDIA)
    NvU32 vs = d.Get(VSYNCMODE_ID, VSYNCMODE_PASSIVE);
    int v = vs == VSYNCMODE_PASSIVE ? 0 : vs == VSYNCMODE_FORCEON ? 1 : vs == VSYNCMODE_FORCEOFF ? 2 : 3;
    o << ",\"vsync\":{\"value\":" << v << "}";
    o << ",\"rsr\":null,\"afmf\":null,\"ris\":null}";
    return o.str();
}

std::string tool::Live()
{
    std::ostringstream o;
    o << "{\"fps\":null";
    double usage = -1, temp = -1, power = -1, clock = -1;
    if (g_nvml.device) {
        nvmlUtilization u = {};
        unsigned int x = 0;
        if (g_nvml.Utilization && g_nvml.Utilization(g_nvml.device, &u) == 0) usage = u.gpu;
        if (g_nvml.Temperature && g_nvml.Temperature(g_nvml.device, 0 /* NVML_TEMPERATURE_GPU */, &x) == 0) temp = x;
        if (g_nvml.Power && g_nvml.Power(g_nvml.device, &x) == 0) power = x / 1000.0; // milliwatts
        if (g_nvml.Clock && g_nvml.Clock(g_nvml.device, 0 /* NVML_CLOCK_GRAPHICS */, &x) == 0) clock = x;
    }
    Num(o, "gpuUsage", usage, 0);
    Num(o, "gpuTemp", temp, 0);
    Num(o, "gpuPower", power, 1);
    Num(o, "gpuClock", clock, 0);
    o << "}";
    return o.str();
}

void tool::Set(std::string const& what, int value)
{
    Drs d;
    if (what == "fps") {
        if (value <= 0) d.Reset(FRL_FPS_ID, "limite d'images par seconde");
        else d.Put(FRL_FPS_ID, (NvU32)Clamp(value, FPS_MIN, FPS_MAX), "limite d'images par seconde");
    } else if (what == "antilag") {
        if (value) d.Put(PRERENDERLIMIT_ID, 1, "mode faible latence");
        else d.Reset(PRERENDERLIMIT_ID, "mode faible latence");
    } else if (what == "vsync") {
        if (value == 1) d.Put(VSYNCMODE_ID, VSYNCMODE_FORCEON, "synchronisation verticale");
        else if (value == 2) d.Put(VSYNCMODE_ID, VSYNCMODE_FORCEOFF, "synchronisation verticale");
        else d.Reset(VSYNCMODE_ID, "synchronisation verticale");
    } else {
        throw std::runtime_error("Fonction NVIDIA inconnue : " + what);
    }
    d.Save();
}

void tool::Close()
{
    g_nvml.Close();
    NvAPI_Unload();
}

int main() { return tool::Run(); }
