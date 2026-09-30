// Réglages graphiques Intel (Arc, Iris Xe) de KaneMode : limite d'images par seconde, mode faible
// latence, filtre de netteté, et mesures du GPU (charge, température, puissance, fréquence).
//
// Passe par l'Intel Graphics Control Library (IGCL) : ControlLib.dll, installée avec le pilote
// graphique Intel, chargée par le code d'accès fourni par Intel (cApiWrapper.cpp). Réglages du profil
// global (nom d'application vide), comme « Global » dans Intel Graphics Software. Seules les
// fonctions annoncées par le pilote (ctlGetSupported3DCapabilities) sont proposées. Intel ne donne
// pas les images par seconde d'un jeu : pas de compteur.
#include "Tool.h"
#include "igcl_api.h"

#include <vector>

using namespace tool;

namespace
{
    ctl_api_handle_t g_api = nullptr;
    ctl_device_adapter_handle_t g_dev = nullptr;
    std::string g_gpuName;
    char g_global[1] = ""; // nom d'application vide : réglages globaux

    struct Feature { bool supported = false; ctl_property_value_type_t type = CTL_PROPERTY_VALUE_TYPE_BOOL; ctl_property_info_t info = {}; };
    Feature g_frameLimit, g_lowLatency, g_sharpen;

    void Check(ctl_result_t r, char const* what)
    {
        if (r != CTL_RESULT_SUCCESS) {
            char b[160];
            snprintf(b, sizeof b, "Le pilote Intel a refusé : %s (code 0x%X)", what, (unsigned)r);
            throw std::runtime_error(b);
        }
    }

    ctl_3d_feature_getset_t Request(ctl_3d_feature_t type, Feature const& f, bool set)
    {
        ctl_3d_feature_getset_t g = {};
        g.Size = sizeof g;
        g.Version = 0;
        g.FeatureType = type;
        g.ApplicationName = g_global;
        g.ApplicationNameLength = 0;
        g.bSet = set;
        g.ValueType = f.type;
        return g;
    }
    bool Get(ctl_3d_feature_t type, Feature const& f, ctl_property_t& out)
    {
        if (!f.supported) return false;
        auto g = Request(type, f, false);
        if (ctlGetSet3DFeature(g_dev, &g) != CTL_RESULT_SUCCESS) return false;
        out = g.Value;
        return true;
    }
    void Put(ctl_3d_feature_t type, Feature const& f, ctl_property_t const& value, char const* what)
    {
        auto g = Request(type, f, true);
        g.Value = value;
        Check(ctlGetSet3DFeature(g_dev, &g), what);
    }

    /** Fonctions 3D annoncées par le pilote (type de valeur et bornes). */
    void ReadCaps()
    {
        ctl_3d_feature_caps_t caps = {};
        caps.Size = sizeof caps;
        if (ctlGetSupported3DCapabilities(g_dev, &caps) != CTL_RESULT_SUCCESS || caps.NumSupportedFeatures == 0) return;
        std::vector<ctl_3d_feature_details_t> list(caps.NumSupportedFeatures);
        caps.pFeatureDetails = list.data();
        if (ctlGetSupported3DCapabilities(g_dev, &caps) != CTL_RESULT_SUCCESS) return;
        for (auto const& d : list) {
            Feature* f = d.FeatureType == CTL_3D_FEATURE_FRAME_LIMIT ? &g_frameLimit
                : d.FeatureType == CTL_3D_FEATURE_LOW_LATENCY ? &g_lowLatency
                : d.FeatureType == CTL_3D_FEATURE_SHARPENING_FILTER ? &g_sharpen : nullptr;
            // Types de valeur pris en charge ici (pas de structure propre au fabricant)
            if (!f || (d.ValueType != CTL_PROPERTY_VALUE_TYPE_INT32 && d.ValueType != CTL_PROPERTY_VALUE_TYPE_ENUM && d.ValueType != CTL_PROPERTY_VALUE_TYPE_BOOL)) continue;
            f->supported = true;
            f->type = d.ValueType;
            f->info = d.Value;
        }
    }

    /** Activé ? (et valeur entière pour un réglage de type entier) */
    bool IsOn(Feature const& f, ctl_property_t const& v, int* value = nullptr)
    {
        if (f.type == CTL_PROPERTY_VALUE_TYPE_INT32) { if (value) *value = v.IntType.Value; return v.IntType.Enable; }
        if (f.type == CTL_PROPERTY_VALUE_TYPE_ENUM) return v.EnumType.EnableType != 0;
        return v.BoolType.Enable;
    }
    ctl_property_t Make(Feature const& f, bool on, int value)
    {
        ctl_property_t v = {};
        if (f.type == CTL_PROPERTY_VALUE_TYPE_INT32) { v.IntType.Enable = on; v.IntType.Value = value; }
        else if (f.type == CTL_PROPERTY_VALUE_TYPE_ENUM) v.EnumType.EnableType = on ? (value > 0 ? (uint32_t)value : 1u) : 0u;
        else v.BoolType.Enable = on;
        return v;
    }

