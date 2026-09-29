// Widget Game Bar de KaneMode : l'interface de KaneMode (ui\widget.html : accès rapide, jeu en
// cours, raccourcis) dans un WebView2 de WinUI 2, par-dessus les jeux.
//
// Le widget est une application UWP isolée : il ne peut pas joindre l'hôte KaneMode sur 127.0.0.1.
// Les fichiers de l'interface sont donc lus directement dans le paquet (nom d'hôte virtuel
// https://kanemode.widget/), et la page envoie ses requêtes au widget (postMessage), qui les relaie
// par le tube nommé que l'app KaneMode ouvre pour lui (\\.\pipe\LOCAL\kanemode-widget, voir
// native\KaneMode.App\WidgetBridge.cs) : une ligne JSON de requête, une ligne de réponse.
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Foundation.Collections.h>
#include <winrt/Windows.ApplicationModel.h>
#include <winrt/Windows.ApplicationModel.Activation.h>
#include <winrt/Windows.Data.Json.h>
#include <winrt/Windows.Storage.h>
#include <winrt/Windows.UI.h>
#include <winrt/Windows.UI.Core.h>
#include <winrt/Windows.UI.Xaml.h>
#include <winrt/Windows.UI.Xaml.Controls.h>
#include <winrt/Windows.UI.Xaml.Interop.h>
#include <winrt/Windows.UI.Xaml.Markup.h>
#include <winrt/Windows.UI.Xaml.Media.h>
#include <winrt/Microsoft.UI.Xaml.Controls.h>
#include <winrt/Microsoft.UI.Xaml.XamlTypeInfo.h>
#include <winrt/Microsoft.Web.WebView2.Core.h>
#include <winrt/Microsoft.Gaming.XboxGameBar.h>

#include <windows.h>
#include <chrono>
#include <string>
#include <thread>

using namespace winrt;
using namespace Windows::Foundation;
using namespace Windows::ApplicationModel::Activation;
using namespace Windows::Data::Json;
using namespace Windows::UI::Xaml;
using namespace Windows::UI::Xaml::Controls;
using namespace Microsoft::Gaming::XboxGameBar;
namespace mux = winrt::Microsoft::UI::Xaml;
namespace wv = winrt::Microsoft::Web::WebView2::Core;

namespace
{
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

    /// Journal du widget : LocalState\widget.log dans les données du paquet (diagnostic sur la console)
    void Log(std::wstring const& text)
    {
        static std::wstring file;
        try {
            if (file.empty()) file = std::wstring(Windows::Storage::ApplicationData::Current().LocalFolder().Path()) + L"\\widget.log";
            SYSTEMTIME t; GetLocalTime(&t);
            wchar_t stamp[32];
            swprintf_s(stamp, L"[%04d-%02d-%02d %02d:%02d:%02d] ", t.wYear, t.wMonth, t.wDay, t.wHour, t.wMinute, t.wSecond);
            std::string line = Utf8(std::wstring(stamp) + text) + "\r\n";
            HANDLE h = CreateFile2(file.c_str(), FILE_APPEND_DATA, FILE_SHARE_READ, OPEN_ALWAYS, nullptr);
            if (h == INVALID_HANDLE_VALUE) return;
            DWORD n = 0;
            WriteFile(h, line.data(), (DWORD)line.size(), &n, nullptr);
            CloseHandle(h);
        }
        catch (...) { /* pas de journal */ }
    }
    void LogError(wchar_t const* where, hresult_error const& e)
    {
        wchar_t code[16];
        swprintf_s(code, L"0x%08X", (unsigned)e.code().value);
        Log(std::wstring(where) + L" : " + code + L" " + std::wstring(e.message()));
    }

    /// Une requête à l'app KaneMode par le tube nommé (hors du fil de l'interface).
    std::string Pipe(std::string const& line)
    {
        HANDLE h = INVALID_HANDLE_VALUE;
        for (int i = 0; i < 40; i++) {
            h = CreateFile2(L"\\\\.\\pipe\\LOCAL\\kanemode-widget", GENERIC_READ | GENERIC_WRITE, 0, OPEN_EXISTING, nullptr);
            if (h != INVALID_HANDLE_VALUE || GetLastError() != ERROR_PIPE_BUSY) break;
            std::this_thread::sleep_for(std::chrono::milliseconds(25));
        }
        if (h == INVALID_HANDLE_VALUE) return R"({"status":503,"body":{"error":"KaneMode n’est pas ouvert"}})";
        DWORD n = 0;
        WriteFile(h, line.data(), (DWORD)line.size(), &n, nullptr);
        std::string resp;
        char buf[16384];
        while (ReadFile(h, buf, sizeof buf, &n, nullptr) && n) {
            resp.append(buf, n);
            if (resp.back() == '\n') break;
        }
        CloseHandle(h);
        return resp;
    }
}

