Set-Location "C:\Dyslexia_Detection_System"
python -m streamlit run app.py --server.port 8501 --server.address localhost --server.headless true *> streamlit.log
