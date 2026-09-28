using System.IO;

namespace KaneMode;

/// <summary>Journal simple dans %LOCALAPPDATA%\KaneMode\logs\kanemode.log.</summary>
public static class Log
{
    private static readonly object Gate = new();

    public static string FilePath => Path.Combine(Paths.Logs, "kanemode.log");

    public static void Write(string message)
    {
        try
        {
            lock (Gate)
            {
                Directory.CreateDirectory(Paths.Logs);
                var info = new FileInfo(FilePath);
                if (info.Exists && info.Length > 2_000_000) info.MoveTo(FilePath + ".old", overwrite: true);
                File.AppendAllText(FilePath, $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] {message}{Environment.NewLine}");
            }
        }
        catch (IOException) { /* le journal ne doit jamais bloquer l'app */ }
        catch (UnauthorizedAccessException) { }
    }
}
