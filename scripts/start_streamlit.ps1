Set-Location (Resolve-Path "$PSScriptRoot\..")
python -m streamlit run app.py --server.port 8501 --server.address 0.0.0.0 --server.headless true *> streamlit.log
