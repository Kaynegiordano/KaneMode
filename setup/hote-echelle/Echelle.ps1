# Complément KaneMode pour le PC hôte (Sunshine) : mise à l'échelle de l'écran principal pendant le
# streaming. Les variantes « <appli> [150 %] » créées par Installer.ps1 l'appellent :
#   Echelle.ps1 -Debut -Pourcentage 150   au début de la session : note l'échelle actuelle, applique 150 %
#   Echelle.ps1 -Fin                      à la fin : remet l'échelle notée
#   Echelle.ps1 -Etat                     échelle actuelle et valeurs possibles
#   Echelle.ps1 -Valeur 125               applique tout de suite une échelle (essai)
# Même réglage que Paramètres > Affichage > Échelle, appliqué sans fermer la session
# (DisplayConfigSetDeviceInfo, comme l'outil SetDpi). Lancé par Sunshine dans la session de l'utilisateur.
param([switch]$Debut, [switch]$Fin, [switch]$Etat, [int]$Valeur = 0, [int]$Pourcentage = 0)

$ErrorActionPreference = 'Stop'
# Échelle d'origine et journal : dans le profil de l'utilisateur (le dossier du script, sous
# ProgramData, n'est pas modifiable sans droits d'administrateur)
$dossier = Join-Path $env:LOCALAPPDATA 'KaneMode\HoteEchelle'
New-Item -ItemType Directory -Force $dossier | Out-Null
$memoire = Join-Path $dossier 'avant-streaming.txt'
$journal = Join-Path $dossier 'journal.txt'
function Note($t) { Add-Content -Path $journal -Value ("{0:yyyy-MM-dd HH:mm:ss}  {1}" -f (Get-Date), $t) -Encoding UTF8 }

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class Echelle {
  [StructLayout(LayoutKind.Sequential)] struct LUID { public uint Low; public int High; }
  [StructLayout(LayoutKind.Sequential)] struct PathSource { public LUID adapterId; public uint id; public uint modeIdx; public uint flags; }
  [StructLayout(LayoutKind.Sequential)] struct PathTarget { public LUID adapterId; public uint id; public uint modeIdx; public uint tech; public uint rot; public uint scaling; public uint rrN; public uint rrD; public uint scanline; public int available; public uint flags; }
  [StructLayout(LayoutKind.Sequential)] struct PathInfo { public PathSource src; public PathTarget tgt; public uint flags; }
  [StructLayout(LayoutKind.Explicit, Size = 64)] struct ModeInfo {
    [FieldOffset(0)] public uint infoType; [FieldOffset(4)] public uint id; [FieldOffset(8)] public LUID adapterId;
    [FieldOffset(16)] public uint width; [FieldOffset(20)] public uint height; [FieldOffset(24)] public uint format;
    [FieldOffset(28)] public int x; [FieldOffset(32)] public int y;
  }
  [StructLayout(LayoutKind.Sequential)] struct Header { public int type; public uint size; public LUID adapterId; public uint id; }
  [StructLayout(LayoutKind.Sequential)] struct DpiGet { public Header h; public int minRel; public int curRel; public int maxRel; }
  [StructLayout(LayoutKind.Sequential)] struct DpiSet { public Header h; public int rel; }
  [DllImport("user32.dll")] static extern int GetDisplayConfigBufferSizes(uint flags, out uint paths, out uint modes);
  [DllImport("user32.dll")] static extern int QueryDisplayConfig(uint flags, ref uint np, [Out] PathInfo[] p, ref uint nm, [Out] ModeInfo[] m, IntPtr topo);
  [DllImport("user32.dll")] static extern int DisplayConfigGetDeviceInfo(ref DpiGet r);
  [DllImport("user32.dll")] static extern int DisplayConfigSetDeviceInfo(ref DpiSet r);

  // Valeurs proposées par Windows ; l'échelle est donnée par rapport à la valeur recommandée de l'écran
  public static readonly int[] Valeurs = { 100, 125, 150, 175, 200, 225, 250, 300, 350, 400, 450, 500 };

  // Source de l'écran principal : celle dont le mode commence en (0, 0)
  static Header Principal() {
    uint np, nm;
    if (GetDisplayConfigBufferSizes(2, out np, out nm) != 0) throw new Exception("Lecture des écrans impossible");
    var p = new PathInfo[np]; var m = new ModeInfo[nm];
    if (QueryDisplayConfig(2, ref np, p, ref nm, m, IntPtr.Zero) != 0) throw new Exception("Lecture des écrans impossible");
    for (int i = 0; i < np; i++) {
      uint k = p[i].src.modeIdx;
      if (k < nm && m[k].infoType == 1 && m[k].x == 0 && m[k].y == 0)
        return new Header { adapterId = p[i].src.adapterId, id = p[i].src.id };
    }
    if (np == 0) throw new Exception("Aucun écran actif");
    return new Header { adapterId = p[0].src.adapterId, id = p[0].src.id };
  }
  static DpiGet Lire(Header h) {
    var g = new DpiGet { h = h }; g.h.type = -3; g.h.size = (uint)Marshal.SizeOf(typeof(DpiGet));
    if (DisplayConfigGetDeviceInfo(ref g) != 0) throw new Exception("Échelle illisible");
    return g;
  }
  // [actuelle, minimum, maximum] en %
  public static int[] Etat() {
    var g = Lire(Principal()); int reco = -g.minRel;
    return new[] { Valeurs[reco + g.curRel], Valeurs[0], Valeurs[Math.Min(Valeurs.Length - 1, reco + g.maxRel)] };
  }
  public static int Appliquer(int pct) {
    var h = Principal(); var g = Lire(h); int reco = -g.minRel;
    int idx = Array.IndexOf(Valeurs, pct);
    if (idx < 0) throw new Exception("Échelle non proposée par Windows : " + pct + " %");
    int rel = Math.Max(g.minRel, Math.Min(g.maxRel, idx - reco));
    var s = new DpiSet { h = h, rel = rel }; s.h.type = -4; s.h.size = (uint)Marshal.SizeOf(typeof(DpiSet));
    int r = DisplayConfigSetDeviceInfo(ref s);
    if (r != 0) throw new Exception("Windows a refusé l'échelle (code " + r + ")");
    return Valeurs[reco + rel];
  }
}
'@

try {
    if ($Etat) {
        $e = [Echelle]::Etat()
        "Échelle actuelle : $($e[0]) %  (possible : $($e[1]) à $($e[2]) %)"
    }
    elseif ($Valeur) { "Échelle : $([Echelle]::Appliquer($Valeur)) %" }
    elseif ($Debut) {
        $avant = [Echelle]::Etat()[0]
        # Une session précédente coupée net (plantage, coupure) : on garde l'échelle d'origine déjà notée
        if (-not (Test-Path $memoire)) { Set-Content -Path $memoire -Value $avant -Encoding ASCII }
        if ($Pourcentage -and $Pourcentage -ne $avant) { $r = [Echelle]::Appliquer($Pourcentage); Note "Début du streaming : $avant % -> $r %" }
        else { Note "Début du streaming : échelle déjà à $avant %" }
    }
    elseif ($Fin) {
        if (Test-Path $memoire) {
            $avant = [int](Get-Content $memoire -Raw)
            $r = [Echelle]::Appliquer($avant)
            Remove-Item $memoire -Force
            Note "Fin du streaming : retour à $r %"
        }
    }
    else { Get-Help $PSCommandPath; 'Utiliser -Debut, -Fin, -Etat ou -Valeur <pourcentage>' }
} catch {
    Note "Erreur : $($_.Exception.Message)"
    throw
}
