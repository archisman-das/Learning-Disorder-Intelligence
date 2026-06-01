# Project Documentation

## 1. Overview

`Dyslexia_Detection_System` is a multimodal screening and assistive-learning project focused on dyslexia-related support workflows. It combines:

- handwriting-based signals
- reading-audio signals
- text-input and spelling signals
- reading-behavior signals
- speech-therapy scoring
- visual-focus / eye-style attention testing
- biomarker discovery
- reporting and local record storage

The repository contains both the machine-learning core and multiple user interfaces for local use.

The project is best understood as three layers:

1. `src/dyslexia_detection/`
   The reusable Python package for data processing, modeling, explainability, therapy, biomarker analysis, eye tracking, and optimization.
2. Dashboards and frontends
   The user-facing applications built on top of the package.
3. `scripts/`
   Command-line utilities for dataset preparation, training, analysis, and deployment tasks.

## 2. Main Goals

This project is designed to support:

- dyslexia-risk screening from multimodal educational signals
- multilingual and low-resource educational settings
- local or offline-friendly operation
- assistive educational feedback rather than only raw model output
- explainable and teacher-friendly workflows
- lightweight deployment experiments

This system is a screening and support platform. It is not a clinical diagnosis tool.

## 3. Repository Map

### Root-level files

- [app.py](/abs/path/c:/Dyslexia_Detection_System/app.py)
  Main Streamlit dashboard with research, collection, therapy, eye-tracking, and final-report workflows.
- [prototype_app.py](/abs/path/c:/Dyslexia_Detection_System/prototype_app.py)
  Older prototype-oriented Streamlit app.
- [README.md](/abs/path/c:/Dyslexia_Detection_System/README.md)
  Main project readme.
- [requirements.txt](/abs/path/c:/Dyslexia_Detection_System/requirements.txt)
  Python dependencies.
- [run_local_web.py](/abs/path/c:/Dyslexia_Detection_System/run_local_web.py)
  Helper for the local browser-based web dashboard.

### Python package

- [src/dyslexia_detection](/abs/path/c:/Dyslexia_Detection_System/src/dyslexia_detection)
  Core package with the main project logic.

### Web dashboards

- [web/index.html](/abs/path/c:/Dyslexia_Detection_System/web/index.html)
  Standalone local HTML/CSS/JS dashboard.
- [web/app.js](/abs/path/c:/Dyslexia_Detection_System/web/app.js)
  Browser-side logic for screening, therapy, visual focus, biomarkers, records, and PDF report export.
- [web/styles.css](/abs/path/c:/Dyslexia_Detection_System/web/styles.css)
  Styling for the standalone web dashboard.

### React frontend

- [frontend/src/App.jsx](/abs/path/c:/Dyslexia_Detection_System/frontend/src/App.jsx)
  React-based frontend.
- [frontend/src/styles.css](/abs/path/c:/Dyslexia_Detection_System/frontend/src/styles.css)
  React frontend styling.

### Utility scripts

- [scripts](/abs/path/c:/Dyslexia_Detection_System/scripts)
  Dataset, training, deployment, and analysis helpers.

## 4. User Interfaces

This repository currently contains more than one frontend. That is important when debugging or launching the project.

### 4.1 Streamlit dashboard

Primary file:

- [app.py](/abs/path/c:/Dyslexia_Detection_System/app.py)

Purpose:

- research and professional dashboard
- dataset overview and exploration
- sample collection
- explainability
- live screening
- webcam screening
- guided practice
- speech therapy
- eye tracking
- model operations
- final report generation

Use this when you want the broadest feature coverage and Python-integrated workflows.

### 4.2 Standalone local web dashboard

Primary files:

- [web/index.html](/abs/path/c:/Dyslexia_Detection_System/web/index.html)
- [web/app.js](/abs/path/c:/Dyslexia_Detection_System/web/app.js)

Purpose:

- browser-only interactive workflow
- automatic screening segments
- speech therapy interaction
- visual focus test
- biomarkers CSV analysis
- local records
- final PDF report generation

Use this when you want a simple local dashboard without relying on the Streamlit UI.

### 4.3 React frontend

