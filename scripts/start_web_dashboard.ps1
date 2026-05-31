Set-Location (Resolve-Path "$PSScriptRoot\..")
python -m http.server 8080 --directory web
