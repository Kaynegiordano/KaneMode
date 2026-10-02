using System.Runtime.InteropServices;
namespace KaneMode;
internal static class Log { public static void Write(string message) => Console.WriteLine(message); }
internal static class Program
{
    [StructLayout(LayoutKind.Sequential)] private struct Point { public int X, Y; }
    [DllImport("user32.dll")] private static extern bool GetCursorPos(out Point point);
    public static int Main()
    {
        if (!OperatingSystem.IsWindows()) return 2;
        bool desktop = Native.InteractiveDesktop();
        bool beforeOk = GetCursorPos(out var before);
        // Appel de production réel, déplacement nul : ni clic, ni touche, ni changement de fenêtre.
        bool accepted = Native.Mouse(Native.MOUSE_MOVE, 0, 0);
        int error = Marshal.GetLastWin32Error();
        bool afterOk = GetCursorPos(out var after);
        Console.WriteLine($"Bureau interactif : {desktop}; SendInput accepté : {accepted}; erreur Win32 : {error}");
        bool stable = beforeOk && afterOk && before.X == after.X && before.Y == after.Y;
        Console.WriteLine($"Position conservée : {stable}");
        return desktop && accepted && stable ? 0 : 1;
    }
}
