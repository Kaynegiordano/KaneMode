// Base commune des outils graphiques de KaneMode (kanemode-nvidia.exe, kanemode-intel.exe), sur le
// modèle de kanemode-amd.exe (native/KaneMode.Amd) : programme sans fenêtre lancé par l'hôte
// (host/lib/gpuctl.js), qui reste ouvert et lit une commande par ligne sur son entrée :
//   state                    état de toutes les fonctions
//   live                     mesures en direct
//   set <fonction> <valeur>  règle une fonction puis renvoie l'état complet
// Chaque réponse est une ligne JSON : {"ok":true,"data":...} ou {"ok":false,"error":"..."}.
// Sans GPU du fabricant, « state » répond {"available":false,"reason":"..."}.
#pragma once
#include <windows.h>
#include <cstdio>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <string>

namespace tool
{
    inline std::string Quote(std::string const& s)
    {
        std::string o = "\"";
        for (char c : s) {
            if (c == '"' || c == '\\') { o += '\\'; o += c; }
            else if ((unsigned char)c < 0x20) o += ' ';
            else o += c;
        }
        return o + "\"";
    }
    inline const char* Bool(bool b) { return b ? "true" : "false"; }
    inline int Clamp(int v, int mn, int mx) { return mx > mn ? (v < mn ? mn : v > mx ? mx : v) : v; }

    /** Nombre JSON (null si négatif : mesure indisponible). */
    inline void Num(std::ostringstream& o, char const* key, double v, int digits)
    {
        o << ",\"" << key << "\":";
        if (v < 0) { o << "null"; return; }
        char b[32]; snprintf(b, sizeof b, "%.*f", digits, v); o << b;
    }

    // Fonctions de chaque outil
    bool Init(std::string& reason);
    std::string State();
    std::string Live();
    void Set(std::string const& what, int value);
    void Close();

    inline std::string Handle(std::string const& line, bool ready, std::string const& reason)
    {
        std::istringstream in(line);
        std::string cmd;
        in >> cmd;
        if (cmd == "state" && !ready) return "{\"available\":false,\"reason\":" + Quote(reason) + "}";
        if (!ready) throw std::runtime_error(reason);
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

    inline int Run()
    {
        // Sortie en UTF-8, une ligne par réponse, envoyée tout de suite
        SetConsoleOutputCP(CP_UTF8);
        std::ios::sync_with_stdio(false);
        std::string reason;
        bool ready = false;
        try { ready = Init(reason); }
        catch (std::exception const& e) { reason = e.what(); }
        std::cout << "{\"ready\":true}" << std::endl;
        std::string line;
        while (std::getline(std::cin, line)) {
            if (!line.empty() && line.back() == '\r') line.pop_back();
            if (line.empty()) continue;
            std::string reply;
            try { reply = "{\"ok\":true,\"data\":" + Handle(line, ready, reason) + "}"; }
            catch (std::exception const& e) { reply = "{\"ok\":false,\"error\":" + Quote(e.what()) + "}"; }
            std::cout << reply << std::endl;
        }
        if (ready) Close();
        return 0;
    }
}
