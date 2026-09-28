' Launches the Am-I-Online desktop agent with no visible window.
' Used by install-autostart.ps1 (scheduled task at logon).
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
sh.CurrentDirectory = fso.GetParentFolderName(WScript.ScriptFullName)
sh.Run "cmd /c node agent.js >> agent.log 2>&1", 0, False
