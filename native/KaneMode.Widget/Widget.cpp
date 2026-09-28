// Widget Game Bar de KaneMode (« HUD ») : profil d'énergie avec ses watts, mesures en direct et tuiles
// de réglages (écran, système, son), par-dessus n'importe quel jeu (touche Xbox ou Windows + G).
//
// Application UWP exigée par la Game Bar, sans fichier XAML : l'interface est construite en code (le
// gabarit des tuiles est lu au lancement par XamlReader). Elle ne règle rien elle-même : elle passe
// par l'app KaneMode, qui relaie ses demandes à l'hôte par un tube nommé privé du paquet
// (\\.\pipe\LOCAL\kanemode-widget, voir native\KaneMode.App\WidgetBridge.cs).
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Foundation.Collections.h>
#include <winrt/Windows.ApplicationModel.h>
#include <winrt/Windows.ApplicationModel.Activation.h>
#include <winrt/Windows.Data.Json.h>
#include <winrt/Windows.System.h>
#include <winrt/Windows.UI.h>
#include <winrt/Windows.UI.Core.h>
#include <winrt/Windows.UI.Text.h>
#include <winrt/Windows.UI.Xaml.h>
#include <winrt/Windows.UI.Xaml.Controls.h>
#include <winrt/Windows.UI.Xaml.Controls.Primitives.h>
#include <winrt/Windows.UI.Xaml.Input.h>
#include <winrt/Windows.UI.Xaml.Markup.h>
#include <winrt/Windows.UI.Xaml.Media.h>
#include <winrt/Windows.UI.Xaml.Shapes.h>
#include <winrt/Microsoft.Gaming.XboxGameBar.h>

#include <windows.h>
#include <chrono>
#include <cmath>
#include <functional>
#include <map>
#include <memory>
#include <string>
#include <thread>
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
using winrt::Windows::UI::Xaml::Shapes::Ellipse;

namespace
{
    // ------------------------------------------------------------------ couleurs et petits outils
    Color Rgb(uint8_t r, uint8_t g, uint8_t b, uint8_t a = 255) { return Color{ a, r, g, b }; }
    SolidColorBrush Fill(Color c) { return SolidColorBrush(c); }
    const Color BgColor = Rgb(24, 28, 37);
    const Color CardColor = Rgb(34, 39, 50);
    const Color CardLine = Rgb(255, 255, 255, 22);
    const Color OnColor = Rgb(28, 63, 122);        // tuile active (bleu profond)
    const Color OnLine = Rgb(59, 130, 246);        // bordure active
    const Color OnText = Rgb(96, 165, 250);
    const Color TextColor = Rgb(236, 239, 244);
    const Color MutedColor = Rgb(148, 157, 172);
    const Color BadColor = Rgb(255, 154, 158);

    // Puissance des profils du constructeur [batterie, secteur], comme dans l'accès rapide
    const std::map<std::wstring, std::map<std::wstring, std::pair<int, int>>> ProfileWatts = {
        { L"rog-ally", { { L"silent", { 10, 10 } }, { L"performance", { 15, 15 } }, { L"turbo", { 25, 30 } } } },
        { L"rog-ally-x", { { L"silent", { 13, 13 } }, { L"performance", { 17, 17 } }, { L"turbo", { 25, 30 } } } },
        { L"legion-go", { { L"quiet", { 8, 8 } }, { L"balanced", { 15, 15 } }, { L"performance", { 20, 20 } } } },
    };
    struct ModeInfo { const wchar_t* id; const wchar_t* name; const wchar_t* glyph; };
    const ModeInfo Modes[] = {
        { L"eco", L"Économie", L"" }, { L"balanced", L"Équilibré", L"" },
        { L"performance", L"Performance", L"" }, { L"custom", L"Personnalisé", L"" },
    };

    std::wstring Num(double v, int decimals)
    {
        wchar_t buf[32];
        swprintf_s(buf, L"%.*f", decimals, v);
        std::wstring s = buf;
        for (auto& c : s) if (c == L'.') c = L',';
        return s;
    }

    // Lecture sûre d'un JSON (champs absents ou null)
    bool Has(JsonObject const& o, wchar_t const* k, JsonValueType t) { return o && o.HasKey(k) && o.GetNamedValue(k).ValueType() == t; }
    JsonObject Obj(JsonObject const& o, wchar_t const* k) { return Has(o, k, JsonValueType::Object) ? o.GetNamedObject(k) : nullptr; }
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
    FontIcon Glyph(wchar_t const* g, double size, Color c = TextColor)
    {
        FontIcon f;
        f.FontFamily(FontFamily(L"Segoe Fluent Icons, Segoe MDL2 Assets"));
        f.Glyph(g);
        f.FontSize(size);
        f.Foreground(Fill(c));
        return f;
    }

