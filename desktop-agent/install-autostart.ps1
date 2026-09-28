# Installs the desktop agent to start automatically at logon (Windows).
# Run from this folder:  powershell -ExecutionPolicy Bypass -File .\install-autostart.ps1

$ErrorActionPreference = 'Stop'
$taskName = 'AmIOnlineAgent'
$vbs = Join-Path $PSScriptRoot 'start-hidden.vbs'

if (-not (Test-Path $vbs)) { throw "start-hidden.vbs not found next to this script." }

$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$vbs`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Host "Installed scheduled task '$taskName'. It will run at logon and is running now."
Write-Host "Logs: $(Join-Path $PSScriptRoot 'agent.log')"
