$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$WarningPreference = 'SilentlyContinue'
$InformationPreference = 'SilentlyContinue'
$VerbosePreference = 'SilentlyContinue'
$DebugPreference = 'SilentlyContinue'
try {
    [Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false, $true)
    [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
    Add-Type -Path (Join-Path $PSScriptRoot 'voice-helper.cs') -ReferencedAssemblies 'System.Speech', 'System.Web.Extensions' -ErrorAction Stop
    exit [BackstageVoiceHelper]::Run()
} catch {
    # Only the bounded protocol is public. Host/compiler/device details stay private.
    exit 1
}