    // Gabarit des tuiles : un cadre arrondi, sans les couleurs par défaut des boutons ; un peu plus
    // clair au survol, plus sombre à l'appui ; le cadre de focus système suit la manette.
    Style TileStyle()
    {
        static Style style{ nullptr };
        if (!style) {
            style = Markup::XamlReader::Load(LR"(
<Style xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" TargetType="Button">
  <Setter Property="HorizontalAlignment" Value="Stretch"/>
  <Setter Property="VerticalAlignment" Value="Stretch"/>
  <Setter Property="HorizontalContentAlignment" Value="Stretch"/>
  <Setter Property="VerticalContentAlignment" Value="Stretch"/>
  <Setter Property="UseSystemFocusVisuals" Value="True"/>
  <Setter Property="Template">
    <Setter.Value>
      <ControlTemplate TargetType="Button">
        <Grid x:Name="Root">
          <VisualStateManager.VisualStateGroups>
            <VisualStateGroup x:Name="CommonStates">
              <VisualState x:Name="Normal"/>
              <VisualState x:Name="PointerOver"><VisualState.Setters><Setter Target="Shade.Opacity" Value="0.06"/></VisualState.Setters></VisualState>
              <VisualState x:Name="Pressed"><VisualState.Setters><Setter Target="Shade.Opacity" Value="0.12"/><Setter Target="Root.Opacity" Value="0.85"/></VisualState.Setters></VisualState>
              <VisualState x:Name="Disabled"><VisualState.Setters><Setter Target="Root.Opacity" Value="0.4"/></VisualState.Setters></VisualState>
            </VisualStateGroup>
          </VisualStateManager.VisualStateGroups>
          <Border Background="{TemplateBinding Background}" BorderBrush="{TemplateBinding BorderBrush}" BorderThickness="{TemplateBinding BorderThickness}" CornerRadius="12"/>
          <Border x:Name="Shade" Background="White" Opacity="0" CornerRadius="12"/>
          <ContentPresenter Margin="{TemplateBinding Padding}" HorizontalAlignment="{TemplateBinding HorizontalContentAlignment}" VerticalAlignment="{TemplateBinding VerticalContentAlignment}"/>
        </Grid>
      </ControlTemplate>
    </Setter.Value>
  </Setter>
</Style>)").as<Style>();
        }
        return style;
    }

    std::string Utf8(std::wstring_view w)
    {
        if (w.empty()) return {};
        int n = WideCharToMultiByte(CP_UTF8, 0, w.data(), (int)w.size(), nullptr, 0, nullptr, nullptr);
        std::string s(n, '\0');
        WideCharToMultiByte(CP_UTF8, 0, w.data(), (int)w.size(), s.data(), n, nullptr, nullptr);
        return s;
    }
    std::wstring Wide(std::string const& s)
    {
        if (s.empty()) return {};
        int n = MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), nullptr, 0);
        std::wstring w(n, L'\0');
        MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), w.data(), n);
        return w;
    }

    // Une requête à l'hôte KaneMode, par le tube nommé de l'app (voir WidgetBridge.cs)
    IAsyncOperation<JsonObject> Call(std::wstring method, std::wstring path, JsonObject body = nullptr)
    {
        JsonObject req;
        req.SetNamedValue(L"method", JsonValue::CreateStringValue(method));
        req.SetNamedValue(L"path", JsonValue::CreateStringValue(path));
        if (body) req.SetNamedValue(L"body", body);
        std::string line = Utf8(req.Stringify()) + "\n";
        co_await resume_background();
        HANDLE h = INVALID_HANDLE_VALUE;
        for (int i = 0; i < 40; i++) {
            h = CreateFile2(L"\\\\.\\pipe\\LOCAL\\kanemode-widget", GENERIC_READ | GENERIC_WRITE, 0, OPEN_EXISTING, nullptr);
            if (h != INVALID_HANDLE_VALUE || GetLastError() != ERROR_PIPE_BUSY) break;
            std::this_thread::sleep_for(std::chrono::milliseconds(25));
        }
        if (h == INVALID_HANDLE_VALUE) throw hresult_error(E_FAIL, L"KaneMode n’est pas ouvert");
        DWORD n = 0;
        WriteFile(h, line.data(), (DWORD)line.size(), &n, nullptr);
        std::string resp;
        char buf[8192];
        while (ReadFile(h, buf, sizeof buf, &n, nullptr) && n) {
            resp.append(buf, n);
            if (!resp.empty() && resp.back() == '\n') break;
        }
        CloseHandle(h);
        JsonObject answer{ nullptr };
        if (!JsonObject::TryParse(Wide(resp), answer)) throw hresult_error(E_FAIL, L"KaneMode n’est pas ouvert");
        auto result = Obj(answer, L"body");
        if (NumOr(answer, L"status", 500) >= 400) throw hresult_error(E_FAIL, StrOr(result, L"error", L"Refusé").c_str());
        co_return result ? result : JsonObject();
    }
}

