using System.Globalization;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Shapes;

namespace KaneMode;

/// <summary>
/// Surimpression des performances façon SteamOS, au-dessus du jeu lancé depuis KaneMode. Niveau choisi
/// dans l'accès rapide (Performance), gardé par l'hôte (GET /api/overlay) : 0 rien, 1 images/s, 2 une
/// ligne, 3 détaillé, 4 détaillé avec le graphique de la dernière minute. Petite fenêtre en haut à
/// gauche, toujours au-dessus, transparente aux clics, jamais activée (même modèle que CursorOverlay).
/// Les jeux en plein écran exclusif passent au-dessus d'elle : la plupart utilisent aujourd'hui une
/// fenêtre sans bordure.
/// </summary>
public sealed class PerfOverlay : IDisposable
{
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")]
    private static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int index);
    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")]
    private static extern IntPtr SetWindowLongPtr(IntPtr hWnd, int index, IntPtr value);
    [DllImport("user32.dll")]
    private static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [StructLayout(LayoutKind.Sequential)]
    private struct SYSTEM_POWER_STATUS { public byte AcLineStatus, BatteryFlag, BatteryLifePercent, SystemStatusFlag; public int BatteryLifeTime, BatteryFullLifeTime; }
    [DllImport("kernel32.dll")]
    private static extern bool GetSystemPowerStatus(out SYSTEM_POWER_STATUS status);

    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(2) };
    private static readonly CultureInfo Fr = CultureInfo.CurrentCulture;
    private const int HistorySize = 60;

    private readonly Func<string?> _hostUrl;
    private readonly Func<bool> _gameInFront;
    private readonly System.Windows.Threading.DispatcherTimer _timer = new() { Interval = TimeSpan.FromSeconds(1) };
    private readonly Queue<int> _fps = new();
    private Window? _window;
    private StackPanel? _rows;
    private IntPtr _hwnd;
    private bool _shown, _busy, _preview;
    private int _level;

    /// <param name="hostUrl">Adresse de l'hôte (null tant qu'il n'est pas prêt).</param>
    /// <param name="gameInFront">Un jeu lancé depuis KaneMode tourne et KaneMode n'est pas devant.</param>
    public PerfOverlay(Func<string?> hostUrl, Func<bool> gameInFront)
    {
        _hostUrl = hostUrl;
        _gameInFront = gameInFront;
        _timer.Tick += async (_, _) => await Tick();
        _timer.Start();
    }

    private async Task Tick()
    {
        // Rien à demander à l'hôte tant qu'aucun jeu n'est devant : une simple vérification par seconde
        if (_busy) return;
        if (!_gameInFront() || !Native.InteractiveDesktop()) { Hide(); _fps.Clear(); return; }
        string? url = _hostUrl();
        if (url == null) return;
        _busy = true;
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Get, url + "/api/overlay");
            req.Headers.Add("X-KaneMode", "1");
            using var res = await Http.SendAsync(req);
            if (!res.IsSuccessStatusCode) { Hide(); return; }
            using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync());
            var root = doc.RootElement;
            _level = root.TryGetProperty("level", out var l) && l.TryGetInt32(out int n) ? Math.Clamp(n, 0, 4) : 0;
            // Réponse arrivée après la fin du jeu, ou surimpression coupée
            if (_level == 0 || !_gameInFront()) { Hide(); _fps.Clear(); return; }
            Paint(root);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException or InvalidOperationException) { Hide(); }
        finally { _busy = false; }
    }

    // ------------------------------------------------------------------ mesures
    private static double? Num(JsonElement o, string obj, string key) =>
        o.TryGetProperty(obj, out var p) && p.ValueKind == JsonValueKind.Object && p.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetDouble() : null;
    private static bool? Bool(JsonElement o, string obj, string key) =>
        o.TryGetProperty(obj, out var p) && p.ValueKind == JsonValueKind.Object && p.TryGetProperty(key, out var v) && v.ValueKind is JsonValueKind.True or JsonValueKind.False ? v.GetBoolean() : null;
    private static string F0(double v) => Math.Round(v).ToString("0", Fr);
    private static string F1(double v) => v.ToString("0.0", Fr);
    private static string Join(params string?[] parts) => string.Join(" · ", parts.Where(p => !string.IsNullOrEmpty(p)));

    private void Paint(JsonElement r)
    {
        double? fps = Num(r, "gpu", "fps"), gpuUse = Num(r, "gpu", "gpuUsage"), gpuTemp = Num(r, "gpu", "gpuTemp"),
            gpuPower = Num(r, "gpu", "gpuPower"), gpuClock = Num(r, "gpu", "gpuClock"),
            cpuLoad = Num(r, "live", "load"), cpuMhz = Num(r, "live", "mhz"), watts = Num(r, "live", "watts");
        bool discharging = Bool(r, "live", "discharging") == true;
        int? battery = null;
        if (GetSystemPowerStatus(out var ps) && ps.BatteryLifePercent <= 100 && (ps.BatteryFlag & 128) == 0) battery = ps.BatteryLifePercent;

        if (fps is double f) { _fps.Enqueue((int)Math.Round(f)); while (_fps.Count > HistorySize) _fps.Dequeue(); }
        string fpsText = fps is double v ? F0(v) : "—";
        string? bat = battery is int b ? $"{b} %" : null;
        string? drain = discharging && watts is double w ? $"{F1(w)} W" : null;

        Ensure();
        var rows = _rows!;
        rows.Children.Clear();
        switch (_level)
        {
            case 1:
                rows.Children.Add(Row(("FPS", fpsText)));
                break;
            case 2:
                rows.Children.Add(Row(("FPS", fpsText),
                    ("GPU", gpuUse is double g ? $"{F0(g)} %" : null),
                    ("CPU", cpuLoad is double c ? $"{F0(c)} %" : null),
                    (null, drain),
                    ("BAT", bat)));
                break;
            default:
                rows.Children.Add(Row(("FPS", fpsText)));
                rows.Children.Add(Row(("GPU", Join(gpuUse is double g3 ? $"{F0(g3)} %" : null, gpuTemp is double t ? $"{F0(t)} °C" : null,
                    gpuClock is double ck ? $"{F0(ck)} MHz" : null, gpuPower is double gp ? $"{F1(gp)} W" : null))));
                rows.Children.Add(Row(("CPU", Join(cpuLoad is double c3 ? $"{F0(c3)} %" : null, cpuMhz is double m ? $"{F1(m / 1000)} GHz" : null))));
                if (bat != null || drain != null) rows.Children.Add(Row(("BAT", Join(bat, drain ?? (discharging ? null : "⚡")))));
                if (_level == 4) rows.Children.Add(Graph());
                break;
        }
        Show();
    }

    // ------------------------------------------------------------------ dessin
    private static readonly Brush LabelBrush = Frozen(Color.FromRgb(0x8F, 0xD3, 0xFF));
    private static readonly Brush ValueBrush = Frozen(Colors.White);
    private static readonly Brush GraphBrush = Frozen(Color.FromRgb(0x5B, 0xE5, 0x8A));
    private static readonly Brush GridBrush = Frozen(Color.FromArgb(0x40, 0xFF, 0xFF, 0xFF));
    private static Brush Frozen(Color c) { var b = new SolidColorBrush(c); b.Freeze(); return b; }

    /// <summary>Une ligne de paires « LIBELLÉ valeur » ; les paires sans valeur sont omises.</summary>
    private static UIElement Row(params (string? Label, string? Value)[] pairs)
    {
        var text = new TextBlock { FontFamily = new FontFamily("Segoe UI"), FontSize = 13, FontWeight = FontWeights.SemiBold, Margin = new Thickness(0, 1, 0, 1) };
        bool first = true;
        foreach (var (label, value) in pairs)
        {
            if (string.IsNullOrEmpty(value)) continue;
            if (!first) text.Inlines.Add(new System.Windows.Documents.Run("   "));
            first = false;
            if (!string.IsNullOrEmpty(label)) text.Inlines.Add(new System.Windows.Documents.Run(label + " ") { Foreground = LabelBrush, FontSize = 11 });
            text.Inlines.Add(new System.Windows.Documents.Run(value) { Foreground = ValueBrush });
        }
        return text;
    }

    /// <summary>Images par seconde de la dernière minute, avec le plus bas et le plus haut.</summary>
    private UIElement Graph()
    {
        const double W = 180, H = 40;
        var panel = new StackPanel { Margin = new Thickness(0, 4, 0, 0) };
        var canvas = new Canvas { Width = W, Height = H, Background = Frozen(Color.FromArgb(0x26, 0xFF, 0xFF, 0xFF)) };
        canvas.Children.Add(new System.Windows.Shapes.Line { X1 = 0, X2 = W, Y1 = H / 2, Y2 = H / 2, Stroke = GridBrush, StrokeThickness = 1 });
        int[] values = _fps.ToArray();
        if (values.Length > 1)
        {
            int max = values.Max(), min = values.Min();
            // Échelle resserrée autour des valeurs (au moins 20 i/s de haut) : les baisses se voient
            double top = Math.Max(max + 5, min + 20), bottom = Math.Max(0, Math.Min(min - 5, top - 20));
            var line = new Polyline { Stroke = GraphBrush, StrokeThickness = 1.5, StrokeLineJoin = PenLineJoin.Round };
            for (int i = 0; i < values.Length; i++)
                line.Points.Add(new Point(W - (values.Length - 1 - i) * (W / (HistorySize - 1)), H - 2 - (H - 4) * (values[i] - bottom) / (top - bottom)));
            canvas.Children.Add(line);
            panel.Children.Add(canvas);
            panel.Children.Add(Row(("MIN", min.ToString(Fr)), ("MAX", max.ToString(Fr))));
        }
        else panel.Children.Add(canvas);
        return panel;
    }

    private void Ensure()
    {
        if (_window != null) return;
        _rows = new StackPanel();
        _window = new Window
        {
            SizeToContent = SizeToContent.WidthAndHeight,
            WindowStyle = WindowStyle.None, AllowsTransparency = true, Background = Brushes.Transparent,
            ShowInTaskbar = false, ShowActivated = false, Topmost = true, Focusable = false, IsHitTestVisible = false,
            Title = "KaneMode · Performances",
            Left = 12, Top = 12,
            Content = new Border
            {
                Background = Frozen(Color.FromArgb(0xB4, 0x0B, 0x0E, 0x14)),
                CornerRadius = new CornerRadius(6),
                Padding = new Thickness(10, 6, 10, 6),
                Child = _rows,
            },
        };
        _window.SourceInitialized += (_, _) =>
        {
            _hwnd = new WindowInteropHelper(_window).Handle;
            MakeInert();
            HwndSource.FromHwnd(_hwnd)?.AddHook((IntPtr h, int msg, IntPtr w, IntPtr l, ref bool handled) =>
            {
                if (msg == 0x0021 /* WM_MOUSEACTIVATE */) { handled = true; return new IntPtr(3 /* MA_NOACTIVATE */); }
                if (msg == 0x0084 /* WM_NCHITTEST */) { handled = true; return new IntPtr(-1 /* HTTRANSPARENT */); }
                return IntPtr.Zero;
            });
        };
    }

    private void Show()
    {
        if (_window == null || _preview) return;
        if (!_shown)
        {
            // Le jeu garde le premier plan (une fenêtre qui apparaît peut le prendre)
            IntPtr front = Native.GetForegroundWindow();
            _window.Show();
            MakeInert();
            if (Native.GetForegroundWindow() == _hwnd && front != IntPtr.Zero) Native.Activate(front);
            _shown = true;
            Log.Write($"Surimpression des performances affichée (niveau {_level})");
        }
        // Toujours au-dessus, y compris des fenêtres « toujours au-dessus » ouvertes après elle
        const uint NOMOVE = 0x2, NOSIZE = 0x1, NOACTIVATE = 0x10;
        if (_hwnd != IntPtr.Zero) SetWindowPos(_hwnd, new IntPtr(-1), 0, 0, 0, 0, NOMOVE | NOSIZE | NOACTIVATE);
    }

    private void Hide()
    {
        if (!_shown || _window == null) return;
        _window.Hide();
        _shown = false;
    }

    /// <summary>Transparente aux clics, sans activation, hors de Alt+Tab (WPF peut retoucher ces styles).</summary>
    private void MakeInert()
    {
        if (_hwnd == IntPtr.Zero) return;
        const long TRANSPARENT = 0x20, TOOLWINDOW = 0x80, LAYERED = 0x80000, NOACTIVATE = 0x8000000;
        long ex = (long)GetWindowLongPtr(_hwnd, -20);
        long want = ex | TRANSPARENT | TOOLWINDOW | LAYERED | NOACTIVATE;
        if (want != ex) SetWindowLongPtr(_hwnd, -20, new IntPtr(want));
    }

    /// <summary>
    /// Vérification sans écran : dessine la surimpression d'un niveau dans une image PNG, avec des mesures
    /// données en JSON (même forme que GET /api/overlay), sans rien afficher.
    /// </summary>
    public static void Preview(int level, string json, string png)
    {
        var o = new PerfOverlay(() => null, () => false) { _preview = true, _level = Math.Clamp(level, 1, 4) };
        o._timer.Stop();
        for (int i = 0; i < HistorySize - 1; i++) o._fps.Enqueue(52 + (int)(8 * Math.Sin(i / 5.0)));
        using (var doc = JsonDocument.Parse(json)) o.Paint(doc.RootElement);
        var content = (FrameworkElement)o._window!.Content;
        o._window.Content = null;
        content.Measure(new Size(double.PositiveInfinity, double.PositiveInfinity));
        content.Arrange(new Rect(content.DesiredSize));
        content.UpdateLayout();
        var bmp = new System.Windows.Media.Imaging.RenderTargetBitmap((int)Math.Ceiling(content.ActualWidth * 2), (int)Math.Ceiling(content.ActualHeight * 2), 192, 192, PixelFormats.Pbgra32);
        bmp.Render(content);
        var enc = new System.Windows.Media.Imaging.PngBitmapEncoder();
        enc.Frames.Add(System.Windows.Media.Imaging.BitmapFrame.Create(bmp));
        using var f = System.IO.File.Create(png);
        enc.Save(f);
        o._window.Close();
    }

    public void Dispose() { _timer.Stop(); Hide(); _window?.Close(); _window = null; _hwnd = IntPtr.Zero; }
}
