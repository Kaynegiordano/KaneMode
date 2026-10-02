using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;

namespace KaneMode;

/// <summary>
/// Curseur dessiné par KaneMode pendant le mode souris, quand Windows n'affiche pas le sien : en mode
/// Xbox (expérience plein écran) sur la ROG Ally, le mode souris s'activait mais sans aucun curseur,
/// donc inutilisable. Fenêtre minuscule, toujours au-dessus, transparente aux clics, qui suit la
/// position de la souris à chaque image.
/// </summary>
public sealed class CursorOverlay : IDisposable
{
    [StructLayout(LayoutKind.Sequential)]
    private struct POINT { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)]
    private struct CURSORINFO { public int Size; public int Flags; public IntPtr Cursor; public POINT Pos; }
    [DllImport("user32.dll")]
    private static extern bool GetCursorInfo(ref CURSORINFO info);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")]
    private static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int index);
    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")]
    private static extern IntPtr SetWindowLongPtr(IntPtr hWnd, int index, IntPtr value);
    [DllImport("user32.dll")]
    private static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);

    private Window? _window;
    private IntPtr _hwnd;
    private bool _on, _shown;
    private POINT _last = new() { X = int.MinValue };
    private IntPtr _lastFront;
    private long _desktopChecked;
    private bool _interactive = true;
    private readonly System.Windows.Threading.DispatcherTimer _timer = new() { Interval = TimeSpan.FromMilliseconds(16) };

    public CursorOverlay() { _timer.Tick += Follow; }

    /// <summary>Mode souris activé ou coupé.</summary>
    public void Set(bool on)
    {
        if (on == _on) return;
        _on = on;
        if (on) { Follow(null, EventArgs.Empty); _timer.Start(); }
        else { _timer.Stop(); Hide(); }
    }

    private void Follow(object? sender, EventArgs e)
    {
        var info = new CURSORINFO { Size = Marshal.SizeOf<CURSORINFO>() };
        long now = Environment.TickCount64;
        if (now - _desktopChecked >= 250) { _desktopChecked = now; _interactive = Native.InteractiveDesktop(); }
        if (!_interactive || !GetCursorInfo(ref info)) { Hide(); return; }
        // Curseur de Windows visible (bureau) : pas de second curseur
        if ((info.Flags & 1 /* CURSOR_SHOWING */) != 0) { Hide(); return; }
        bool appear = !_shown;
        Ensure();
        IntPtr front = Native.GetForegroundWindow();
        if (appear || front != _lastFront || info.Pos.X != _last.X || info.Pos.Y != _last.Y)
        {
            _lastFront = front;
            _last = info.Pos;
            const uint NOSIZE = 0x1, NOACTIVATE = 0x10;
            // Toujours au-dessus (HWND_TOPMOST), à la position exacte en pixels de l'écran
            SetWindowPos(_hwnd, new IntPtr(-1), info.Pos.X, info.Pos.Y, 0, 0, NOSIZE | NOACTIVATE);
        }
    }

    private void Hide()
    {
        if (!_shown || _window == null) return;
        _window.Hide();
        _shown = false;
    }

    private void Ensure()
    {
        if (_window != null)
        {
            if (!_shown)
            {
                IntPtr front = Native.GetForegroundWindow();
                _window.Show();
                MakeInert();
                if (Native.GetForegroundWindow() == _hwnd && front != IntPtr.Zero) Native.Activate(front);
                _shown = true;
            }
            return;
        }
        // Flèche blanche bordée de noir, pointe en haut à gauche (le point cliqué)
        var arrow = new System.Windows.Shapes.Path
        {
            Data = Geometry.Parse("M1,1 L1,19 L5.5,14.5 L8.5,21.5 L11.5,20.2 L8.6,13.3 L14.8,13.3 Z"),
            Fill = Brushes.White,
            Stroke = Brushes.Black,
            StrokeThickness = 1.3,
            StrokeLineJoin = PenLineJoin.Round,
        };
        _window = new Window
        {
            Width = 24, Height = 26,
            WindowStyle = WindowStyle.None, AllowsTransparency = true, Background = Brushes.Transparent,
            ShowInTaskbar = false, ShowActivated = false, Topmost = true, Focusable = false, IsHitTestVisible = false,
            Title = "KaneMode · Curseur",
            Content = arrow,
        };
        _window.SourceInitialized += (_, _) =>
        {
            _hwnd = new WindowInteropHelper(_window).Handle;
            MakeInert();
            // Jamais activée, jamais touchée par la souris (les clics passent à la fenêtre dessous)
            HwndSource.FromHwnd(_hwnd)?.AddHook((IntPtr h, int msg, IntPtr w, IntPtr l, ref bool handled) =>
            {
                if (msg == 0x0021 /* WM_MOUSEACTIVATE */) { handled = true; return new IntPtr(3 /* MA_NOACTIVATE */); }
                if (msg == 0x0084 /* WM_NCHITTEST */) { handled = true; return new IntPtr(-1 /* HTTRANSPARENT */); }
                return IntPtr.Zero;
            });
        };
        // En 2.2.0, la fenêtre du curseur prenait le premier plan en apparaissant : on le rend
        IntPtr before = Native.GetForegroundWindow();
        _window.Show();
        MakeInert();
        if (Native.GetForegroundWindow() == _hwnd && before != IntPtr.Zero) Native.Activate(before);
        _shown = true;
    }

    /// <summary>Transparente aux clics, sans activation, hors de Alt+Tab (WPF peut retoucher ces styles).</summary>
    private void MakeInert()
    {
        const long TRANSPARENT = 0x20, TOOLWINDOW = 0x80, LAYERED = 0x80000, NOACTIVATE = 0x8000000;
        long ex = (long)GetWindowLongPtr(_hwnd, -20);
        long want = ex | TRANSPARENT | TOOLWINDOW | LAYERED | NOACTIVATE;
        if (want != ex) SetWindowLongPtr(_hwnd, -20, new IntPtr(want));
    }
    public void Dispose() { Set(false); _window?.Close(); _window = null; _hwnd = IntPtr.Zero; }
}
