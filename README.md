# Dyslexia Detection System

An early-stage, multimodal deep learning system for dyslexia screening and end-user assistance, with emphasis on Bengali, multilingual, and low-resource settings.

For a fuller project walkthrough, see [docs/PROJECT_DOCUMENTATION.md](/d:/Project/Dyslexia_Detection_System/docs/PROJECT_DOCUMENTATION.md).

For a paper-style draft based on the current implementation, see [docs/RESEARCH_PAPER_DRAFT.md](/d:/Project/Dyslexia_Detection_System/docs/RESEARCH_PAPER_DRAFT.md).

For a 28-slide presentation deck for demonstrations, see [docs/Dyslexia_Detection_System_Demo_Deck.pptx](/d:/Project/Dyslexia_Detection_System/docs/Dyslexia_Detection_System_Demo_Deck.pptx).

The codebase supports handwriting images, reading audio features, multilingual text samples, reading-behavior indicators, explainability hooks, and lightweight deployment through a local Streamlit dashboard.

For full web deployment, see [docs/DEPLOYMENT.md](/d:/Project/Dyslexia_Detection_System/docs/DEPLOYMENT.md).

For ready-to-upload biomarker test CSVs, see [docs/BIOMARKER_TEST_DATA.md](/d:/Project/Dyslexia_Detection_System/docs/BIOMARKER_TEST_DATA.md).

