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
public sealed class CursorOverlay
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

    /// <summary>Mode souris activé ou coupé.</summary>
    public void Set(bool on)
    {
        if (on == _on) return;
        _on = on;
        if (on) CompositionTarget.Rendering += Follow;
        else { CompositionTarget.Rendering -= Follow; Hide(); }
    }

    private void Follow(object? sender, EventArgs e)
    {
        var info = new CURSORINFO { Size = Marshal.SizeOf<CURSORINFO>() };
        if (!GetCursorInfo(ref info)) return;
        // Curseur de Windows visible (bureau) : pas de second curseur
        if ((info.Flags & 1 /* CURSOR_SHOWING */) != 0) { Hide(); return; }
        bool appear = !_shown;
        Ensure();
        if (appear || info.Pos.X != _last.X || info.Pos.Y != _last.Y)
        {
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
            if (!_shown) { _window.Show(); _shown = true; }
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
            // Transparente aux clics, sans activation, hors de Alt+Tab
            const long TRANSPARENT = 0x20, TOOLWINDOW = 0x80, LAYERED = 0x80000, NOACTIVATE = 0x8000000;
            long ex = (long)GetWindowLongPtr(_hwnd, -20);
            SetWindowLongPtr(_hwnd, -20, new IntPtr(ex | TRANSPARENT | TOOLWINDOW | LAYERED | NOACTIVATE));
        };
        _window.Show();
        _shown = true;
    }
}
