# Project Scopes

## 1. Purpose

This document defines the practical and research scopes of the project.
It is meant to help answer:

- what this codebase is trying to achieve
- which parts are production-oriented versus research-oriented
- which experiments naturally fit the current architecture
- where the biggest expansion opportunities are

The repository is not a single narrow model. It is a platform with several connected problem areas.

## 2. Core Scope Areas

### 2.1 Multimodal learning-disorder screening

Scope:

- combine reading audio, text, reading behavior, eye-tracking, and biomarker signals
- estimate learning-disorder risk or severity, with dyslexia as the main target
- provide confidence and explanation rather than a bare label

What this supports:

- school screening
- classroom triage
- early-stage support planning

Why it matters:

- learning-disorder signs often appear across more than one signal source
- a multimodal approach is more realistic than a single-feature classifier

Current implementation anchors:

- [`src/dyslexia_detection/models.py`](/d:/Project/Dyslexia_Detection_System/src/dyslexia_detection/models.py)
- [`src/dyslexia_detection/train.py`](/d:/Project/Dyslexia_Detection_System/src/dyslexia_detection/train.py)
- [`src/dyslexia_detection/architecture.py`](/d:/Project/Dyslexia_Detection_System/src/dyslexia_detection/architecture.py)
- [`app.py`](/d:/Project/Dyslexia_Detection_System/app.py)
- [`web/app.js`](/d:/Project/Dyslexia_Detection_System/web/app.js)

### 2.2 Multilingual and low-resource learning support

Scope:

- Bengali-first workflows
- English support
- multilingual text handling
- cross-lingual transfer and foundation-style adaptation

What this supports:

- schools that work in Bengali or mixed-language settings
- adaptation from higher-resource to lower-resource language data
- reuse of shared representations across tasks

Why it matters:

- low-resource educational data is often sparse and noisy
- language-specific assumptions can break in multilingual contexts

Current implementation anchors:

- [`src/dyslexia_detection/config.py`](/d:/Project/Dyslexia_Detection_System/src/dyslexia_detection/config.py)
- [`src/dyslexia_detection/cross_lingual.py`](/d:/Project/Dyslexia_Detection_System/src/dyslexia_detection/cross_lingual.py)
- [`src/dyslexia_detection/foundation.py`](/d:/Project/Dyslexia_Detection_System/src/dyslexia_detection/foundation.py)
- [`src/dyslexia_detection/ssl_pretraining.py`](/d:/Project/Dyslexia_Detection_System/src/dyslexia_detection/ssl_pretraining.py)
- [`src/dyslexia_detection/preprocessing.py`](/d:/Project/Dyslexia_Detection_System/src/dyslexia_detection/preprocessing.py)

### 2.3 Explainable educational AI

Scope:

- turn model predictions into human-readable educational guidance
- highlight evidence sources
- produce teacher, parent, and learner-friendly output

What this supports:

- transparent screening results
- classroom feedback
- family-facing progress summaries

Why it matters:

- a prediction without explanation is hard to act on in real educational settings

Current implementation anchors:

- [`src/dyslexia_detection/explainability.py`](/d:/Project/Dyslexia_Detection_System/src/dyslexia_detection/explainability.py)
- [`src/dyslexia_detection/educational_explanations.py`](/d:/Project/Dyslexia_Detection_System/src/dyslexia_detection/educational_explanations.py)
- [`web/app.js`](/d:/Project/Dyslexia_Detection_System/web/app.js)
- [`app.py`](/d:/Project/Dyslexia_Detection_System/app.py)

### 2.4 Personalized intervention and adaptive practice

Scope:

- recommend reading, pronunciation, and spelling exercises
- adapt the plan according to learner progress
- keep a weekly target and log progress over time

What this supports:

- intervention planning after screening
- practice scheduling
- short-cycle feedback loops

Why it matters:

- screening is more useful when it connects to actionable support

Current implementation anchors:

- [`src/dyslexia_detection/intervention.py`](/d:/Project/Dyslexia_Detection_System/src/dyslexia_detection/intervention.py)
- [`src/dyslexia_detection/adaptive_tutoring.py`](/d:/Project/Dyslexia_Detection_System/src/dyslexia_detection/adaptive_tutoring.py)
- [`src/dyslexia_detection/speech_therapy.py`](/d:/Project/Dyslexia_Detection_System/src/dyslexia_detection/speech_therapy.py)

### 2.5 Biomarker discovery and feature analysis

Scope:

- find measurable signals associated with risk labels
- compare audio, text, reading-behavior, and biomarker features
- rank candidate markers for interpretation and follow-up study

