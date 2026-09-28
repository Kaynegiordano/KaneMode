// Widget Game Bar de KaneMode : modes de performance, mesures en direct, puissance (TDP), processeur,
// fréquence de l'écran, luminosité et volume, par-dessus n'importe quel jeu (touche Xbox / Win+G).
//
// C'est une petite application UWP (exigée par la Game Bar), sans fichier XAML : l'interface est
// construite en code. Elle ne règle rien elle-même : elle parle à l'hôte de KaneMode (API locale,
// comme l'accès rapide), dont l'adresse est notée par l'app dans LocalState\host.txt.
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Foundation.Collections.h>
#include <winrt/Windows.ApplicationModel.h>
#include <winrt/Windows.ApplicationModel.Activation.h>
#include <winrt/Windows.Data.Json.h>
#include <winrt/Windows.Storage.h>
#include <winrt/Windows.Storage.Streams.h>
#include <winrt/Windows.System.h>
#include <winrt/Windows.UI.h>
#include <winrt/Windows.UI.Core.h>
#include <winrt/Windows.UI.Text.h>
#include <winrt/Windows.UI.Xaml.h>
#include <winrt/Windows.UI.Xaml.Controls.h>
#include <winrt/Windows.UI.Xaml.Controls.Primitives.h>
#include <winrt/Windows.UI.Xaml.Media.h>
#include <winrt/Windows.Web.Http.h>
#include <winrt/Windows.Web.Http.Headers.h>
#include <winrt/Microsoft.Gaming.XboxGameBar.h>

#include <windows.h>
#include <cmath>
#include <functional>
#include <map>
#include <string>
#include <vector>

using namespace winrt;
using namespace winrt::Windows::ApplicationModel::Activation;
using namespace winrt::Windows::Data::Json;
using namespace winrt::Windows::Foundation;
using namespace winrt::Windows::UI;
using namespace winrt::Windows::UI::Xaml;
using namespace winrt::Windows::UI::Xaml::Controls;
using namespace winrt::Windows::UI::Xaml::Controls::Primitives;
using namespace winrt::Windows::UI::Xaml::Media;
using namespace winrt::Microsoft::Gaming::XboxGameBar;
namespace Http = winrt::Windows::Web::Http;

namespace
{
    // ------------------------------------------------------------------ couleurs (celles de KaneMode)
    Color Rgb(uint8_t r, uint8_t g, uint8_t b, uint8_t a = 255) { return Color{ a, r, g, b }; }
    SolidColorBrush Fill(Color c) { return SolidColorBrush(c); }
    const Color AccentColor = Rgb(26, 159, 255);
    const Color TextColor = Rgb(230, 233, 238);
    const Color MutedColor = Rgb(140, 149, 163);
    const Color CellColor = Rgb(255, 255, 255, 18);
    const Color OkColor = Rgb(155, 227, 169);
    const Color BadColor = Rgb(255, 154, 158);

    // Puissance des profils du constructeur [batterie, secteur], comme dans l'accès rapide
    const std::map<std::wstring, std::map<std::wstring, std::pair<int, int>>> ProfileWatts = {
        { L"rog-ally", { { L"silent", { 10, 10 } }, { L"performance", { 15, 15 } }, { L"turbo", { 25, 30 } } } },
        { L"rog-ally-x", { { L"silent", { 13, 13 } }, { L"performance", { 17, 17 } }, { L"turbo", { 25, 30 } } } },
        { L"legion-go", { { L"quiet", { 8, 8 } }, { L"balanced", { 15, 15 } }, { L"performance", { 20, 20 } } } },
    };
    const std::map<std::wstring, std::wstring> VendorLabels = {
        { L"silent", L"Silencieux" }, { L"quiet", L"Silencieux" }, { L"balanced", L"Équilibré" },
        { L"performance", L"Performance" }, { L"turbo", L"Turbo" }, { L"custom", L"Personnalisé" },
    };
    const std::vector<std::pair<std::wstring, std::wstring>> Modes = {
        { L"eco", L"Économie" }, { L"balanced", L"Équilibré" }, { L"performance", L"Performance" },
    };

    std::wstring Num(double v, int decimals)
    {
        wchar_t buf[32];
        swprintf_s(buf, decimals ? L"%.*f" : L"%.0f", decimals, v);
        std::wstring s = buf;
        for (auto& c : s) if (c == L'.') c = L',';
        return s;
    }

