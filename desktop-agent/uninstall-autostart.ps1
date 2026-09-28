# Removes the desktop agent's autostart task (Windows).
$ErrorActionPreference = 'Stop'
$taskName = 'AmIOnlineAgent'
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
Write-Host "Removed scheduled task '$taskName' (if it existed)."