    // ------------------------------------------------------------------ mesures
    double Val(ctl_oc_telemetry_item_t const& i)
    {
        if (!i.bSupported) return -1;
        switch (i.type) {
            case CTL_DATA_TYPE_INT8: return i.value.data8;
            case CTL_DATA_TYPE_UINT8: return i.value.datau8;
            case CTL_DATA_TYPE_INT16: return i.value.data16;
            case CTL_DATA_TYPE_UINT16: return i.value.datau16;
            case CTL_DATA_TYPE_INT32: return i.value.data32;
            case CTL_DATA_TYPE_UINT32: return i.value.datau32;
            case CTL_DATA_TYPE_INT64: return (double)i.value.data64;
            case CTL_DATA_TYPE_UINT64: return (double)i.value.datau64;
            case CTL_DATA_TYPE_FLOAT: return i.value.datafloat;
            case CTL_DATA_TYPE_DOUBLE: return i.value.datadouble;
            default: return -1;
        }
    }
    // Charge et puissance : compteurs qui avancent, comparés à la mesure précédente
    struct Sample { double t = -1, energy = -1, activity = -1; ULONGLONG at = 0; } g_prev;
    bool Telemetry(ctl_power_telemetry_t& p)
    {
        p = {};
        p.Size = sizeof p;
        p.Version = 0;
        return ctlPowerTelemetryGet(g_dev, &p) == CTL_RESULT_SUCCESS;
    }
}

bool tool::Init(std::string& reason)
{
    ctl_init_args_t args = {};
    args.Size = sizeof args;
    args.Version = 0;
    args.AppVersion = CTL_MAKE_VERSION(CTL_IMPL_MAJOR_VERSION, CTL_IMPL_MINOR_VERSION);
    // Level Zero : nécessaire aux mesures ; sans lui (ancien pilote), les réglages restent possibles
    args.flags = CTL_INIT_FLAG_USE_LEVEL_ZERO;
    if (ctlInit(&args, &g_api) != CTL_RESULT_SUCCESS) {
        args.flags = 0;
        if (ctlInit(&args, &g_api) != CTL_RESULT_SUCCESS) { g_api = nullptr; reason = "Pas de pilote graphique Intel"; return false; }
    }
    uint32_t count = 0;
    if (ctlEnumerateDevices(g_api, &count, nullptr) != CTL_RESULT_SUCCESS || count == 0) { reason = "Pas de GPU Intel"; return false; }
    std::vector<ctl_device_adapter_handle_t> devices(count);
    if (ctlEnumerateDevices(g_api, &count, devices.data()) != CTL_RESULT_SUCCESS) { reason = "GPU Intel illisible"; return false; }
    // Carte séparée (Arc) de préférence, sinon le GPU intégré
    bool discrete = false;
    for (auto h : devices) {
        LUID id = {};
        ctl_device_adapter_properties_t p = {};
        p.Size = sizeof p;
        p.Version = 2;
        p.pDeviceID = &id;
        p.device_id_size = sizeof id;
        if (ctlGetDeviceProperties(h, &p) != CTL_RESULT_SUCCESS || p.device_type != CTL_DEVICE_TYPE_GRAPHICS) continue;
        bool integrated = (p.graphics_adapter_properties & CTL_ADAPTER_PROPERTIES_FLAG_INTEGRATED) != 0;
        if (g_dev && (discrete || integrated)) continue;
        g_dev = h;
        discrete = !integrated;
        g_gpuName = p.name;
    }
    if (!g_dev) { reason = "Pas de GPU Intel"; return false; }
    ReadCaps();
    return true;
}

std::string tool::State()
{
    std::ostringstream o;
    o << "{\"available\":true,\"vendor\":\"intel\",\"gpu\":" << Quote(g_gpuName);
    ctl_property_t v = {};
    int value = 0;
    // Limite d'images (réglage entier : activée + valeur)
    if (g_frameLimit.supported && g_frameLimit.type == CTL_PROPERTY_VALUE_TYPE_INT32 && Get(CTL_3D_FEATURE_FRAME_LIMIT, g_frameLimit, v)) {
        bool on = IsOn(g_frameLimit, v, &value);
        auto const& r = g_frameLimit.info.IntType.RangeInfo;
        o << ",\"fps\":{\"via\":\"igcl\",\"on\":" << Bool(on && value > 0) << ",\"value\":" << value << ",\"min\":" << r.min_possible_value << ",\"max\":" << r.max_possible_value << "}";
    } else o << ",\"fps\":null";
    if (Get(CTL_3D_FEATURE_LOW_LATENCY, g_lowLatency, v)) {
        bool boost = g_lowLatency.type == CTL_PROPERTY_VALUE_TYPE_ENUM && v.EnumType.EnableType == CTL_3D_LOW_LATENCY_TYPES_TURN_ON_BOOST_MODE_ON;
        o << ",\"antilag\":{\"on\":" << Bool(IsOn(g_lowLatency, v)) << ",\"boost\":" << Bool(boost) << "}";
    } else o << ",\"antilag\":null";
    if (Get(CTL_3D_FEATURE_SHARPENING_FILTER, g_sharpen, v)) {
        bool on = IsOn(g_sharpen, v, &value);
        o << ",\"ris\":{\"on\":" << Bool(on);
        // Netteté réglable seulement si le pilote la donne en valeur entière
        if (g_sharpen.type == CTL_PROPERTY_VALUE_TYPE_INT32) {
            auto const& r = g_sharpen.info.IntType.RangeInfo;
            o << ",\"sharpness\":" << value << ",\"min\":" << r.min_possible_value << ",\"max\":" << r.max_possible_value;
        }
        o << "}";
    } else o << ",\"ris\":null";
    o << ",\"rsr\":null,\"afmf\":null}";
    return o.str();
}