    // Lecture sûre d'un JSON (champs absents ou null)
    JsonObject Obj(JsonObject const& o, wchar_t const* k)
    {
        if (!o || !o.HasKey(k) || o.GetNamedValue(k).ValueType() != JsonValueType::Object) return nullptr;
        return o.GetNamedObject(k);
    }
    bool Has(JsonObject const& o, wchar_t const* k, JsonValueType t)
    {
        return o && o.HasKey(k) && o.GetNamedValue(k).ValueType() == t;
    }
    double NumOr(JsonObject const& o, wchar_t const* k, double d) { return Has(o, k, JsonValueType::Number) ? o.GetNamedNumber(k) : d; }
    std::wstring StrOr(JsonObject const& o, wchar_t const* k, wchar_t const* d = L"") { return Has(o, k, JsonValueType::String) ? std::wstring(o.GetNamedString(k)) : d; }

    TextBlock Label(std::wstring const& t, double size = 13, Color c = TextColor, bool bold = false)
    {
        TextBlock tb;
        tb.Text(t);
        tb.FontSize(size);
        tb.Foreground(Fill(c));
        tb.TextWrapping(TextWrapping::Wrap);
        if (bold) tb.FontWeight(winrt::Windows::UI::Text::FontWeights::SemiBold());
        return tb;
    }
}

// ====================================================================== interface du widget
struct KmPanel
{
    XboxGameBarWidget widget{ nullptr };
    Http::HttpClient http;
    std::wstring host;              // http://127.0.0.1:port de l'hôte KaneMode
    JsonObject sys{ nullptr };      // état : mode, processeur, fréquences, profil constructeur…
    JsonObject live{ nullptr };     // mesures en direct
    std::wstring applied;           // ce que le dernier mode a appliqué
    bool updating = false;          // vrai pendant qu'on remplit les curseurs (pas d'envoi)

    Grid root;
    StackPanel body;
    Grid liveGrid;
    DispatcherTimer timer;
    DispatcherTimer debounce;
    std::function<void()> pending;  // réglage à envoyer après le curseur

    KmPanel()
    {
        http.DefaultRequestHeaders().Append(L"X-KaneMode", L"1");
        root.RequestedTheme(ElementTheme::Dark);
        root.Background(Fill(Rgb(11, 14, 19, 235)));
        ScrollViewer scroll;
        scroll.VerticalScrollBarVisibility(ScrollBarVisibility::Auto);
        body.Padding(ThicknessHelper::FromLengths(14, 10, 14, 14));
        body.Spacing(8);
        scroll.Content(body);
        root.Children().Append(scroll);

        timer.Interval(std::chrono::seconds(1));
        timer.Tick([this](auto&&, auto&&) { Tick(); });
        debounce.Interval(std::chrono::milliseconds(350));
        debounce.Tick([this](auto&&, auto&&) { debounce.Stop(); if (pending) { auto p = pending; pending = nullptr; p(); } });
    }

    // ------------------------------------------------------------------ hôte KaneMode
    fire_and_forget FindHost()
    {
        try {
            auto folder = winrt::Windows::Storage::ApplicationData::Current().LocalFolder();
            auto file = co_await folder.GetFileAsync(L"host.txt");
            auto text = co_await winrt::Windows::Storage::FileIO::ReadTextAsync(file);
            std::wstring h = text.c_str();
            while (!h.empty() && (h.back() == L'\r' || h.back() == L'\n' || h.back() == L' ')) h.pop_back();
            host = h;
        }
        catch (...) { host.clear(); }
        Reload();
    }

    IAsyncOperation<JsonObject> Get(std::wstring path)
    {
        auto text = co_await http.GetStringAsync(Uri(host + path));
        co_return JsonObject::Parse(text);
    }

    IAsyncOperation<JsonObject> Post(std::wstring path, JsonObject body)
    {
        Http::HttpStringContent content(body.Stringify(), winrt::Windows::Storage::Streams::UnicodeEncoding::Utf8, L"application/json");
        auto r = co_await http.PostAsync(Uri(host + path), content);
        auto text = co_await r.Content().ReadAsStringAsync();
        auto j = JsonObject::Parse(text);
        if (!r.IsSuccessStatusCode()) throw hresult_error(E_FAIL, StrOr(j, L"error", L"Refusé").c_str());
        co_return j;
    }