// ====================================================================== le HUD
struct Hud
{
    XboxGameBarWidget widget{ nullptr };
    JsonObject sys{ nullptr };       // état : mode, processeur, écran, radios, profil constructeur…
    JsonObject live{ nullptr };      // mesures en direct
    std::wstring filter = L"all";    // catégorie de tuiles affichée
    std::wstring message;            // erreur de la dernière action
    bool customOpen = false;         // réglages du profil personnalisé dépliés
    bool busy = false;

    Grid root;
    StackPanel body;
    TextBlock badge{ nullptr };
    TextBlock liveMain{ nullptr };
    TextBlock liveSub{ nullptr };
    DispatcherTimer timer;
    int ticks = 0;

    Hud()
    {
        root.RequestedTheme(ElementTheme::Dark);
        root.Background(Fill(BgColor));
        ScrollViewer scroll;
        scroll.VerticalScrollBarVisibility(ScrollBarVisibility::Auto);
        body.Padding(ThicknessHelper::FromLengths(14, 10, 14, 16));
        body.Spacing(10);
        scroll.Content(body);
        root.Children().Append(scroll);
        timer.Interval(std::chrono::seconds(1));
        timer.Tick([this](auto&&, auto&&) { Tick(); });
    }

    // ------------------------------------------------------------------ échanges avec KaneMode
    fire_and_forget Reload()
    {
        try {
            sys = co_await Call(L"GET", L"/api/sys");
            live = co_await Call(L"GET", L"/api/sys/live");
            Build();
        }
        catch (...) { sys = nullptr; ShowOffline(); }
    }

    void Tick()
    {
        if (!Window::Current().Visible()) return;   // Game Bar fermée : aucune mesure
        ticks++;
        if (!sys) { if (ticks % 3 == 0) Reload(); return; }
        if (ticks % 8 == 0 && !busy) { Reload(); return; }  // réglages changés ailleurs (KaneMode, Windows)
        RefreshLive();
    }

    fire_and_forget RefreshLive()
    {
        try { live = co_await Call(L"GET", L"/api/sys/live"); PaintLive(); }
        catch (...) {}
    }

    fire_and_forget Send(std::wstring cmd, IJsonValue value, std::wstring kind = L"")
    {
        JsonObject b;
        b.SetNamedValue(L"cmd", JsonValue::CreateStringValue(cmd));
        b.SetNamedValue(L"value", value);
        if (!kind.empty()) b.SetNamedValue(L"kind", JsonValue::CreateStringValue(kind));
        busy = true;
        try {
            co_await Call(L"POST", L"/api/sys", b);
            message.clear();
            sys = co_await Call(L"GET", L"/api/sys?refresh=1");
        }
        catch (hresult_error const& e) { message = e.message().c_str(); }
        busy = false;
        Build();
    }

    fire_and_forget ApplyMode(std::wstring mode)
    {
        JsonObject b;
        b.SetNamedValue(L"mode", JsonValue::CreateStringValue(mode));
        busy = true;
        try {
            auto r = co_await Call(L"POST", L"/api/power/mode", b);
            if (auto st = Obj(r, L"state")) sys = st;
            message.clear();
            if (Has(r, L"errors", JsonValueType::Array) && r.GetNamedArray(L"errors").Size())
                message = r.GetNamedArray(L"errors").GetStringAt(0).c_str();
            live = co_await Call(L"GET", L"/api/sys/live");
        }
        catch (hresult_error const& e) { message = e.message().c_str(); }
        busy = false;
        Build();
    }

    fire_and_forget OpenKaneMode()
    {
        co_await winrt::Windows::System::Launcher::LaunchUriAsync(Uri(L"kanemode:"));
    }

