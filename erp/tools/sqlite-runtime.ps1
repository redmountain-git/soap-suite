param(
    [Parameter(Mandatory)][ValidateSet('Stage','Enable')][string]$Action,
    [Parameter(Mandatory)][string]$Runtime,
    [string]$Database
)
$ErrorActionPreference = 'Stop'
function PrivatePath([string]$path) {
    if (![IO.Path]::IsPathFullyQualified($path)) { throw 'Expected an absolute path.' }
    $full = [IO.Path]::GetFullPath($path)
    for ($d = [IO.DirectoryInfo]$full; $null -ne $d; $d = $d.Parent) {
        if (Test-Path -LiteralPath (Join-Path $d.FullName '.git')) { throw 'Choose a path outside Git.' }
        if ($d.Exists -and ($d.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Use a physical directory, not a junction.' }
    }
    return $full
}
$Runtime = PrivatePath $Runtime
$erp = Split-Path $PSScriptRoot
$node = Join-Path $Runtime 'node.exe'
$api = Join-Path $Runtime 'cli.cjs'
if ($Action -eq 'Stage') {
    $source = Join-Path $erp 'dist/apps/operations/browser'
    $entry = Join-Path $erp 'dist/apps/workspace-api/cli.mjs'
    if (!(Test-Path "$source/index.html") -or !(Test-Path $entry)) { throw 'Build Operations and workspace-api first.' }
    $engine = & node -p "Number(process.versions.node.split('.')[0]) === 24 ? process.execPath : ''"
    if (!$engine) { throw 'Select Node 24 before staging.' }
    if (Test-Path -LiteralPath $Runtime) { throw 'Choose a new runtime directory.' }
    New-Item -ItemType Directory -Path $Runtime | Out-Null
    Copy-Item -LiteralPath $engine -Destination $node
    $dist = New-Item -ItemType Directory -Path (Join-Path $Runtime 'dist/apps/operations') -Force
    Copy-Item -LiteralPath $source -Destination $dist.FullName -Recurse
    & (Join-Path $erp 'node_modules/.bin/esbuild.cmd') $entry --platform=node --target=node24 --format=cjs --bundle "--outfile=$api"
    if ($LASTEXITCODE) { throw 'API packaging failed. Do not enable this runtime.' }
    return
}
$Database = PrivatePath $Database
if (!(Test-Path -LiteralPath $Database -PathType Leaf) -or !(Test-Path -LiteralPath $api) -or !(Test-Path -LiteralPath $node)) { throw 'Missing installed runtime or verified database.' }
$name = 'Red Mountain Soap Operations'
if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) { throw 'Task already exists; do not overwrite an active installation.' }
if (Get-NetTCPConnection -LocalPort 4350 -State Listen -ErrorAction SilentlyContinue) { throw 'Port 4350 is already in use.' }
$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$run = New-ScheduledTaskAction -Execute "$env:SystemRoot/System32/conhost.exe" -Argument ('--headless "{0}" "{1}" serve "{2}" 4350' -f $node,$api,$Database) -WorkingDirectory $Runtime
$atLogin = New-ScheduledTaskTrigger -AtLogOn -User $user
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -Hidden -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -StartWhenAvailable
Register-ScheduledTask -TaskName $name -Action $run -Trigger $atLogin -Principal $principal -Settings $settings | Out-Null
Start-ScheduledTask -TaskName $name