What this supports:

- feature selection
- research hypotheses
- evidence summaries in the dashboard

Why it matters:

- biomarker analysis helps move from prediction to insight

Current implementation anchors:

- [`src/dyslexia_detection/biomarkers.py`](/d:/Project/Dyslexia_Detection_System/src/dyslexia_detection/biomarkers.py)
- [`web/app.js`](/d:/Project/Dyslexia_Detection_System/web/app.js)
- [`app.py`](/d:/Project/Dyslexia_Detection_System/app.py)

### 2.6 Eye-tracking and visual focus analysis

Scope:

- collect gaze traces
- measure reading speed, fixation, regressions, and scanpath behavior
- use simple visual-focus tasks as an attention proxy

What this supports:

- webcam-based research
- classroom reading behavior analysis
- visual attention profiling

Why it matters:

- eye movement patterns can reveal reading difficulty even when text output looks normal

Current implementation anchors:

- [`src/dyslexia_detection/eye_tracking.py`](/d:/Project/Dyslexia_Detection_System/src/dyslexia_detection/eye_tracking.py)
- [`web/app.js`](/d:/Project/Dyslexia_Detection_System/web/app.js)
- [`app.py`](/d:/Project/Dyslexia_Detection_System/app.py)

### 2.7 Local deployment and records

Scope:

- run the system locally
- keep browser records
- export reports
- support microphone capture through localhost

What this supports:

- offline-friendly demos
- school lab use
- local research workflows

Why it matters:

- many target environments do not have stable cloud access

Current implementation anchors:

- [`run_local_web.py`](/d:/Project/Dyslexia_Detection_System/run_local_web.py)
- [`web/index.html`](/d:/Project/Dyslexia_Detection_System/web/index.html)
- [`web/app.js`](/d:/Project/Dyslexia_Detection_System/web/app.js)

## 3. Research Scope Categories

The repository can support several kinds of research, even if they are not all fully formalized yet.

### 3.1 Model-development research

Example questions:

- Which architecture performs best on the manifest schema?
- Does attention fusion improve interpretability without hurting accuracy?
- Does a ViT visual branch help more than a CNN-style visual branch for archived comparisons?
- Which model should be selected by cross-validation before the hard holdout sanity-check?
- How much does threshold calibration change recall on strict evaluation splits?

### 3.2 Low-resource transfer research

Example questions:

- How well does English-to-Bengali transfer work?
- Which branches benefit most from frozen warm-start training?
- Do foundation-style embeddings reduce the need for large labeled datasets?

### 3.3 Explainability research

Example questions:

- Which modality tends to dominate predictions?
- Can teachers understand the model explanation output?
- Do Grad-CAM and attention scores align with human expectations?

### 3.4 Intervention research

Example questions:

- Which intervention plan is selected for a given severity profile?
- Does repeated short practice improve the next session score?
- Which error type should drive the next practice block?

### 3.5 Biomarker research

Example questions:

- Which feature families are strongest in a given dataset?
- Are reading-behavior features stronger than audio features?
- Do different language groups show different biomarker rankings?

### 3.6 Usability and deployment research

Example questions:

- Is the local browser dashboard practical in a classroom?
- Does microphone handling work reliably on localhost?
- Are records and reports easy to review later?

## 4. Current Scope Boundaries

The project currently does not aim to be:

- a clinical diagnostic device
- a hospital-grade assessment platform
- a single-model-only benchmark repo
- a cloud-only product

Instead, it aims to be:

- a multimodal learning-disorder screening and support platform
- a research-friendly codebase
- a local-first dashboard system
- a foundation for multilingual educational experiments

## 5. What Belongs In Future Work

Likely future additions that fit the current scope:

- larger labeled datasets
- better cross-lingual benchmarking
- stronger multimodal fusion experiments
- more robust speech and audio modeling
- richer teacher/parent reporting
- larger-scale intervention evaluation
- more formal fairness and calibration analysis

## 6. Suggested Entry Files

If you want to understand the scope from the code, start with:

1. [`README.md`](/d:/Project/Dyslexia_Detection_System/README.md)
2. [`docs/PROJECT_DOCUMENTATION.md`](/d:/Project/Dyslexia_Detection_System/docs/PROJECT_DOCUMENTATION.md)
3. [`docs/ARCHITECTURE.md`](/d:/Project/Dyslexia_Detection_System/docs/ARCHITECTURE.md)
4. [`docs/MODEL_CATALOG.md`](/d:/Project/Dyslexia_Detection_System/docs/MODEL_CATALOG.md)
