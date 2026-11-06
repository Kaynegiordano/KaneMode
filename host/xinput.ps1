# Manettes XInput branchées (ROG Ally, manette Xbox…) : emplacement, vendeur, produit, version et
# sous-type, lus comme SDL les lit (XInputGetCapabilitiesEx, ordinal 108 de xinput1_4.dll). KaneMode
# en tire l'identifiant SDL de la manette pour régler Eden et Lichii avant un lancement.
# Sortie : JSON [{ user, vid, pid, ver, sub }] (liste vide sans manette).
$ErrorActionPreference = 'Stop'
try {
  Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
public static class KaneXInput {
  [StructLayout(LayoutKind.Sequential)]
  public struct CapsEx {
    public byte Type, SubType; public ushort Flags;
    public ushort wButtons; public byte lt, rt; public short lx, ly, rx, ry;
    public ushort vl, vr;
    public ushort VendorId, ProductId, ProductVersion, unk1; public uint unk2;
  }
  [DllImport("xinput1_4.dll", EntryPoint = "#108")]
  public static extern uint GetCapsEx(uint one, uint user, uint flags, out CapsEx caps);
}
'@
  $pads = @()
  foreach ($u in 0..3) {
    $c = New-Object KaneXInput+CapsEx
    if ([KaneXInput]::GetCapsEx(1, $u, 0, [ref]$c) -ne 0) { continue }
    $vid = [int]$c.VendorId; $prod = [int]$c.ProductId
    # Manette Xbox 360 sans fil : SDL corrige le produit manquant de la même façon
    if ($prod -eq 0 -and ($c.Flags -band 0x0002)) { $vid = 0x045E; $prod = 0x028E }
    $pads += [pscustomobject]@{ user = $u; vid = $vid; pid = $prod; ver = [int]$c.ProductVersion; sub = [int]$c.SubType }
  }
  ConvertTo-Json -InputObject @($pads) -Compress
} catch { '[]' }
