$ErrorActionPreference = 'Stop'
$taskOutput = Join-Path $PSScriptRoot 'obj\bridge'
dotnet build (Join-Path $PSScriptRoot 'KaneMode.LibraryBridge.csproj') -c Release --nologo -v quiet
if ($LASTEXITCODE -ne 0) { throw 'Echec de compilation de la passerelle de bibliotheques' }
New-Item -ItemType Directory -Path $taskOutput -Force | Out-Null
# Playnite fournit son SDK : il ne faut pas en charger une deuxieme copie.
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'bin\Release\net462\KaneMode.LibraryBridge.dll') -Destination $taskOutput
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'extension.yaml') -Destination $taskOutput