    // ------------------------------------------------------------------ calculs d'affichage
    bool OnBattery() { return Has(live, L"discharging", JsonValueType::Boolean) && live.GetNamedBoolean(L"discharging"); }
    bool OnMains() { return Has(live, L"discharging", JsonValueType::Boolean) && !live.GetNamedBoolean(L"discharging"); }

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
            : mode == L"balanced" ? std::vector<std::wstring>{ L"performance", L"balanced" }
            : mode == L"performance" ? std::vector<std::wstring>{ L"turbo", L"performance" } : std::vector<std::wstring>{};
        for (auto& w : want)
            for (auto m : v.GetNamedArray(L"modes"))
                if (std::wstring(m.GetString()) == w) return w;
        return L"";
    }

    // ------------------------------------------------------------------ éléments d'interface
    Button Tile(UIElement const& content, bool on, std::function<void()> act)
    {
        Button b;
        b.Style(TileStyle());
        b.Background(Fill(on ? OnColor : CardColor));
        b.BorderBrush(Fill(on ? OnLine : CardLine));
        b.BorderThickness(ThicknessHelper::FromUniformLength(on ? 2 : 1));
        b.Padding(ThicknessHelper::FromLengths(14, 12, 14, 12));
        b.Content(content);
        b.Click([act](auto&&, auto&&) { act(); });
        return b;
    }

    TextBlock Section(std::wstring const& t)
    {
        auto l = Label(t, 12, MutedColor, true);
        l.CharacterSpacing(120);
        l.Margin(ThicknessHelper::FromLengths(2, 6, 0, 0));
        return l;
    }

    // Tuile interrupteur : icône, point (bleu si activé), titre, état
    Button SwitchTile(wchar_t const* glyph, std::wstring const& title, bool on, std::function<void(bool)> toggle)
    {
        Grid g;
        g.RowDefinitions().Append(RowDefinition());
        g.RowDefinitions().Append(RowDefinition());
        g.RowDefinitions().Append(RowDefinition());
        auto icon = Glyph(glyph, 24, on ? OnText : TextColor);
        icon.HorizontalAlignment(HorizontalAlignment::Left);
        g.Children().Append(icon);
        Ellipse dot;
        dot.Width(9); dot.Height(9);
        dot.Fill(Fill(on ? OnText : Rgb(230, 233, 238)));
        dot.HorizontalAlignment(HorizontalAlignment::Right);
        dot.VerticalAlignment(VerticalAlignment::Top);
        g.Children().Append(dot);
        auto t = Label(title, 14, TextColor, true);
        t.Margin(ThicknessHelper::FromLengths(0, 14, 0, 0));
        Grid::SetRow(t, 1);
        g.Children().Append(t);
        auto s = Label(on ? L"Activé" : L"Désactivé", 12, on ? OnText : MutedColor);
        Grid::SetRow(s, 2);
        g.Children().Append(s);
        return Tile(g, on, [toggle, on]() { toggle(!on); });
    }

    // Tuile valeur : icône et titre, chevron, grande valeur, « Toucher pour changer » ; un menu déroulant
    Button ValueTile(wchar_t const* glyph, std::wstring const& title, std::wstring const& value, FlyoutBase const& flyout)
    {
        StackPanel s;
        Grid head;
        StackPanel left;
        left.Orientation(Orientation::Horizontal);
        left.Spacing(8);
        left.Children().Append(Glyph(glyph, 20));
        auto t = Label(title, 13, TextColor, true);
        t.TextWrapping(TextWrapping::NoWrap);
        t.TextTrimming(TextTrimming::CharacterEllipsis);
        t.VerticalAlignment(VerticalAlignment::Center);
        left.Children().Append(t);
        head.Children().Append(left);
        auto chev = Glyph(L"", 12, MutedColor);
        chev.HorizontalAlignment(HorizontalAlignment::Right);
        head.Children().Append(chev);
        s.Children().Append(head);
        auto v = Label(value, 26, TextColor, true);
        v.Margin(ThicknessHelper::FromLengths(0, 8, 0, 0));
        v.TextWrapping(TextWrapping::NoWrap);
        s.Children().Append(v);
        s.Children().Append(Label(L"Toucher pour changer", 12, MutedColor));
        auto b = Tile(s, false, []() {});
        b.Flyout(flyout);
        return b;
    }

    // Menu déroulant : liste d'options (la courante en bleu)
    Flyout ListFlyout(std::vector<std::pair<std::wstring, IJsonValue>> const& options, std::wstring const& current, std::function<void(IJsonValue)> pick)
    {
        Flyout f;
        StackPanel list;
        list.Spacing(4);
        list.MinWidth(170);
        for (auto const& [label, value] : options) {
            Button b;
            b.Content(box_value(label));
            b.HorizontalAlignment(HorizontalAlignment::Stretch);
            b.HorizontalContentAlignment(HorizontalAlignment::Left);
            if (label == current) { b.Background(Fill(OnColor)); b.BorderBrush(Fill(OnLine)); }
            IJsonValue v = value;
            b.Click([f, pick, v](auto&&, auto&&) { f.Hide(); pick(v); });
            list.Children().Append(b);
        }
        ScrollViewer sv;
        sv.MaxHeight(320);
        sv.Content(list);
        f.Content(sv);
        return f;
    }

    // Menu déroulant : curseur, envoyé à la fermeture du menu
    Flyout SliderFlyout(double min, double max, double step, double value, std::wstring unit, std::function<void(double)> apply)
    {
        Flyout f;
        StackPanel p;
        p.Width(240);
        auto label = Label(Num(value, 0) + unit, 20, TextColor, true);
        Slider s;
        s.Minimum(min); s.Maximum(max); s.StepFrequency(step); s.SmallChange(step); s.LargeChange(step * 2);
        s.Value(value);
        s.ValueChanged([label, unit](auto&&, RangeBaseValueChangedEventArgs const& e) { label.Text(Num(e.NewValue(), 0) + unit); });
        auto sent = std::make_shared<double>(value);
        f.Closed([s, sent, apply](auto&&, auto&&) { if (s.Value() != *sent) { *sent = s.Value(); apply(s.Value()); } });
        p.Children().Append(label);
        p.Children().Append(s);
        f.Content(p);
        return f;
    }

    // ------------------------------------------------------------------ construction
    void ShowOffline()
    {
        body.Children().Clear();
        body.Children().Append(Label(L"KaneMode", 18, TextColor, true));
        body.Children().Append(Label(L"KaneMode n’est pas ouvert. Le widget règle la console en passant par KaneMode : ouvrez-le (il reste ouvert en mode Xbox).", 13, MutedColor));
        StackPanel c;
        c.Orientation(Orientation::Horizontal);
        c.Spacing(10);
        c.Children().Append(Glyph(L"", 20));
        c.Children().Append(Label(L"Ouvrir KaneMode", 14, TextColor, true));
        body.Children().Append(Tile(c, false, [this]() { OpenKaneMode(); }));
    }

    void PaintLive()
    {
        if (!sys || !badge) return;
        // Pastille : consommation sur batterie, sinon puissance du profil, sinon fréquence
        auto v = Obj(sys, L"vendor");
        int w = v ? Watts(StrOr(v, L"mode")) : 0;
        double mhz = NumOr(live, L"mhz", 0);
        bool watts = OnBattery() && Has(live, L"watts", JsonValueType::Number);
        if (watts) badge.Text(Num(live.GetNamedNumber(L"watts"), 1) + L" W");
        else if (w) badge.Text(std::to_wstring(w) + L" W");
        else badge.Text(mhz > 0 ? Num(mhz / 1000.0, 1) + L" GHz" : L"—");
        std::wstring main, sub;
        if (watts) main = Num(live.GetNamedNumber(L"watts"), 1) + L" W consommés";
        else if (OnMains()) main = L"Sur secteur";
        else main = L"Processeur à " + Num(NumOr(live, L"load", 0), 0) + L" %";
        if (mhz > 0) sub = L"Fréquence réelle " + Num(mhz / 1000.0, 2) + L" GHz";
        if (w) sub += (sub.empty() ? L"" : L" · ") + std::wstring(L"limite ") + std::to_wstring(w) + L" W";
        else if (auto cpu = Obj(sys, L"cpu")) sub += (sub.empty() ? L"" : L" · ") + std::wstring(L"processeur ") + Num(NumOr(cpu, L"maxAc", 100), 0) + L" %";
        liveMain.Text(main);
        liveSub.Text(sub);
    }

    void Build()
    {
        body.Children().Clear();

        // En-tête : nom, pastille de puissance
        Grid head;
        auto title = Label(L"KaneMode HUD", 13, MutedColor);
        title.VerticalAlignment(VerticalAlignment::Center);
        head.Children().Append(title);
        Border pill;
        pill.HorizontalAlignment(HorizontalAlignment::Right);
        pill.Background(Fill(Rgb(30, 58, 138, 140)));
        pill.BorderBrush(Fill(OnLine));
        pill.BorderThickness(ThicknessHelper::FromUniformLength(1.5));
        pill.CornerRadius(CornerRadiusHelper::FromUniformRadius(14));
        pill.Padding(ThicknessHelper::FromLengths(12, 4, 12, 4));
        badge = Label(L"—", 14, TextColor, true);
        pill.Child(badge);
        head.Children().Append(pill);
        body.Children().Append(head);

        // Carte des mesures en direct
        Border card;
        card.Background(Fill(CardColor));
        card.BorderBrush(Fill(CardLine));
        card.BorderThickness(ThicknessHelper::FromUniformLength(1));
        card.CornerRadius(CornerRadiusHelper::FromUniformRadius(14));
        card.Padding(ThicknessHelper::FromLengths(12, 12, 12, 12));
        Grid cg;
        ColumnDefinition c0;
        c0.Width(GridLengthHelper::FromValueAndType(56, GridUnitType::Pixel));
        cg.ColumnDefinitions().Append(c0);
        cg.ColumnDefinitions().Append(ColumnDefinition());
        Border iconBox;
        iconBox.Width(44); iconBox.Height(44);
        iconBox.HorizontalAlignment(HorizontalAlignment::Left);
        iconBox.CornerRadius(CornerRadiusHelper::FromUniformRadius(10));
        iconBox.BorderBrush(Fill(CardLine));
        iconBox.BorderThickness(ThicknessHelper::FromUniformLength(1.5));
        iconBox.Child(Glyph(L"", 22));
        cg.Children().Append(iconBox);
        StackPanel lines;
        lines.VerticalAlignment(VerticalAlignment::Center);
        liveMain = Label(L"", 15, TextColor, true);
        liveSub = Label(L"", 12, MutedColor);
        lines.Children().Append(liveMain);
        lines.Children().Append(liveSub);
        Grid::SetColumn(lines, 1);
        cg.Children().Append(lines);
        card.Child(cg);
        body.Children().Append(card);
        PaintLive();

        if (!message.empty()) body.Children().Append(Label(message, 12, BadColor));

        // Profil d'énergie : quatre tuiles (le personnalisé déplie ses réglages)
        body.Children().Append(Section(L"PROFIL D’ÉNERGIE"));
        Grid modes;
        modes.ColumnSpacing(8);
        std::wstring current = StrOr(sys, L"mode");
        for (int i = 0; i < 4; i++) {
            modes.ColumnDefinitions().Append(ColumnDefinition());
            auto const& m = Modes[i];
            std::wstring id = m.id;
            bool on = current == id || (id == L"custom" && customOpen && current != L"custom");
            StackPanel s;
            s.HorizontalAlignment(HorizontalAlignment::Center);
            s.Spacing(4);
            auto ic = Glyph(m.glyph, 24, on ? OnText : TextColor);
            s.Children().Append(ic);
            auto n = Label(m.name, 12, TextColor, true);
            n.HorizontalAlignment(HorizontalAlignment::Center);
            n.TextWrapping(TextWrapping::NoWrap);
            s.Children().Append(n);
            int w = id == L"custom" ? 0 : Watts(VendorFor(id));
            auto sub = Label(w ? std::to_wstring(w) + L" W" : (id == L"custom" ? L"Réglable" : L"—"), 12, on ? OnText : MutedColor, true);
            sub.HorizontalAlignment(HorizontalAlignment::Center);
            s.Children().Append(sub);
            auto t = Tile(s, on, [this, id]() {
                if (id == L"custom") { customOpen = !customOpen; Build(); }
                else { customOpen = false; ApplyMode(id); }
            });
            t.Padding(ThicknessHelper::FromLengths(4, 12, 4, 10));
            Grid::SetColumn(t, i);
            modes.Children().Append(t);
        }
        body.Children().Append(modes);
        if (customOpen || current == L"custom") BuildCustom();

        // Catégories
        Grid pills;
        pills.ColumnSpacing(6);
        pills.Margin(ThicknessHelper::FromLengths(0, 6, 0, 0));
        const std::pair<const wchar_t*, const wchar_t*> cats[] = { { L"all", L"Tout" }, { L"display", L"Écran" }, { L"system", L"Système" }, { L"sound", L"Son" } };
        int ci = 0;
        for (auto const& [id, name] : cats) {
            pills.ColumnDefinitions().Append(ColumnDefinition());
            bool on = filter == id;
            Button p;
            p.Style(TileStyle());
            p.Background(Fill(on ? Rgb(240, 242, 245) : CardColor));
            p.BorderBrush(Fill(CardLine));
            p.BorderThickness(ThicknessHelper::FromUniformLength(1));
            p.Padding(ThicknessHelper::FromLengths(4, 8, 4, 8));
            auto l = Label(name, 13, on ? Rgb(20, 24, 32) : TextColor, true);
            l.HorizontalAlignment(HorizontalAlignment::Center);
            p.Content(l);
            std::wstring fid = id;
            p.Click([this, fid](auto&&, auto&&) { filter = fid; Build(); });
            Grid::SetColumn(p, ci++);
            pills.Children().Append(p);
        }
        body.Children().Append(pills);

        // Tuiles, deux par ligne
        std::vector<Button> tiles;
        bool all = filter == L"all";
        if (all || filter == L"display") AddDisplayTiles(tiles);
        if (all || filter == L"system") AddSystemTiles(tiles);
        if (all || filter == L"sound") AddSoundTiles(tiles);
        Grid grid;
        grid.ColumnSpacing(10);
        grid.RowSpacing(10);
        grid.ColumnDefinitions().Append(ColumnDefinition());
        grid.ColumnDefinitions().Append(ColumnDefinition());
        for (size_t i = 0; i < tiles.size(); i++) {
            if (i % 2 == 0) grid.RowDefinitions().Append(RowDefinition());
            Grid::SetRow(tiles[i], (int32_t)(i / 2));
            Grid::SetColumn(tiles[i], (int32_t)(i % 2));
            grid.Children().Append(tiles[i]);
        }
        body.Children().Append(grid);

        // Ouvrir KaneMode
        StackPanel o;
        o.Orientation(Orientation::Horizontal);
        o.Spacing(10);
        o.HorizontalAlignment(HorizontalAlignment::Center);
        o.Children().Append(Glyph(L"", 18));
        o.Children().Append(Label(L"Ouvrir KaneMode", 14, TextColor, true));
        auto open = Tile(o, false, [this]() { OpenKaneMode(); });
        open.Margin(ThicknessHelper::FromLengths(0, 4, 0, 0));
        body.Children().Append(open);
    }

    void BuildCustom()
    {
        Border box;
        box.Background(Fill(CardColor));
        box.BorderBrush(Fill(CardLine));
        box.BorderThickness(ThicknessHelper::FromUniformLength(1));
        box.CornerRadius(CornerRadiusHelper::FromUniformRadius(12));
        box.Padding(ThicknessHelper::FromLengths(14, 10, 14, 10));
        StackPanel p;
        p.Spacing(2);
        auto vendor = Obj(sys, L"vendor");
        auto slider = [&](std::wstring title, double min, double max, double step, double value, std::wstring unit, std::function<void(double)> apply) {
            auto label = Label(title + L" : " + Num(value, 0) + unit, 13, TextColor, true);
            Slider s;
            s.Minimum(min); s.Maximum(max); s.StepFrequency(step); s.SmallChange(step); s.LargeChange(step * 2);
            s.Value(value);
            s.ValueChanged([label, title, unit](auto&&, RangeBaseValueChangedEventArgs const& e) { label.Text(title + L" : " + Num(e.NewValue(), 0) + unit); });
            // Envoyé quand on lâche le curseur (souris, tactile) ou quand il perd le focus (manette)
            auto sent = std::make_shared<double>(value);
            auto commit = [s, sent, apply]() { if (s.Value() != *sent) { *sent = s.Value(); apply(s.Value()); } };
            s.PointerCaptureLost([commit](auto&&, auto&&) { commit(); });
            s.LostFocus([commit](auto&&, auto&&) { commit(); });
            p.Children().Append(label);
            p.Children().Append(s);
        };
        if (auto tdp = Obj(vendor, L"tdp")) {
            double mn = NumOr(tdp, L"min", 7), mx = NumOr(tdp, L"max", 30);
            int w = Watts(StrOr(vendor, L"mode"));
            slider(L"Puissance", mn, mx, 1, w ? w : std::round((mn + mx) / 2), L" W", [this](double v) { Send(L"tdp", JsonValue::CreateNumberValue(std::round(v))); });
        }
        if (auto cpu = Obj(sys, L"cpu")) {
            slider(L"Limite du processeur", 30, 100, 5, NumOr(cpu, L"maxAc", 100), L" %", [this](double v) { Send(L"cpumax", JsonValue::CreateNumberValue(std::round(v))); });
        }
        if (!p.Children().Size()) p.Children().Append(Label(L"Aucun réglage de puissance sur ce PC.", 12, MutedColor));
        box.Child(p);
        body.Children().Append(box);
    }

    void AddDisplayTiles(std::vector<Button>& tiles)
    {
        if (auto refresh = Obj(sys, L"refresh")) {
            std::vector<std::pair<std::wstring, IJsonValue>> opts;
            if (Has(refresh, L"available", JsonValueType::Array))
                for (auto r : refresh.GetNamedArray(L"available")) if (r.GetNumber() >= 30) opts.push_back({ Num(r.GetNumber(), 0) + L" Hz", JsonValue::CreateNumberValue(r.GetNumber()) });
            std::wstring cur = Num(NumOr(refresh, L"current", 0), 0) + L" Hz";
            if (opts.size() > 1) tiles.push_back(ValueTile(L"", L"Fréquence", cur, ListFlyout(opts, cur, [this](IJsonValue v) { Send(L"refresh", v); })));
        }
        if (auto res = Obj(sys, L"resolution")) {
            std::vector<std::pair<std::wstring, IJsonValue>> opts;
            if (Has(res, L"available", JsonValueType::Array))
                for (auto r : res.GetNamedArray(L"available")) opts.push_back({ std::wstring(r.GetString()), JsonValue::CreateStringValue(r.GetString()) });
            std::wstring cur = StrOr(res, L"current");
            if (opts.size() > 1) tiles.push_back(ValueTile(L"", L"Résolution", cur, ListFlyout(opts, cur, [this](IJsonValue v) { Send(L"resolution", v); })));
        }
        if (Has(sys, L"brightness", JsonValueType::Number)) {
            double b = sys.GetNamedNumber(L"brightness");
            tiles.push_back(ValueTile(L"", L"Luminosité", Num(b, 0) + L" %", SliderFlyout(0, 100, 5, b, L" %", [this](double v) { Send(L"brightness", JsonValue::CreateNumberValue(std::round(v))); })));
        }
    }

    void AddSystemTiles(std::vector<Button>& tiles)
    {
        if (auto cpu = Obj(sys, L"cpu")) {
            bool boost = NumOr(cpu, L"boostAc", 2) != 0;
            tiles.push_back(SwitchTile(L"", L"Turbo processeur", boost, [this](bool on) { Send(L"boost", JsonValue::CreateBooleanValue(on)); }));
            double mx = NumOr(cpu, L"maxAc", 100);
            tiles.push_back(ValueTile(L"", L"Limite CPU", Num(mx, 0) + L" %", SliderFlyout(30, 100, 5, mx, L" %", [this](double v) { Send(L"cpumax", JsonValue::CreateNumberValue(std::round(v))); })));
        }
        if (Has(sys, L"radios", JsonValueType::Array)) {
            for (auto r : sys.GetNamedArray(L"radios")) {
                auto o = r.GetObject();
                std::wstring kind = StrOr(o, L"kind");
                bool on = Has(o, L"on", JsonValueType::Boolean) && o.GetNamedBoolean(L"on");
                tiles.push_back(SwitchTile(kind == L"WiFi" ? L"" : L"", kind == L"WiFi" ? L"Wi-Fi" : L"Bluetooth", on,
                    [this, kind](bool v) { Send(L"radio", JsonValue::CreateBooleanValue(v), kind); }));
            }
        }
        if (auto v = Obj(sys, L"vendor")) {
            if (Has(v, L"chargeLimit", JsonValueType::Number)) {
                std::wstring cur = Num(v.GetNamedNumber(L"chargeLimit"), 0) + L" %";
                tiles.push_back(ValueTile(L"", L"Limite de charge", cur, ListFlyout({ { L"60 %", JsonValue::CreateNumberValue(60) }, { L"80 %", JsonValue::CreateNumberValue(80) }, { L"100 %", JsonValue::CreateNumberValue(100) } },
                    cur, [this](IJsonValue x) { Send(L"chargelimit", x); })));
            }
        }
    }

    void AddSoundTiles(std::vector<Button>& tiles)
    {
        if (Has(sys, L"volume", JsonValueType::Number)) {
            double vol = sys.GetNamedNumber(L"volume");
            tiles.push_back(ValueTile(L"", L"Volume", Num(vol, 0) + L" %", SliderFlyout(0, 100, 5, vol, L" %", [this](double v) { Send(L"volume", JsonValue::CreateNumberValue(std::round(v))); })));
            bool muted = Has(sys, L"muted", JsonValueType::Boolean) && sys.GetNamedBoolean(L"muted");
            tiles.push_back(SwitchTile(L"", L"Sourdine", muted, [this](bool on) { Send(L"mute", JsonValue::CreateBooleanValue(on)); }));
        }
    }

    void Start()
    {
        ShowOffline();
        Reload();
        timer.Start();
    }
};

// ====================================================================== application
struct App : ApplicationT<App>
{
    Hud* hud = nullptr;

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
            hud = new Hud();
            hud->widget = XboxGameBarWidget(widgetArgs, Window::Current().CoreWindow(), frame);
            frame.Content(hud->root);
            Window::Current().Closed([this](auto&&, auto&&) {
                if (hud) { hud->timer.Stop(); hud->widget = nullptr; }
            });
            hud->Start();
        }
        Window::Current().Activate();
    }

    void OnLaunched(LaunchActivatedEventArgs const&)
    {
        // Lancé hors de la Game Bar (pas d'entrée dans le menu Démarrer, ne devrait pas arriver)
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