    fire_and_forget Reload()
    {
        auto lifetime = this;
        if (host.empty()) { ShowOffline(); co_return; }
        try {
            sys = co_await Get(L"/api/sys");
            live = co_await Get(L"/api/sys/live");
            lifetime->Build();
        }
        catch (...) { lifetime->ShowOffline(); }
    }

    void Tick()
    {
        if (host.empty() || !sys) { if (!sys) FindHost(); return; }
        RefreshLive();
    }

    fire_and_forget RefreshLive()
    {
        try {
            live = co_await Get(L"/api/sys/live");
            PaintLive();
        }
        catch (...) { /* hôte occupé ou fermé : prochaine seconde */ }
    }

    fire_and_forget Send(std::wstring cmd, IJsonValue value)
    {
        JsonObject b;
        b.SetNamedValue(L"cmd", JsonValue::CreateStringValue(cmd));
        b.SetNamedValue(L"value", value);
        try {
            co_await Post(L"/api/sys", b);
            if (cmd == L"vendor" || cmd == L"tdp" || cmd == L"cpumax" || cmd == L"boost" || cmd == L"powermode") applied.clear();
            sys = co_await Get(L"/api/sys?refresh=1");
            Build();
        }
        catch (hresult_error const& e) { Toast(std::wstring(e.message())); }
    }

    fire_and_forget ApplyMode(std::wstring mode)
    {
        JsonObject b;
        b.SetNamedValue(L"mode", JsonValue::CreateStringValue(mode));
        try {
            auto r = co_await Post(L"/api/power/mode", b);
            if (auto st = Obj(r, L"state")) sys = st;
            // Ce qui a vraiment été fait, réglage par réglage
            std::wstring list;
            auto a = Obj(r, L"applied");
            std::vector<std::wstring> done;
            if (Has(r, L"done", JsonValueType::Array))
                for (auto v : r.GetNamedArray(L"done")) done.push_back(std::wstring(v.GetString()));
            auto ok = [&](wchar_t const* c) { for (auto& d : done) if (d == c) return true; return false; };
            auto line = [&](bool good, std::wstring const& t) { list += (good ? L"✓ " : L"✕ ") + t + L"\n"; };
            if (Has(a, L"powerMode", JsonValueType::String)) {
                std::wstring pm = StrOr(a, L"powerMode");
                line(ok(L"powermode"), pm == L"efficiency" ? L"Windows : économie d’énergie" : pm == L"performance" ? L"Windows : performances maximales" : L"Windows : équilibré");
            }
            if (Has(a, L"cpuMax", JsonValueType::Number)) {
                double m = a.GetNamedNumber(L"cpuMax");
                line(ok(L"cpumax"), m < 100 ? L"Processeur limité à " + Num(m, 0) + L" %" : L"Processeur sans limite");
            }
            if (Has(a, L"boost", JsonValueType::Boolean)) line(ok(L"boost"), a.GetNamedBoolean(L"boost") ? L"Turbo activé" : L"Turbo coupé");
            if (Has(a, L"vendor", JsonValueType::String)) {
                std::wstring v = StrOr(a, L"vendor");
                int w = Watts(v);
                auto it = VendorLabels.find(v);
                line(ok(L"vendor"), L"Profil " + (it != VendorLabels.end() ? it->second : v) + (w ? L" · " + std::to_wstring(w) + L" W" : L""));
            }
            if (!list.empty()) list.pop_back();
            applied = list;
            live = co_await Get(L"/api/sys/live");
            Build();
        }
        catch (hresult_error const& e) { Toast(std::wstring(e.message())); }
    }

    // ------------------------------------------------------------------ calculs d'affichage
    bool OnBattery() { return live && Has(live, L"discharging", JsonValueType::Boolean) && live.GetNamedBoolean(L"discharging"); }
    bool OnMains() { return live && Has(live, L"discharging", JsonValueType::Boolean) && !live.GetNamedBoolean(L"discharging"); }