Primary files:

- [frontend/src/App.jsx](/abs/path/c:/Dyslexia_Detection_System/frontend/src/App.jsx)
- [frontend/src/main.jsx](/abs/path/c:/Dyslexia_Detection_System/frontend/src/main.jsx)

Purpose:

- modern React UI
- backend-connected visualization and interaction

Use this when you specifically want the React/Vite interface.

## 5. Core Package Modules

Below is the high-level purpose of each main module in `src/dyslexia_detection/`.

### Configuration and schemas

- [config.py](/abs/path/c:/Dyslexia_Detection_System/src/dyslexia_detection/config.py)
  Central configuration objects such as data settings, language support, and tensor-related defaults.
- [schemas.py](/abs/path/c:/Dyslexia_Detection_System/src/dyslexia_detection/schemas.py)
  Shared data-structure definitions and schema-related helpers.

### Data handling

- [dataset.py](/abs/path/c:/Dyslexia_Detection_System/src/dyslexia_detection/dataset.py)
  Manifest-driven dataset loader for multimodal training and evaluation.
- [dataset_tools.py](/abs/path/c:/Dyslexia_Detection_System/src/dyslexia_detection/dataset_tools.py)
  Manifest validation, dataset workspace creation, sample appending, splitting, and preparation helpers.

### Preprocessing

- [preprocessing.py](/abs/path/c:/Dyslexia_Detection_System/src/dyslexia_detection/preprocessing.py)
  Handwriting image loading, audio feature extraction, character vocabulary creation, and text encoding.

### Models and training

- [models.py](/abs/path/c:/Dyslexia_Detection_System/src/dyslexia_detection/models.py)
  Model builders for multimodal architectures.
- [train.py](/abs/path/c:/Dyslexia_Detection_System/src/dyslexia_detection/train.py)
  Main trainer entry point.
- [severity.py](/abs/path/c:/Dyslexia_Detection_System/src/dyslexia_detection/severity.py)
  Severity-oriented training or inference helpers.
- [cross_lingual.py](/abs/path/c:/Dyslexia_Detection_System/src/dyslexia_detection/cross_lingual.py)
  Cross-lingual transfer support.
- [foundation.py](/abs/path/c:/Dyslexia_Detection_System/src/dyslexia_detection/foundation.py)
  Foundation-model-style pretraining / adaptation support.
- [ssl_pretraining.py](/abs/path/c:/Dyslexia_Detection_System/src/dyslexia_detection/ssl_pretraining.py)
  Self-supervised audio or representation pretraining logic.

### Explainability and architecture tracing

- [explainability.py](/abs/path/c:/Dyslexia_Detection_System/src/dyslexia_detection/explainability.py)
  Grad-CAM, transformer attention, and ViT-style explainability utilities.
- [architecture.py](/abs/path/c:/Dyslexia_Detection_System/src/dyslexia_detection/architecture.py)
  End-to-end pipeline walkthrough helpers used to inspect the architecture stage by stage.
- [educational_explanations.py](/abs/path/c:/Dyslexia_Detection_System/src/dyslexia_detection/educational_explanations.py)
  Teacher/parent/student-friendly explanation text generation.

### Intervention and adaptive learning

- [intervention.py](/abs/path/c:/Dyslexia_Detection_System/src/dyslexia_detection/intervention.py)
  Personalized intervention planning and update logic.
- [adaptive_tutoring.py](/abs/path/c:/Dyslexia_Detection_System/src/dyslexia_detection/adaptive_tutoring.py)
  Reinforcement-learning-inspired adaptive tutoring policy support.
- [speech_therapy.py](/abs/path/c:/Dyslexia_Detection_System/src/dyslexia_detection/speech_therapy.py)
  Therapy-task generation, therapy scoring, and session persistence helpers.

### Biomarkers and eye tracking

- [biomarkers.py](/abs/path/c:/Dyslexia_Detection_System/src/dyslexia_detection/biomarkers.py)
  Digital biomarker discovery from dataset features.
- [eye_tracking.py](/abs/path/c:/Dyslexia_Detection_System/src/dyslexia_detection/eye_tracking.py)
  Gaze trace parsing and eye-tracking metric computation.