std::string tool::Live()
{
    ctl_power_telemetry_t p;
    bool ok = Telemetry(p);
    // Première mesure (ou trop ancienne) : une seconde, 200 ms plus tard, pour la charge et la puissance
    if (ok && (g_prev.at == 0 || GetTickCount64() - g_prev.at > 5000)) {
        g_prev = { Val(p.timeStamp), Val(p.gpuEnergyCounter), Val(p.globalActivityCounter), GetTickCount64() };
        Sleep(200);
        ok = Telemetry(p);
    }
    double usage = -1, power = -1, temp = -1, clock = -1;
    if (ok) {
        Sample now = { Val(p.timeStamp), Val(p.gpuEnergyCounter), Val(p.globalActivityCounter), GetTickCount64() };
        double dt = now.t >= 0 && g_prev.t >= 0 ? now.t - g_prev.t : -1;
        if (dt > 0 && now.activity >= 0 && g_prev.activity >= 0) usage = Clamp((int)(100 * (now.activity - g_prev.activity) / dt + 0.5), 0, 100);
        if (dt > 0 && now.energy >= 0 && g_prev.energy >= 0 && now.energy >= g_prev.energy) power = (now.energy - g_prev.energy) / dt;
        temp = Val(p.gpuCurrentTemperature);
        clock = Val(p.gpuCurrentClockFrequency);
        g_prev = now;
    }
    std::ostringstream o;
    o << "{\"fps\":null";
    Num(o, "gpuUsage", usage, 0);
    Num(o, "gpuTemp", temp, 0);
    Num(o, "gpuPower", power, 1);
    Num(o, "gpuClock", clock, 0);
    o << "}";
    return o.str();
}

void tool::Set(std::string const& what, int value)
{
    if (what == "fps") {
        if (!g_frameLimit.supported || g_frameLimit.type != CTL_PROPERTY_VALUE_TYPE_INT32) throw std::runtime_error("Limite d'images non prise en charge par ce pilote Intel");
        auto const& r = g_frameLimit.info.IntType.RangeInfo;
        int v = value > 0 ? Clamp(value, r.min_possible_value, r.max_possible_value) : 0;
        Put(CTL_3D_FEATURE_FRAME_LIMIT, g_frameLimit, Make(g_frameLimit, v > 0, v > 0 ? v : r.default_value), "limite d'images par seconde");
    } else if (what == "antilag") {
        if (!g_lowLatency.supported) throw std::runtime_error("Mode faible latence non pris en charge par ce pilote Intel");
        Put(CTL_3D_FEATURE_LOW_LATENCY, g_lowLatency, Make(g_lowLatency, value != 0, CTL_3D_LOW_LATENCY_TYPES_TURN_ON), "mode faible latence");
    } else if (what == "ris" || what == "rissharp") {
        if (!g_sharpen.supported) throw std::runtime_error("Filtre de netteté non pris en charge par ce pilote Intel");
        ctl_property_t cur = {};
        int level = 0;
        bool on = Get(CTL_3D_FEATURE_SHARPENING_FILTER, g_sharpen, cur) && IsOn(g_sharpen, cur, &level);
        if (g_sharpen.type == CTL_PROPERTY_VALUE_TYPE_INT32) {
            auto const& r = g_sharpen.info.IntType.RangeInfo;
            if (what == "rissharp") level = Clamp(value, r.min_possible_value, r.max_possible_value);
            else on = value != 0;
            if (level <= 0) level = r.default_value;
        } else {
            if (what == "rissharp") throw std::runtime_error("Netteté non réglable sur ce pilote Intel");
            on = value != 0;
        }
        Put(CTL_3D_FEATURE_SHARPENING_FILTER, g_sharpen, Make(g_sharpen, on, level), "filtre de netteté");
    } else {
        throw std::runtime_error("Fonction Intel inconnue : " + what);
    }
}

void tool::Close()
{
    if (g_api) ctlClose(g_api);
    g_api = nullptr;
}

int main() { return tool::Run(); }