    int Watts(std::wstring const& vendorMode)
    {
        auto t = ProfileWatts.find(StrOr(sys, L"handheld"));
        if (t == ProfileWatts.end()) return 0;
        auto w = t->second.find(vendorMode);
        if (w == t->second.end()) return 0;
        return OnMains() ? w->second.second : w->second.first;
    }

    std::wstring VendorFor(std::wstring const& mode)
    {
        auto v = Obj(sys, L"vendor");
        if (!v || !Has(v, L"modes", JsonValueType::Array)) return L"";
        std::vector<std::wstring> want = mode == L"eco" ? std::vector<std::wstring>{ L"silent", L"quiet" }
            : mode == L"balanced" ? std::vector<std::wstring>{ L"performance", L"balanced" } : std::vector<std::wstring>{ L"turbo", L"performance" };
        for (auto& w : want)
            for (auto m : v.GetNamedArray(L"modes"))
                if (std::wstring(m.GetString()) == w) return w;
        return L"";
    }

    // ------------------------------------------------------------------ construction de l'interface
    void Toast(std::wstring const& message)
    {
        auto t = Label(message, 12, BadColor);
        body.Children().InsertAt(body.Children().Size() > 0 ? 1 : 0, t);
    }

    void ShowOffline()
    {
        body.Children().Clear();
        body.Children().Append(Label(L"KaneMode", 18, TextColor, true));
        body.Children().Append(Label(L"KaneMode n’est pas ouvert, ou le widget n’est pas encore autorisé : dans KaneMode, Paramètres → Système → Autoriser le widget.", 13, MutedColor));
        body.Children().Append(ActionButton(L"Ouvrir KaneMode", [this]() { OpenKaneMode(); }));
    }

    Button ActionButton(std::wstring const& text, std::function<void()> act, bool active = false)
    {
        Button b;
        b.Content(box_value(text));
        b.HorizontalAlignment(HorizontalAlignment::Stretch);
        b.Padding(ThicknessHelper::FromLengths(8, 8, 8, 8));
        if (active) { b.Background(Fill(AccentColor)); b.Foreground(Fill(Colors::White())); }
        b.Click([act](auto&&, auto&&) { act(); });
        return b;
    }

    fire_and_forget OpenKaneMode()
    {
        co_await winrt::Windows::System::Launcher::LaunchUriAsync(Uri(L"kanemode:"));
    }

    Border LiveCell(std::wstring const& value, std::wstring const& label)
    {
        StackPanel s;
        s.HorizontalAlignment(HorizontalAlignment::Center);
        auto v = Label(value, 18, Colors::White(), true);
        v.HorizontalAlignment(HorizontalAlignment::Center);
        auto l = Label(label, 11, MutedColor);
        l.HorizontalAlignment(HorizontalAlignment::Center);
        s.Children().Append(v);
        s.Children().Append(l);
        Border b;
        b.Background(Fill(CellColor));
        b.CornerRadius(CornerRadiusHelper::FromUniformRadius(6));
        b.Padding(ThicknessHelper::FromLengths(4, 8, 4, 8));
        b.Margin(ThicknessHelper::FromLengths(2, 0, 2, 0));
        b.Child(s);
        return b;
    }

    void PaintLive()
    {
        if (!sys) return;
        liveGrid.Children().Clear();
        std::vector<std::pair<std::wstring, std::wstring>> cells;
        if (OnBattery() && Has(live, L"watts", JsonValueType::Number)) cells.push_back({ Num(live.GetNamedNumber(L"watts"), 1) + L" W", L"Consommation" });
        else if (OnMains()) cells.push_back({ L"Secteur", L"Alimentation" });
        else cells.push_back({ Has(live, L"load", JsonValueType::Number) ? Num(live.GetNamedNumber(L"load"), 0) + L" %" : L"—", L"Charge" });
        cells.push_back({ Has(live, L"mhz", JsonValueType::Number) && live.GetNamedNumber(L"mhz") > 0 ? Num(live.GetNamedNumber(L"mhz") / 1000.0, 2) + L" GHz" : L"—", L"Fréquence" });
        auto v = Obj(sys, L"vendor");
        int w = v ? Watts(StrOr(v, L"mode")) : 0;
        if (w) cells.push_back({ std::to_wstring(w) + L" W", L"Limite" });
        else if (auto cpu = Obj(sys, L"cpu")) cells.push_back({ Num(NumOr(cpu, L"maxAc", 100), 0) + L" %", L"Processeur" });
        for (size_t i = 0; i < cells.size(); i++) {
            auto c = LiveCell(cells[i].first, cells[i].second);
            Grid::SetColumn(c, (int32_t)i);
            liveGrid.Children().Append(c);
        }
    }

