# Extraction d'icones haute resolution (256 px, avec transparence) via l'API Shell de Windows.
# - Dot-source : . .\icon.ps1  puis  Export-Icon <chemin> <dossier>
# - Direct     : icon.ps1 -Path <exe|lnk|shell:AppsFolder\...> -OutDir <dossier>  (affiche le PNG produit)
param([string]$Path, [string]$OutDir)

if (-not ('KaneMode.ShellIcon' -as [type])) {
    Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

namespace KaneMode {
    public static class ShellIcon {
        [ComImport, Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IShellItemImageFactory {
            [PreserveSig] int GetImage(NativeSize size, int flags, out IntPtr phbm);
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct NativeSize { public int cx; public int cy; }

        [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
        private static extern void SHCreateItemFromParsingName(string path, IntPtr pbc,
            [MarshalAs(UnmanagedType.LPStruct)] Guid riid, [MarshalAs(UnmanagedType.Interface)] out object ppv);

        [DllImport("gdi32.dll")]
        private static extern bool DeleteObject(IntPtr h);

        public static bool Save(string path, string outPng, int size) {
            object o;
            SHCreateItemFromParsingName(path, IntPtr.Zero, typeof(IShellItemImageFactory).GUID, out o);
            IShellItemImageFactory factory = (IShellItemImageFactory)o;
            NativeSize s; s.cx = size; s.cy = size;
            IntPtr hbm;
            if (factory.GetImage(s, 0x4 /* SIIGBF_ICONONLY */, out hbm) != 0 || hbm == IntPtr.Zero) return false;
            try {
                using (Bitmap src = Image.FromHbitmap(hbm)) {
                    bool is32 = src.PixelFormat == PixelFormat.Format32bppRgb || src.PixelFormat == PixelFormat.Format32bppArgb;
                    if (!is32) { src.Save(outPng, ImageFormat.Png); return true; }
                    Rectangle r = new Rectangle(0, 0, src.Width, src.Height);
                    BitmapData d = src.LockBits(r, ImageLockMode.ReadOnly, src.PixelFormat);
                    bool hasAlpha = false;
                    try {
                        // Le stride peut etre negatif (image stockee de bas en haut) : lecture ligne par ligne.
                        byte[] row = new byte[d.Width * 4];
                        for (int y = 0; y < d.Height && !hasAlpha; y++) {
                            Marshal.Copy(new IntPtr(d.Scan0.ToInt64() + (long)y * d.Stride), row, 0, row.Length);
                            for (int i = 3; i < row.Length; i += 4) { if (row[i] != 0) { hasAlpha = true; break; } }
                        }
                        if (hasAlpha) {
                            // FromHbitmap perd le canal alpha : on relit les pixels en ARGB premultiplie.
                            using (Bitmap wrap = new Bitmap(d.Width, d.Height, d.Stride, PixelFormat.Format32bppPArgb, d.Scan0))
                            using (Bitmap copy = new Bitmap(d.Width, d.Height, PixelFormat.Format32bppArgb)) {
                                using (Graphics g = Graphics.FromImage(copy)) g.DrawImage(wrap, new Rectangle(0, 0, d.Width, d.Height));
                                copy.Save(outPng, ImageFormat.Png);
                            }
                        }
                    } finally { src.UnlockBits(d); }
                    if (!hasAlpha) src.Save(outPng, ImageFormat.Png);
                }
            } finally { DeleteObject(hbm); }
            return true;
        }
    }
}
'@
}

function Export-Icon([string]$Source, [string]$Dir, [int]$Size = 256) {
    if (-not $Source) { return $null }
    $isShell = $Source -like 'shell:*'
    if (-not $isShell -and -not (Test-Path -LiteralPath $Source)) { return $null }
    $md5 = [Security.Cryptography.MD5]::Create()
    $hash = -join ($md5.ComputeHash([Text.Encoding]::UTF8.GetBytes($Source.ToLowerInvariant())) | ForEach-Object { $_.ToString('x2') })
    $out = Join-Path $Dir "$hash.png"
    if (Test-Path -LiteralPath $out) { return $out }
    if (-not (Test-Path -LiteralPath $Dir)) { New-Item -ItemType Directory -Force $Dir | Out-Null }
    try { if ([KaneMode.ShellIcon]::Save($Source, $out, $Size)) { return $out } } catch { }
    return $null
}

if ($Path -and $OutDir) { Export-Icon $Path $OutDir }