### Optimization and deployment

- [optimization.py](/abs/path/c:/Dyslexia_Detection_System/src/dyslexia_detection/optimization.py)
  Pruning, quantization, TorchScript export, and benchmarking.
- [federated.py](/abs/path/c:/Dyslexia_Detection_System/src/dyslexia_detection/federated.py)
  Federated-training workflow support.

## 6. Data Model and Manifest

The training and dataset tooling revolve around a CSV manifest.

Each row represents one anonymized sample.

Typical columns:

- `sample_id`
- `student_hash`
- `handwriting_path`
- `audio_path`
- `text_sample`
- `spelling_errors`
- `pronunciation_errors`
- `reading_time_seconds`
- `hesitation_count`
- `repetition_count`
- `omission_count`
- `label`

Important principles:

- use anonymized identifiers only
- avoid direct personal identifiers in manifests
- keep handwriting/audio paths consistent with the manifest location
- keep behavior features numeric and normalized where possible

## 7. End-to-End Functional Flow

### 7.1 Screening flow

The screening pipeline combines:

- handwriting features
- reading-audio features
- text representation
- reading behavior indicators
- spelling/pronunciation observations

Outputs typically include:

- label or severity estimate
- confidence
- explainable summary
- intervention hints

### 7.2 Speech therapy flow

The therapy pipeline supports:

- session type selection
- target-sound or target-pattern practice
- pronunciation and repetition analysis
- therapy scoring
- next-step recommendations

### 7.3 Visual focus / eye flow

There are two styles in the repository:

- browser-side visual focus testing in `web/`
- CSV-based or research-oriented eye metrics in `app.py` / `src/dyslexia_detection/eye_tracking.py`

The browser flow is a simplified interactive test. The Python side contains more explicit gaze-trace metrics.

### 7.4 Biomarker flow

Biomarker discovery analyzes numeric columns from a prepared dataset and identifies features that correlate with the target label.

This helps answer:

- which measurable signals appear most useful
- whether reading, timing, speech, or gaze-related features dominate

### 7.5 Final reporting flow

The current browser dashboard report flow in `web/` includes:

- student detail collection
- model comparison
- final outcome generation
- PDF download
- local record persistence

The Streamlit dashboard also now includes a final-report tab in `app.py`.

## 8. Machine Learning Architecture

The project architecture is multimodal.

At a high level:

1. Input layer
   Handwriting image, reading audio, text sample, spelling/pronunciation counts, and reading-behavior features.
2. Preprocessing layer
   Image normalization, audio feature extraction, text encoding, numeric feature formatting.
3. Feature extraction layer
   Separate encoders for handwriting, audio, text, and behavior.
4. Fusion layer
   Combines features into a joint representation.
5. Prediction layer
   Produces risk or severity output.
6. Explainability layer
   Produces attention maps, Grad-CAM outputs, and educational explanations.

## 9. Scripts and What They Do

### Dataset setup and validation

- `setup_dataset_workspace.py`
- `create_collection_template.py`
- `add_sample_to_manifest.py`
- `validate_manifest.py`
- `prepare_collected_dataset.py`
- `split_manifest.py`
- `anonymize_manifest.py`

### Augmentation

- `augment_handwriting_dataset.py`
- `augment_audio_dataset.py`

### Training and model building

- `train_initial_cnn_lstm.py`
- `train_initial_models.py`
- `train_advanced_models.py`
- `train_severity_models.py`
- `train_cross_lingual_transfer.py`
- `train_foundation_model.py`
- `fine_tune_foundation_adapter.py`
- `pretrain_bengali_ssl.py`
- `fine_tune_from_ssl.py`
- `train_federated.py`

### Inference and analysis

- `predict_severity.py`
- `predict_modality_attention.py`
- `discover_biomarkers.py`
- `run_architecture_pipeline.py`

### Deployment and optimization

- `export_lightweight_model.py`
- `optimize_for_deployment.py`
- `run_lightweight_inference.py`
- `realtime_webcam_analysis.py`

### Collection and therapy