// ====================================================================== le widget
struct Widget
{
    XboxGameBarWidget widget{ nullptr };
    mux::Controls::WebView2 web;
    Windows::UI::Core::CoreDispatcher dispatcher{ nullptr };

    fire_and_forget Start()
    {
        try {
            Log(L"WebView2 : démarrage");
            co_await web.EnsureCoreWebView2Async();
            Log(L"WebView2 prêt");
            auto core = web.CoreWebView2();
            // Interface de KaneMode, lue dans le paquet (même dossier que pour l'app)
            hstring ui = Windows::ApplicationModel::Package::Current().InstalledLocation().Path() + L"\\app\\ui";
            core.SetVirtualHostNameToFolderMapping(L"kanemode.widget", ui, wv::CoreWebView2HostResourceAccessKind::Allow);
            auto s = core.Settings();
            s.AreDefaultContextMenusEnabled(false);
            s.IsZoomControlEnabled(false);
            s.IsStatusBarEnabled(false);
            s.AreDevToolsEnabled(false);
            core.WebMessageReceived({ this, &Widget::OnMessage });
            // Pas de nouvelle fenêtre ni de navigation hors de l'interface
            core.NewWindowRequested([](auto&&, wv::CoreWebView2NewWindowRequestedEventArgs const& a) { a.Handled(true); });
            core.NavigationStarting([](auto&&, wv::CoreWebView2NavigationStartingEventArgs const& a) {
                if (!std::wstring_view(a.Uri()).starts_with(L"https://kanemode.widget/")) a.Cancel(true);
            });
            core.NavigationCompleted([](auto&&, wv::CoreWebView2NavigationCompletedEventArgs const& a) {
                Log(a.IsSuccess() ? L"Page chargée" : L"Page non chargée : erreur " + std::to_wstring((int)a.WebErrorStatus()));
            });
            core.ProcessFailed([](auto&&, wv::CoreWebView2ProcessFailedEventArgs const& a) {
                Log(L"WebView2 : processus arrêté (" + std::to_wstring((int)a.ProcessFailedKind()) + L")");
            });
            Log(L"Interface : " + std::wstring(ui));
            web.Source(Uri(L"https://kanemode.widget/widget.html"));
            web.Focus(FocusState::Programmatic);
        }
        catch (hresult_error const& e) { LogError(L"WebView2", e); } // le widget reste vide
    }

    /// Message de la page : { type: "api", id, method, path, body } ou { type: "native", message }.
    fire_and_forget OnMessage(wv::CoreWebView2 const& sender, wv::CoreWebView2WebMessageReceivedEventArgs const& args)
    {
        auto core = sender;
        JsonObject msg{ nullptr };
        if (!JsonObject::TryParse(args.WebMessageAsJson(), msg)) co_return;
        static bool first = true;
        if (first) { first = false; Log(L"Premier message de la page : " + std::wstring(args.WebMessageAsJson()).substr(0, 120)); }
        hstring type = msg.GetNamedString(L"type", L"");
        double id = msg.GetNamedNumber(L"id", 0);
        JsonObject req;
        if (type == L"api") {
            req.SetNamedValue(L"method", JsonValue::CreateStringValue(msg.GetNamedString(L"method", L"GET")));
            req.SetNamedValue(L"path", JsonValue::CreateStringValue(msg.GetNamedString(L"path", L"")));
            if (msg.HasKey(L"body")) req.SetNamedValue(L"body", msg.GetNamedValue(L"body"));
        } else if (type == L"native" && msg.HasKey(L"message")) {
            req.SetNamedValue(L"native", msg.GetNamedValue(L"message"));
        } else co_return;
        std::string line = Utf8(req.Stringify()) + "\n";
        auto ui = dispatcher;
        co_await resume_background();
        std::string resp = Pipe(line);
        co_await resume_foreground(ui);
        // Réponse à la page, pour les deux sortes de messages (l'état du jeu en cours en est une)
        JsonObject answer{ nullptr };
        if (!JsonObject::TryParse(Wide(resp), answer)) {
            answer = JsonObject();
            answer.SetNamedValue(L"status", JsonValue::CreateNumberValue(502));
        }
        answer.SetNamedValue(L"type", JsonValue::CreateStringValue(L"api-result"));
        answer.SetNamedValue(L"id", JsonValue::CreateNumberValue(id));
        try { core.PostWebMessageAsJson(answer.Stringify()); } catch (hresult_error const&) { /* widget fermé */ }
    }
};