    Slider MakeSlider(double min, double max, double step, double value, std::function<void(double)> onChange)
    {
        Slider s;
        s.Minimum(min); s.Maximum(max); s.StepFrequency(step); s.SmallChange(step); s.LargeChange(step);
        s.Value(value);
        s.ValueChanged([this, onChange](auto&&, RangeBaseValueChangedEventArgs const& e) {
            if (updating) return;
            double v = e.NewValue();
            pending = [onChange, v]() { onChange(v); };
            debounce.Stop();
            debounce.Start();
        });
        return s;
    }

    void Build()
    {
        updating = true;
        body.Children().Clear();

        // En-tête
        Grid head;
        head.ColumnDefinitions().Append(ColumnDefinition());
        auto title = Label(L"KaneMode", 16, TextColor, true);
        head.Children().Append(title);
        body.Children().Append(head);

        // Mesures en direct
        liveGrid = Grid();
        for (int i = 0; i < 3; i++) liveGrid.ColumnDefinitions().Append(ColumnDefinition());
        body.Children().Append(liveGrid);
        PaintLive();

        // Modes de performance
        body.Children().Append(Label(L"Mode de performance", 12, MutedColor));
        Grid modes;
        std::wstring current = StrOr(sys, L"mode");
        for (size_t i = 0; i < Modes.size(); i++) {
            modes.ColumnDefinitions().Append(ColumnDefinition());
            std::wstring id = Modes[i].first, name = Modes[i].second;
            int w = Watts(VendorFor(id));
            auto b = ActionButton(w ? name + L"\n" + std::to_wstring(w) + L" W" : name, [this, id]() { ApplyMode(id); }, current == id);
            b.Margin(ThicknessHelper::FromLengths(2, 0, 2, 0));
            b.FontSize(13);
            Grid::SetColumn(b, (int32_t)i);
            modes.Children().Append(b);
        }
        body.Children().Append(modes);
        if (current == L"custom") body.Children().Append(Label(L"Personnalisé : réglages ajustés à la main", 12, MutedColor));
        if (!applied.empty()) body.Children().Append(Label(applied, 12, OkColor));

        // Puissance (TDP) des consoles reconnues
        auto vendor = Obj(sys, L"vendor");
        if (auto tdp = Obj(vendor, L"tdp")) {
            double mn = NumOr(tdp, L"min", 7), mx = NumOr(tdp, L"max", 30);
            auto value = Label(L"", 12, MutedColor);
            int w = Watts(StrOr(vendor, L"mode"));
            double start = w ? w : (mn + mx) / 2;
            value.Text(L"Puissance : " + Num(start, 0) + L" W");
            body.Children().Append(value);
            body.Children().Append(MakeSlider(mn, mx, 1, start, [this, value](double v) {
                value.Text(L"Puissance : " + Num(v, 0) + L" W");
                Send(L"tdp", JsonValue::CreateNumberValue(std::round(v)));
            }));
        }

        // Processeur
        if (auto cpu = Obj(sys, L"cpu")) {
            auto value = Label(L"Limite du processeur : " + Num(NumOr(cpu, L"maxAc", 100), 0) + L" %", 12, MutedColor);
            body.Children().Append(value);
            body.Children().Append(MakeSlider(30, 100, 5, NumOr(cpu, L"maxAc", 100), [this, value](double v) {
                value.Text(L"Limite du processeur : " + Num(v, 0) + L" %");
                Send(L"cpumax", JsonValue::CreateNumberValue(std::round(v)));
            }));
            ToggleSwitch turbo;
            turbo.Header(box_value(L"Turbo du processeur"));
            turbo.IsOn(NumOr(cpu, L"boostAc", 2) != 0);
            turbo.Toggled([this, turbo](auto&&, auto&&) { if (!updating) Send(L"boost", JsonValue::CreateBooleanValue(turbo.IsOn())); });
            body.Children().Append(turbo);
        }

        // Fréquence de l'écran
        if (auto refresh = Obj(sys, L"refresh")) {
            std::vector<double> rates;
            if (Has(refresh, L"available", JsonValueType::Array))
                for (auto r : refresh.GetNamedArray(L"available")) if (r.GetNumber() >= 30) rates.push_back(r.GetNumber());
            if (rates.size() > 5) rates.erase(rates.begin(), rates.end() - 5);
            if (rates.size() > 1) {
                body.Children().Append(Label(L"Fréquence de l’écran", 12, MutedColor));
                Grid g;
                double cur = NumOr(refresh, L"current", 0);
                for (size_t i = 0; i < rates.size(); i++) {
                    g.ColumnDefinitions().Append(ColumnDefinition());
                    double hz = rates[i];
                    auto b = ActionButton(Num(hz, 0), [this, hz]() { Send(L"refresh", JsonValue::CreateNumberValue(hz)); }, hz == cur);
                    b.Margin(ThicknessHelper::FromLengths(2, 0, 2, 0));
                    Grid::SetColumn(b, (int32_t)i);
                    g.Children().Append(b);
                }
                body.Children().Append(g);
            }
        }

        // Luminosité et volume
        if (Has(sys, L"brightness", JsonValueType::Number)) {
            auto value = Label(L"Luminosité : " + Num(sys.GetNamedNumber(L"brightness"), 0) + L" %", 12, MutedColor);
            body.Children().Append(value);
            body.Children().Append(MakeSlider(0, 100, 5, sys.GetNamedNumber(L"brightness"), [this, value](double v) {
                value.Text(L"Luminosité : " + Num(v, 0) + L" %");
                Send(L"brightness", JsonValue::CreateNumberValue(std::round(v)));
            }));
        }
        if (Has(sys, L"volume", JsonValueType::Number)) {
            auto value = Label(L"Volume : " + Num(sys.GetNamedNumber(L"volume"), 0) + L" %", 12, MutedColor);
            body.Children().Append(value);
            body.Children().Append(MakeSlider(0, 100, 5, sys.GetNamedNumber(L"volume"), [this, value](double v) {
                value.Text(L"Volume : " + Num(v, 0) + L" %");
                Send(L"volume", JsonValue::CreateNumberValue(std::round(v)));
            }));
        }

        auto open = ActionButton(L"Ouvrir KaneMode", [this]() { OpenKaneMode(); });
        open.Margin(ThicknessHelper::FromLengths(0, 6, 0, 0));
        body.Children().Append(open);
        updating = false;
    }