Live demo: [https://learning-disorder-intelligence.onrender.com/](https://learning-disorder-intelligence.onrender.com/)

Release notes: [RELEASE_NOTES.md](/d:/Project/Dyslexia_Detection_System/RELEASE_NOTES.md)

### Web Deployment Checklist

1. Push the latest `main` branch to GitHub.
2. Choose one host: Render, Railway, or Fly.io.
3. Use the matching config file from [`render.yaml`](/d:/Project/Dyslexia_Detection_System/render.yaml), [`railway.json`](/d:/Project/Dyslexia_Detection_System/railway.json), or [`fly.toml`](/d:/Project/Dyslexia_Detection_System/fly.toml).
4. Ensure the service exposes port `10000` and serves `/healthz`.
5. Open the public HTTPS URL and verify the microphone flow in the browser.
6. If transcription is slow on the first request, wait for Whisper to finish loading the model.

### Render Auto-Deploy Notes

The Render setup in this repository is configured for automatic deploys:

- `render.yaml` sets `autoDeploy: true`
- the container listens on port `10000`
- the health check path is `/healthz`

That means a push to the connected GitHub branch, usually `main`, should trigger a fresh Render build automatically if the Render service is already linked to this repo.

If the site does not refresh after a push, check these Render settings:

1. The service is connected to `archisman-das/Learning-Disorder-Intelligence`
2. The deploy branch is `main`
3. Auto-deploy is enabled in the Render dashboard
4. The latest build did not fail during image build or health check

## At A Glance

| Area | Summary |
|---|---|
| Core goal | Multimodal dyslexia screening and educational support |
| Main languages | Bengali, English, multilingual |
| Primary inputs | Handwriting, audio, text, behavior, eye-tracking, biomarker CSVs |
| Main outputs | Screening labels, therapy scores, reports, local records, biomarker rankings |
| Main UIs | Streamlit dashboard, local web dashboard, React frontend |
| Deployment style | Local-first, offline-friendly, research-friendly |

## Dashboard Surfaces

| Surface | Entry point | Best for | Notes |
|---|---|---|---|
| Streamlit dashboard | [`app.py`](/d:/Project/Dyslexia_Detection_System/app.py) | Dataset review, model experimentation, live screening, reports | Broadest feature coverage |
| Standalone web dashboard | [`run_local_web.py`](/d:/Project/Dyslexia_Detection_System/run_local_web.py) + [`web/`](/d:/Project/Dyslexia_Detection_System/web) | Browser-only local use, records, microphone-based workflows | Runs on `localhost:8080` |
| React frontend | [`frontend/src/App.jsx`](/d:/Project/Dyslexia_Detection_System/frontend/src/App.jsx) | Vite-based interface work | Separate UI path |

## Model Families

| Model family | Purpose | Strength | Limitation |
|---|---|---|---|
| `InitialCNNModel` | Compact image/audio baseline | Very lightweight | Ignores text and behavior |
| `InitialLSTMModel` | Text-centered baseline | Simple sequence modeling | Ignores image and audio |
| `InitialCNNLSTMModel` | Early multimodal baseline | Covers more signals | Still shallow |
| `MultimodalDyslexiaModel` | Default screening model | Balanced and practical | Uses concatenation fusion |
| `TransformerMultimodalModel` | Transformer text branch | Better context modeling | Heavier than GRU version |
| `ViTMultimodalModel` | Patch-based handwriting branch | Better image structure modeling | More compute |
| `AttentionMultimodalModel` | Learned modality weights | Better interpretability | More tuning-sensitive |
| `BengaliLearningDisorderFoundationModel` | Shared foundation encoder | Reusable across tasks | Needs more data and pretraining |

## Screenshot Slots

This repository does not currently ship captured dashboard screenshots. If you want to add them later, place the image files here and reference them in this README:

| Suggested file | Dashboard view |
|---|---|
| [`docs/screenshots/streamlit-dashboard.png`](/d:/Project/Dyslexia_Detection_System/docs/screenshots/streamlit-dashboard.png) | Main Streamlit dashboard |
| [`docs/screenshots/web-dashboard.png`](/d:/Project/Dyslexia_Detection_System/docs/screenshots/web-dashboard.png) | Local browser dashboard |
| [`docs/screenshots/react-dashboard.png`](/d:/Project/Dyslexia_Detection_System/docs/screenshots/react-dashboard.png) | React/Vite frontend |

For now, the architecture and feature tables below give a reliable text reference until real captures are added.

## Features

- Bengali, English, and multilingual dataset manifest support
- Handwriting image preprocessing and augmentation
- Reading-audio log-spectrogram extraction
- Language-aware text normalization and character-level tokenization
- Reading-behavior features for timing, hesitation, repetition, and omission patterns
- Multimodal PyTorch model for dyslexia-risk screening
- Grad-CAM utility for handwriting explainability
- Multilingual speech-therapy exercise tracking and adaptive recommendations
- Reinforcement learning-based adaptive tutoring with persistent policy updates
- Personalized intervention recommendation system for reading, pronunciation, and spelling exercises
- Attention-based multimodal fusion with per-prediction modality importance scores
- Digital biomarker discovery for handwriting, speech, and reading behavior signals
- Bengali eye-tracking dataset collection with fixation/regression/gaze biometrics
- Demo dataset generator for smoke testing
- Offline-friendly Streamlit visualization dashboard

## Project Structure

```text
.
|-- app.py
|-- requirements.txt
|-- scripts/
|   |-- create_demo_dataset.py
|   |-- start_streamlit.ps1
|-- src/
|   |-- dyslexia_detection/
|       |-- config.py
|       |-- dataset.py
|       |-- explainability.py
|       |-- models.py
|       |-- preprocessing.py
|       |-- schemas.py
|       |-- train.py
```

## Dataset Manifest

Training data is described with a CSV manifest. Each row represents one anonymized user sample.

```csv
sample_id,student_hash,handwriting_path,audio_path,text_sample,spelling_errors,pronunciation_errors,reading_time_seconds,hesitation_count,repetition_count,omission_count,label
S001,anon_001,handwriting/S001.png,audio/S001.wav,ami bangla pori,2,1,30.0,3,2,1,1
```

Labels:

- `0`: low risk
- `1`: moderate/high risk

Required columns:

- `sample_id`
- `student_hash`
- `handwriting_path`
- `audio_path`
- `text_sample`
- `spelling_errors`
- `pronunciation_errors`
- `label`

Recommended behavior columns:

- `reading_time_seconds`
- `hesitation_count`
- `repetition_count`
- `omission_count`

Only anonymized identifiers should be stored. Do not store names, phone numbers, school IDs, or addresses in the manifest.

## Dataset Creation Workflow

Create the collection workspace:

```powershell
python scripts/setup_dataset_workspace.py --root data/collection
```

This creates folders for raw handwriting, raw audio, augmented files, split manifests, and a collection protocol document.

Gather one handwriting/text/audio sample from the command line:

```powershell
python scripts/add_sample_to_manifest.py --workspace data/collection --sample-id S001 --student-hash anon_001 --handwriting-file path/to/handwriting.png --audio-file path/to/reading.wav --text-sample "ami bangla pori" --spelling-errors 1 --pronunciation-errors 1 --reading-time-seconds 28.5 --hesitation-count 2 --repetition-count 1 --omission-count 0 --label 1
```

You can also use the dashboard's `Sample Collection` tab to upload handwriting and audio files, choose the sample language, enter text and reading observations, and append the row directly into `data/collection/manifest.csv`.

Create a blank manifest template:

```powershell
python scripts/create_collection_template.py --output data/collection/manifest_template.csv
```

Validate collected data:

```powershell
python scripts/validate_manifest.py --manifest data/collection/manifest.csv
```

Clean, normalize, augment, and split the collected dataset:

```powershell
python scripts/prepare_collected_dataset.py --manifest data/collection/manifest.csv --output-root data/collection/processed --split
```

This pipeline:

- cleans duplicate or malformed manifest rows
- normalizes text whitespace with language-aware Unicode handling
- standardizes numeric error and behavior fields
- normalizes handwriting images to fixed grayscale canvas size
- normalizes reading audio to 16 kHz WAV with trimmed silence and consistent volume
- creates handwriting and audio augmentations
- writes a final `prepared_manifest.csv`
- optionally writes train/validation/test splits

Anonymize user identifiers before training:

```powershell
python scripts/anonymize_manifest.py --input data/collection/manifest.csv --output data/collection/manifest_anonymized.csv --salt YOUR_PRIVATE_SALT
```

Create handwriting augmentation:

```powershell
python scripts/augment_handwriting_dataset.py --manifest data/collection/manifest_anonymized.csv --output-manifest data/collection/augmented_manifest.csv
```

Create reading-audio augmentation:

```powershell
python scripts/augment_audio_dataset.py --manifest data/collection/augmented_manifest.csv --output-manifest data/collection/audio_augmented_manifest.csv
```

Create train/validation/test splits:

```powershell
python scripts/split_manifest.py --manifest data/collection/audio_augmented_manifest.csv --output-dir data/collection/splits
```

The dashboard's `Dataset Creation` tab shows the required schema, current validation status, and basic quality metrics.

## Quick Start

Create a demo dataset:

```powershell
python scripts/create_demo_dataset.py
```

Train a small model:

```powershell
python -m src.dyslexia_detection.train --manifest data/demo/manifest.csv --epochs 2
```

Discover digital biomarkers associated with dyslexia:

```powershell
python scripts/discover_biomarkers.py --manifest data/demo/audio_augmented_manifest.csv --output-dir reports/biomarkers --top-k 15
```

Collect Bengali eye-tracking dataset from webcam:

```powershell
python scripts/collect_eye_tracking_webcam.py --sample-id ET001 --participant-hash anon_user_001 --language Bengali --prompt "আমি বাংলা পড়ি" --word-count 4 --output-dir data/collection/eye_tracking --max-seconds 45
```

This writes:

- `data/collection/eye_tracking/ET001_gaze_trace.csv`
- `data/collection/eye_tracking/eye_tracking_metrics.csv`

with fixation duration, regressions, reading speed, and gaze-pattern features.

Train the initial CNN/LSTM baseline:

```powershell
python scripts/train_initial_cnn_lstm.py --manifest data/demo/audio_augmented_manifest.csv --epochs 5 --batch-size 8
```

Train all initial baselines, CNN-only, LSTM-only, and CNN/LSTM:

```powershell
python scripts/train_initial_models.py --manifest data/demo/audio_augmented_manifest.csv --epochs 5 --batch-size 8
```

Train Transformer, ViT, and ViT+Transformer multimodal models:

```powershell
python scripts/train_advanced_models.py --manifest data/demo/audio_augmented_manifest.csv --epochs 3 --batch-size 8
```

Train every supported model family in one pass:

```powershell
python scripts/train_all_models.py --manifest data/demo/audio_augmented_manifest.csv --epochs 5 --batch-size 8 --text-language multilingual
```

For best results, point `--manifest` at your largest cleaned and anonymized labeled dataset. More real samples usually helps accuracy and makes confidence values more reliable.

Train attention-based multimodal fusion:

```powershell
python -m src.dyslexia_detection.train --manifest data/demo/audio_augmented_manifest.csv --model multimodal_attention --epochs 5 --text-language multilingual --checkpoint-dir checkpoints/multimodal_attention
```

Pretrain Bengali multimodal learning-disorder foundation model:

```powershell
python scripts/train_foundation_model.py --manifest data/demo/audio_augmented_manifest.csv --epochs 5 --batch-size 8 --text-language bengali --checkpoint checkpoints/foundation/bengali_foundation.pt
```

Fine-tune disorder-specific adapter (dyslexia / dysgraphia / dyscalculia):

```powershell
python scripts/fine_tune_foundation_adapter.py --manifest data/demo/audio_augmented_manifest.csv --foundation-checkpoint checkpoints/foundation/bengali_foundation.pt --disorder dyslexia --epochs 4 --batch-size 8 --freeze-foundation
```

Train with a multilingual text vocabulary for mixed-language manifests:

```powershell
python -m src.dyslexia_detection.train --manifest data/collection/processed/prepared_manifest.csv --model vit_transformer --text-language multilingual --epochs 5
```

Train severity-level models (Mild, Moderate, Severe):

```powershell
python scripts/train_severity_models.py --manifest data/demo/audio_augmented_manifest.csv --model vit_transformer --task severity --epochs 5 --text-language multilingual
```

Cross-lingual transfer learning (English -> Bengali):

```powershell
python scripts/train_cross_lingual_transfer.py --manifest data/collection/processed/prepared_manifest.csv --english-checkpoint checkpoints/english_vit_transformer/best_model.pt --model vit_transformer --task severity --text-language bengali --epochs 5 --checkpoint-dir checkpoints/cross_lingual_bengali
```

This transfers shared handwriting/audio/behavior/classifier knowledge from an English checkpoint, then fine-tunes on Bengali data with optional feature-level distillation for low-resource settings.

Train continuous severity regression:

```powershell
python scripts/train_severity_models.py --manifest data/demo/audio_augmented_manifest.csv --model vit_transformer --task regression --epochs 5 --text-language multilingual
```

Self-supervised Bengali audio representation learning (contrastive):

```powershell
python scripts/pretrain_bengali_ssl.py --manifest data/demo/audio_augmented_manifest.csv --objective contrastive --epochs 5 --output checkpoints/ssl/audio_contrastive.pt
```

Self-supervised masked modeling:

```powershell
python scripts/pretrain_bengali_ssl.py --manifest data/demo/audio_augmented_manifest.csv --objective masked --epochs 5 --output checkpoints/ssl/audio_masked.pt
```

Teacher-distillation with wav2vec2 or HuBERT:

```powershell
python scripts/pretrain_bengali_ssl.py --manifest data/demo/audio_augmented_manifest.csv --objective wav2vec2 --teacher-model facebook/wav2vec2-base-960h --epochs 3 --output checkpoints/ssl/audio_wav2vec2.pt
python scripts/pretrain_bengali_ssl.py --manifest data/demo/audio_augmented_manifest.csv --objective hubert --teacher-model facebook/hubert-base-ls960 --epochs 3 --output checkpoints/ssl/audio_hubert.pt
```

Fine-tune dyslexia model from SSL audio encoder:

```powershell
python scripts/fine_tune_from_ssl.py --manifest data/demo/audio_augmented_manifest.csv --ssl-checkpoint checkpoints/ssl/audio_contrastive.pt --model vit_transformer --task severity --epochs 5 --text-language multilingual --checkpoint-dir checkpoints/severity_from_ssl
```

Or call the shared trainer directly:

```powershell
python -m src.dyslexia_detection.train --manifest data/demo/audio_augmented_manifest.csv --model cnn_lstm --epochs 5 --batch-size 8 --checkpoint-dir checkpoints/cnn_lstm
```

Run the dashboard:

```powershell
python -m streamlit run app.py --server.port 8501 --server.address localhost
```

The dashboard includes dataset overview charts, sample inspection, model metrics, prediction analytics, reading-behavior visualization, and live screening.

Run the practical mobile/web prototype:

```powershell
python -m streamlit run prototype_app.py --server.port 8502 --server.address localhost
```

The prototype includes quick screening, webcam capture analysis, sample collection, guided practice, speech-therapy support, and local record review. It uses `exports/deployment/pruned_30_quantized.pt` by default and falls back to `checkpoints/best_model.pt`.

Run federated learning across distributed client manifests:

```powershell
python scripts/train_federated.py --client-manifests data/demo/audio_aug_splits/train.csv,data/demo/audio_aug_splits/validation.csv --validation-manifest data/demo/audio_aug_splits/test.csv --model multimodal_attention --task severity --rounds 3 --local-epochs 1 --output-dir checkpoints/federated_demo
```

After each screening, the system now generates a personalized intervention plan and adapts future recommendations using a reinforcement-learning policy update.

Use the `Webcam` tab for browser/mobile camera capture. This is suitable for practical classroom demos because it works inside Streamlit without extra desktop camera windows.

Run continuous local webcam analysis with OpenCV:

```powershell
python scripts/realtime_webcam_analysis.py --model exports/deployment/pruned_30_quantized.pt --camera 0 --interval 1.0 --text "ami bangla pori"
```

Press `q` or `Esc` to stop the webcam window.

Log one offline speech-therapy session:

```powershell
python scripts/record_speech_therapy_session.py --student-hash anon_student_001 --task-id bn_sentence_easy --audio-file path/to/session.wav --pronunciation-errors 1 --syllable-repetitions 2 --sound-substitutions 0 --attention-rating 4
```

Speech-therapy sessions are stored in `data/mobile_collection/therapy/therapy_sessions.csv` and include language-specific target prompts, audio paths, pronunciation observations, a therapy score, and a recommended next step.

## Proposed System Architecture

The implementation follows the requested architecture as code:

- Input Layer: manifest rows, handwriting image paths, reading-audio paths, multilingual text, error counts, and reading-behavior values
- Preprocessing Layer: image normalization, audio log-spectrogram extraction, language-aware text tokenization, behavior tensor creation
- Feature Extraction Layer: CNN handwriting encoder, audio temporal encoder, behavior encoder, error features
- Sequence Modeling Layer: GRU/Transformer-based multilingual text sequence modeling
- Classification Layer: multimodal feature fusion and dyslexia-risk prediction
- Explainability Module: Grad-CAM handwriting attention overlay
- Deployment Layer: TorchScript and quantized TorchScript export

Run one sample through every architecture layer:

```powershell
python scripts/run_architecture_pipeline.py --manifest data/demo/manifest.csv --sample-id S001
```

## Objective Implementation Map

1. Develop a deep learning dyslexia screening model:

```powershell
python -m src.dyslexia_detection.train --manifest data/demo/manifest.csv --epochs 2
```

2. Create multilingual-language compatible datasets:

```powershell
python scripts/create_collection_template.py --output data/collection/manifest_template.csv
python scripts/validate_manifest.py --manifest data/demo/manifest.csv
```

2a. Transfer English knowledge to Bengali:

```powershell
python scripts/train_cross_lingual_transfer.py --manifest data/collection/processed/prepared_manifest.csv --english-checkpoint checkpoints/english_vit_transformer/best_model.pt --model vit_transformer --task severity --text-language bengali --epochs 5 --checkpoint-dir checkpoints/cross_lingual_bengali
```

3. Build lightweight and offline-compatible AI models:

```powershell
python scripts/export_lightweight_model.py --output-dir exports
python scripts/export_lightweight_model.py --output-dir exports --quantize
```

3a. Learn Bengali audio representations before fine-tuning:

```powershell
python scripts/pretrain_bengali_ssl.py --manifest data/demo/audio_augmented_manifest.csv --objective contrastive --epochs 5 --output checkpoints/ssl/audio_contrastive.pt
python scripts/fine_tune_from_ssl.py --manifest data/demo/audio_augmented_manifest.csv --ssl-checkpoint checkpoints/ssl/audio_contrastive.pt --model vit_transformer --task severity --epochs 5 --checkpoint-dir checkpoints/severity_from_ssl
```

Apply pruning, quantization, TorchScript export, and benchmarking:

```powershell
python scripts/optimize_for_deployment.py --checkpoint checkpoints/best_model.pt --output-dir exports/deployment --prune-amount 0.3
```

Run offline inference with the optimized artifact:

```powershell
python scripts/run_lightweight_inference.py --model exports/deployment/pruned_30_quantized.pt --handwriting data/demo/handwriting/S001.png --audio data/demo/audio/S001.wav --text "ami bangla pori" --sample-language Bengali --model-text-language bengali
```

Predict severity class or score from a trained checkpoint:

```powershell
python scripts/predict_severity.py --checkpoint checkpoints/severity_vit_transformer/best_model.pt --handwriting data/demo/handwriting/S001.png --audio data/demo/audio/S001.wav --text "ami bangla pori" --sample-language Bengali --spelling-errors 2 --pronunciation-errors 1 --reading-time-seconds 30 --hesitation-count 3 --repetition-count 2 --omission-count 1
```

Inspect modality importance (handwriting/speech/text/reading behavior):

```powershell
python scripts/predict_modality_attention.py --checkpoint checkpoints/multimodal_attention/best_model.pt --handwriting data/demo/handwriting/S001.png --audio data/demo/audio/S001.wav --text "ami bangla pori" --sample-language Bengali --spelling-errors 2 --pronunciation-errors 1 --reading-time-seconds 30 --hesitation-count 3 --repetition-count 2 --omission-count 1
```

4. Implement explainable AI:

The dashboard's `Explainability` tab supports:

- CNN Grad-CAM handwriting overlays for CNN-based handwriting encoders
- ViT patch-attention handwriting overlays for ViT checkpoints
- Transformer token-attention charts for Bengali or multilingual text checkpoints

Useful checkpoint paths:

```text
checkpoints/best_model.pt
checkpoints/transformer/best_model.pt
checkpoints/vit/best_model.pt
checkpoints/vit_transformer/best_model.pt
```

5. Design an assistive educational prototype:

The dashboard's `Guided Practice` tab provides Bengali, English, and mixed-language reading prompts, handwriting prompts, fluency tracking, speech-therapy prompts, and adaptive support messages.

6. Recommend personalized intervention plans:

The `Live Screening` and prototype `Screen`/`Webcam` tabs now recommend customized reading, pronunciation, and spelling exercises after detection, with weekly targets and adaptive policy updates logged under:

- `data/collection/intervention/recommendations.csv` (dashboard)
- `data/mobile_collection/intervention/recommendations.csv` (prototype)

## Ethical Use

This project is intended for screening and assistive learning support, not clinical diagnosis. Final assessment should involve qualified professionals. Collect data only with informed consent from participants/guardians where applicable, and anonymize all personally identifiable information.

## Web Dashboard (HTML/CSS/JS)

If Streamlit is not reachable, run the standalone web dashboard:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start_web_dashboard.ps1
```

Then open:

```text
http://localhost:8080
```

## Professional Flask Dashboard

Run the backend-powered dashboard (project-feature integrated):

```powershell
powershell -ExecutionPolicy Bypass -File "C:\Dyslexia_Detection_System\scripts\start_professional_dashboard.ps1"
```

Or double-click:

- `C:\Dyslexia_Detection_System\start_professional_dashboard.bat`

Open:

```text
http://127.0.0.1:5050
```

## React + Vite Frontend (Recommended UI)

This frontend uses React + Vite and proxies API calls to the Flask backend.

1. Start backend:

```powershell
python dashboard_web.py
```

2. In another terminal:

```powershell
cd frontend
npm install
npm run dev
```

3. Open:

```text
http://127.0.0.1:5173
```

Backend connection notes:

- Dev mode: Vite proxies `/api/*` to `http://127.0.0.1:5050` (configured in `frontend/vite.config.js`).
- Optional direct API base: set `VITE_API_BASE` (example: `http://127.0.0.1:5050`) before `npm run dev`.
- Health check: `http://127.0.0.1:5050/api/health`
- Production mode: build frontend with `npm run build`; Flask serves `frontend/dist` automatically at `http://127.0.0.1:5050`.

Optional single command:

```powershell
powershell -ExecutionPolicy Bypass -File "C:\Dyslexia_Detection_System\scripts\start_react_dashboard.ps1"
```

## Direct Local Run (No PowerShell)

Run directly with Python:

```powershell
python run_local_web.py
```

Or double-click:

- `C:\Dyslexia_Detection_System\start_local_web.bat`