// ====================================================================== application
// WinUI 2 : l'application fournit les types XAML de WinUI (IXamlMetadataProvider) et ses styles
// (XamlControlsResources), sans quoi le contrôle WebView2 ne se crée pas.
struct App : ApplicationT<App, Markup::IXamlMetadataProvider>
{
    mux::XamlTypeInfo::XamlControlsXamlMetaDataProvider provider{ nullptr };
    Widget* hud = nullptr;
    bool styled = false;

    App()
    {
        UnhandledException([](auto&&, UnhandledExceptionEventArgs const& e) {
            Log(L"Exception non gérée : " + std::wstring(e.Message()));
            e.Handled(true);
        });
    }

    mux::XamlTypeInfo::XamlControlsXamlMetaDataProvider& Provider()
    {
        if (!provider) {
            try { provider = mux::XamlTypeInfo::XamlControlsXamlMetaDataProvider(); }
            catch (hresult_error const& e) { LogError(L"Types XAML de WinUI 2", e); throw; }
        }
        return provider;
    }
    Markup::IXamlType GetXamlType(Interop::TypeName const& type) { return Provider().GetXamlType(type); }
    Markup::IXamlType GetXamlType(hstring const& fullName) { return Provider().GetXamlType(fullName); }
    com_array<Markup::XmlnsDefinition> GetXmlnsDefinitions() { return Provider().GetXmlnsDefinitions(); }

    void Style()
    {
        if (styled) return;
        styled = true;
        try { Resources().MergedDictionaries().Append(mux::Controls::XamlControlsResources()); }
        catch (hresult_error const& e) { LogError(L"Styles de WinUI 2", e); }
    }

    void OnActivated(IActivatedEventArgs const& e)
    {
        Log(L"Activation (" + std::to_wstring((int)e.Kind()) + L")");
        try {
            XboxGameBarWidgetActivatedEventArgs widgetArgs{ nullptr };
            if (e.Kind() == ActivationKind::Protocol) {
                auto protocol = e.try_as<IProtocolActivatedEventArgs>();
                if (protocol && protocol.Uri().SchemeName() == L"ms-gamebarwidget") widgetArgs = e.try_as<XboxGameBarWidgetActivatedEventArgs>();
            }
            if (!widgetArgs) { Log(L"Activation hors de la Game Bar : ignorée"); return; }
            if (widgetArgs.IsLaunchActivation()) {
                Style();
                Frame frame;
                Window::Current().Content(frame);
                hud = new Widget();
                hud->dispatcher = Window::Current().Dispatcher();
                hud->widget = XboxGameBarWidget(widgetArgs, Window::Current().CoreWindow(), frame);
                Log(L"Widget Game Bar créé");
                Grid root;
                root.Children().Append(hud->web);
                frame.Content(root);
                Window::Current().Closed([this](auto&&, auto&&) { if (hud) hud->widget = nullptr; });
                hud->Start();
            }
            Window::Current().Activate();
        }
        catch (hresult_error const& err) { LogError(L"Activation", err); }
    }

    void OnLaunched(LaunchActivatedEventArgs const&)
    {
        // Lancé hors de la Game Bar (pas d'entrée dans le menu Démarrer, ne devrait pas arriver)
        TextBlock t;
        t.Text(L"Ouvrez la Game Bar (touche Xbox ou Windows + G) pour utiliser le widget KaneMode.");
        t.Margin(ThicknessHelper::FromUniformLength(24));
        t.TextWrapping(TextWrapping::Wrap);
        Window::Current().Content(t);
        Window::Current().Activate();
    }
};

int __stdcall wWinMain(HINSTANCE, HINSTANCE, PWSTR, int)
{
    // Fond transparent : la Game Bar et le jeu restent visibles sous les bords arrondis de la page
    SetEnvironmentVariableW(L"WEBVIEW2_DEFAULT_BACKGROUND_COLOR", L"00000000");
    // Multithread, comme le modèle C++/WinRT : Windows a déjà préparé ce fil ainsi pour une app UWP
    // (demander un fil STA levait RPC_E_CHANGED_MODE et le widget plantait avant d'afficher quoi que
    // ce soit). Application::Start crée lui-même le fil de l'interface.
    try { init_apartment(); }
    catch (hresult_error const& e) { if (e.code() != RPC_E_CHANGED_MODE) throw; }
    Log(L"Démarrage du widget");
    try { Application::Start([](auto&&) { make<App>(); }); }
    catch (hresult_error const& e) { LogError(L"Application", e); }
    return 0;
}