    void Start()
    {
        ShowOffline();
        FindHost();
        timer.Start();
    }
};

// ====================================================================== application
struct App : ApplicationT<App>
{
    KmPanel* panel = nullptr;

    void OnActivated(IActivatedEventArgs const& e)
    {
        XboxGameBarWidgetActivatedEventArgs widgetArgs{ nullptr };
        if (e.Kind() == ActivationKind::Protocol) {
            auto protocol = e.try_as<IProtocolActivatedEventArgs>();
            if (protocol && protocol.Uri().SchemeName() == L"ms-gamebarwidget") widgetArgs = e.try_as<XboxGameBarWidgetActivatedEventArgs>();
        }
        if (!widgetArgs) return;
        if (widgetArgs.IsLaunchActivation()) {
            Frame frame;
            Window::Current().Content(frame);
            panel = new KmPanel();
            panel->widget = XboxGameBarWidget(widgetArgs, Window::Current().CoreWindow(), frame);
            frame.Content(panel->root);
            Window::Current().Closed([this](auto&&, auto&&) {
                if (panel) { panel->timer.Stop(); panel->widget = nullptr; }
            });
            panel->Start();
        }
        Window::Current().Activate();
    }

    void OnLaunched(LaunchActivatedEventArgs const&)
    {
        // Lancé hors de la Game Bar (ne devrait pas arriver : pas d'entrée dans le menu Démarrer)
        Window::Current().Content(Label(L"Ouvrez la Game Bar (touche Xbox ou Windows + G) pour utiliser le widget KaneMode.", 16));
        Window::Current().Activate();
    }
};

int __stdcall wWinMain(HINSTANCE, HINSTANCE, PWSTR, int)
{
    init_apartment(apartment_type::single_threaded);
    Application::Start([](auto&&) { make<App>(); });
    return 0;
}