- `collect_eye_tracking_webcam.py`
- `record_speech_therapy_session.py`

### Start scripts

- `start_streamlit.ps1`
- `start_web_dashboard.ps1`
- `start_react_dashboard.ps1`
- `start_professional_dashboard.ps1`
- `start_prototype.ps1`

## 10. Recommended Ways To Run The Project

Because the repository has multiple interfaces, choose one main path at a time.

### Option A: Streamlit research dashboard

Use:

```powershell
python -m streamlit run app.py
```

Best for:

- full Python-integrated dashboard
- collection and analysis workflows
- final report in Streamlit

### Option B: Standalone local web dashboard

Use:

```powershell
python run_local_web.py
```

Or the included batch / PowerShell helper.

Best for:

- browser-focused interactive use
- quick local testing
- Test Lab & Report PDF flow

### Option C: React frontend

Use when you specifically need the React/Vite UI and corresponding backend path.

## 11. Current Important Files for the Browser Dashboard

If you are maintaining the standalone browser dashboard, these are the most important files:

- [web/index.html](/abs/path/c:/Dyslexia_Detection_System/web/index.html)
  Dashboard structure and visible controls.
- [web/app.js](/abs/path/c:/Dyslexia_Detection_System/web/app.js)
  Dashboard behavior, scoring logic, records, and PDF report logic.
- [web/styles.css](/abs/path/c:/Dyslexia_Detection_System/web/styles.css)
  Dashboard styling.

Important browser-side sections currently include:

- Screening
- Speech Therapy
- Visual Focus Test
- Test Lab & Report
- Biomarkers
- Records

## 12. Current Important Files for the Streamlit Dashboard

If you are maintaining the Streamlit experience, these are the most important files:

- [app.py](/abs/path/c:/Dyslexia_Detection_System/app.py)
  Main dashboard and orchestration.
- [src/dyslexia_detection/eye_tracking.py](/abs/path/c:/Dyslexia_Detection_System/src/dyslexia_detection/eye_tracking.py)
  Eye-tracking metrics.
- [src/dyslexia_detection/speech_therapy.py](/abs/path/c:/Dyslexia_Detection_System/src/dyslexia_detection/speech_therapy.py)
  Therapy support.
- [src/dyslexia_detection/biomarkers.py](/abs/path/c:/Dyslexia_Detection_System/src/dyslexia_detection/biomarkers.py)
  Biomarker discovery.
- [src/dyslexia_detection/intervention.py](/abs/path/c:/Dyslexia_Detection_System/src/dyslexia_detection/intervention.py)
  Intervention logic.

## 13. Records and Persistence

The project uses different persistence styles depending on surface:

- manifest CSVs for datasets
- CSV logs for intervention, therapy, and eye-tracking collection
- local browser storage for `web/` records
- checkpoint directories for trained models
- export directories for optimized artifacts
- report folders for biomarker and other analysis outputs

When debugging, always verify which persistence layer is active for the UI you are using.

## 14. Known Design Reality

This repository is feature-rich but also multi-surface. That means:

- not every frontend exposes every backend capability
- some workflows exist in both Python and browser form
- older prototype paths still exist beside newer paths
- debugging must begin by identifying which frontend is actually running

That is the single most important maintenance principle for this repository.

## 15. Suggested Maintenance Strategy

For future work, the safest maintenance pattern is:

1. identify the active app surface first
2. trace the feature in that exact surface
3. verify whether the same feature also exists in another UI
4. avoid assuming a `web/` fix changes `app.py`, or that a React fix changes `web/`
5. keep documentation synchronized when workflows are moved or renamed

## 16. Ethical and Operational Notes

- This system is for educational support and screening assistance.
- It should not replace a qualified professional diagnosis.
- Personal data should be anonymized.
- Consent and data handling should be appropriate to the deployment setting.
- Reports should be treated as support documents, not clinical certificates.

## 17. Documentation Maintenance

When updating this project, update documentation if you change:

- report flow
- tab names
- startup commands
- file-format requirements
- student detail fields
- local record behavior
- PDF export behavior
- dashboard surface ownership

If these areas change without documentation updates, user confusion is very likely.
