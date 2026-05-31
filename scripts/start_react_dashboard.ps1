Set-Location (Resolve-Path "$PSScriptRoot\..")

Start-Process -WindowStyle Hidden -FilePath powershell -ArgumentList @(
  "-NoProfile",
  "-Command",
  "Set-Location 'C:\Dyslexia_Detection_System'; python dashboard_web.py"
)

Set-Location ".\frontend"
npm install
npm run dev
