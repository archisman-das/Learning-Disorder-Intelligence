# Draft Research Paper

## Title

Multimodal, Local-First Learning-Disorder Screening and Educational Support Using Handwriting, Speech, Text, Behavior, and Eye-Tracking Signals

## Abstract

This project presents a multimodal, local-first learning-disorder support platform designed for screening, educational feedback, and intervention planning. Dyslexia is the main use case, but the architecture is framed more broadly so the same pipeline can support related learning-disorder workflows. The system combines handwriting images, spoken reading samples, character-level text, reading-behavior features, eye-tracking metrics, and biomarker tables into a unified workflow. Rather than treating the problem as a single-feature classification task, the architecture supports multiple input branches and several fusion strategies, including concatenation and attention-based multimodal fusion. The platform also includes explainability utilities, teacher/parent/student explanation generation, speech-therapy scoring, personalized intervention planning, and browser-based record keeping. The repository is intentionally structured to support Bengali, English, and multilingual settings, with explicit support for low-resource adaptation and local deployment. This draft paper describes the project problem space, architecture, model families, training strategy, and research directions. It is intended as a foundation for a formal publication, experimental report, or thesis chapter rather than as a claim of final benchmark performance.

## Keywords

learning disorders, dyslexia, multimodal learning, low-resource AI, explainable AI, educational technology, eye tracking, handwriting analysis, speech analysis, Bengali NLP

## 1. Introduction

Learning-disorder related difficulty is often reflected across several educational signals rather than one isolated signal. A learner may show handwriting irregularities, reading hesitation, pronunciation errors, slower reading speed, or eye-movement patterns that suggest a need for additional support. This project was built to represent that reality directly in software.

The system is not a single model. It is a full support platform with:

- a multimodal screening pipeline
- a speech-therapy and intervention module
- a visual-focus and eye-tracking workflow
- digital biomarker analysis
- explainability and educational feedback
- local record keeping and PDF reporting

The project is especially oriented toward Bengali, multilingual, and low-resource educational settings, where a flexible and interpretable screening system can be more useful than a heavy, opaque model.

## 2. Problem Statement

Most early screening systems focus on a narrow input source, such as text only or image only. That can miss signals that appear in behavior, speech, or eye movement. In a classroom setting, the goal is not only to label risk but also to provide actionable, understandable support.

This project addresses four gaps:

1. weak integration across modalities
2. limited support for multilingual and low-resource settings
3. insufficient explainability for teachers and parents
4. lack of a direct bridge from screening to intervention

## 3. Proposed Contribution

This codebase contributes a research platform with the following practical ideas:

| Contribution | Description |
|---|---|
| Multimodal screening | Combines handwriting, audio, text, and behavior signals for learning-disorder support |
| Attention-based fusion | Learns which modality is more informative for a case |
| Low-resource support | Supports Bengali, English, and multilingual workflows |
| Explainability | Generates heatmaps, modality scores, and educational summaries |
| Intervention planning | Produces reading, pronunciation, and spelling exercises |
| Browser and Python surfaces | Supports both local web and Streamlit workflows |
| Local records and reporting | Saves results and generates downloadable reports |

## 4. Related Work

The current design aligns with several research directions:

- transformer-based sequence modeling and attention fusion
- Grad-CAM-style visual explanation
- self-supervised audio representation learning
- eye-tracking-based reading difficulty analysis
- handwriting anomaly and dysgraphia analysis
- multimodal learning for health and educational signals

Selected references are listed in [`docs/REFERENCES.md`](/d:/Project/Dyslexia_Detection_System/docs/REFERENCES.md).

## 5. System Overview

The repository is organized into several connected components.

### 5.1 Core data sources

- handwriting images
- reading audio
- text samples
- spelling/pronunciation errors
- reading-behavior indicators
- eye-tracking traces
- biomarker CSV tables

### 5.2 Core processing stages

1. input ingestion
2. preprocessing
3. modality-specific feature extraction
4. fusion or attention
5. prediction
6. explanation
7. intervention and reporting

### 5.3 Major modules

| Module | Role in the paper |
|---|---|
| [`src/dyslexia_detection/preprocessing.py`](/d:/Project/Dyslexia_Detection_System/src/dyslexia_detection/preprocessing.py) | Input normalization and tokenization |
| [`src/dyslexia_detection/models.py`](/d:/Project/Dyslexia_Detection_System/src/dyslexia_detection/models.py) | Neural model families |
| [`src/dyslexia_detection/train.py`](/d:/Project/Dyslexia_Detection_System/src/dyslexia_detection/train.py) | Training pipeline |
| [`src/dyslexia_detection/explainability.py`](/d:/Project/Dyslexia_Detection_System/src/dyslexia_detection/explainability.py) | Explainability methods |
| [`src/dyslexia_detection/intervention.py`](/d:/Project/Dyslexia_Detection_System/src/dyslexia_detection/intervention.py) | Intervention policy |
| [`src/dyslexia_detection/biomarkers.py`](/d:/Project/Dyslexia_Detection_System/src/dyslexia_detection/biomarkers.py) | Biomarker discovery |
| [`src/dyslexia_detection/eye_tracking.py`](/d:/Project/Dyslexia_Detection_System/src/dyslexia_detection/eye_tracking.py) | Eye-tracking metrics |
| [`src/dyslexia_detection/foundation.py`](/d:/Project/Dyslexia_Detection_System/src/dyslexia_detection/foundation.py) | Foundation model / adapter design |

## 6. Methods

### 6.1 Data representation

The project uses a CSV manifest as the central data contract. Each row corresponds to one anonymized learner sample. A row typically includes:

- sample identifier
- anonymized student hash
- handwriting path
- audio path
- text sample
- spelling and pronunciation error counts
- reading time and fluency counts

Behavioral and eye-tracking features are represented separately when available.

### 6.2 Preprocessing

Handwriting images are normalized to a fixed grayscale canvas. Audio is converted to a fixed-size spectral representation. Text is normalized at the character level, which is particularly important for multilingual or low-resource settings. Numeric behavior features are passed directly as a compact vector.

This design was chosen because it is simple, portable, and compatible with local deployment.

### 6.3 Model families

The project includes the following families:

- compact CNN/LSTM baselines retained for historical comparison
- three active supervised screening models: attention-based, transformer-based, and ViT-based
- foundation and adapter models
- self-supervised audio pretraining models

The primary model families are summarized below.

| Family | Main idea | Strength | Limitation |
|---|---|---|---|
| Baselines | Simple CNN/LSTM combinations | Fast to train and compare | Limited modeling capacity |
| Default multimodal | Combine all major modalities | Balanced and practical | Simple concatenation fusion |
| Transformer multimodal | Use transformer text branch | Better sequence modeling | Higher compute cost |
| ViT multimodal | Use patch-based handwriting encoding | Better spatial structure modeling | Needs more tuning |
| Attention multimodal | Learn modality weights | More interpretable | More complex to interpret safely |
| Foundation model | Learn reusable multimodal representations | Better for adaptation | Needs more data / pretraining |
| SSL audio | Pretrain on unlabeled audio | Strong low-label support | Depends on augmentation and teacher quality |

### 6.4 Fusion strategy

The default fusion method concatenates the modality embeddings and passes them through a classifier head. The attention-based variant adds a learned weighting mechanism so that each modality can contribute differently to the final prediction.

In the context of this project, this is important because a learner may show a strong signal in handwriting but a weaker one in audio, or vice versa.

### 6.5 Explainability

Explainability is implemented through:

- Grad-CAM for handwriting images
- attention-based modality scoring
- token-level attention for transformer text branches
- educational summaries for teacher, parent, and student audiences

This makes the system more suitable for real educational use than a plain label-only classifier.

### 6.6 Intervention and therapy

The intervention module converts a risk or severity profile into a structured plan of reading, pronunciation, and spelling exercises. The speech-therapy module also keeps session scoring and progress logging. Together these components form a screening-to-support loop rather than a screening-only tool.

## 7. Application Surfaces

### 7.1 Streamlit dashboard

The Streamlit application is intended for research and operational review. It includes:

- dataset overview
- sample collection
- live screening
- webcam analysis
- biomarker discovery
- speech therapy
- eye tracking
- final report generation
- federated and deployment tools

### 7.2 Standalone local web dashboard

The browser dashboard is intended for local classroom or lab use. It provides:

- screening
- speech therapy
- visual focus testing
- biomarker analysis
- local records
- PDF report export

### 7.3 React frontend

The React frontend is a separate UI surface for API-connected visual work. It is useful if the project is later extended into a more conventional web application.

## 8. Research Questions

This project can support several paper-grade questions:

1. Does multimodal fusion improve dyslexia screening over single-modality baselines?
2. Does attention-based fusion improve interpretability without harming performance?
3. Can cross-lingual transfer improve Bengali screening performance in low-resource settings?
4. Which modality family contributes most strongly to predictions?
5. Can biomarker rankings remain stable across splits and languages?
6. Do teacher/parent/student explanations make the system more actionable?
7. Do intervention plans correlate with session improvement over time?

## 9. Evaluation Plan

The repository is structured so that evaluation can be performed along multiple axes.

### 9.1 Predictive evaluation

- accuracy
- F1 score
- recall for elevated-risk cases
- MAE for regression mode
- calibration or confidence analysis
- cross-validation for model selection
- hard holdout testing for final sanity-checks
- validation matrix reporting for side-by-side model comparison

### 9.2 Interpretability evaluation

- attention stability
- heatmap plausibility
- explanation readability
- agreement between modality importance and domain expectations

### 9.3 Research evaluation

- cross-lingual transfer gain
- biomarker rank stability
- intervention improvement across sessions
- usefulness of records and reports in local settings

## 10. Limitations

This draft paper should be honest about the current limits of the implementation:

- the system is not a clinical diagnostic device
- performance claims require real benchmark experiments
- some modules are lightweight by design and may not capture every complex pattern
- browser-side microphone and local transcription require secure local execution
- many research directions still need larger, better-annotated datasets

## 11. Ethical Considerations

Because the project handles educational and potentially sensitive learning-related data, the following points matter:

- anonymize learner identities
- separate consent from collection
- keep reports support-oriented rather than diagnostic
- avoid overclaiming certainty
- treat all outputs as decision support for educators or specialists

## 12. Conclusion

This project is best framed as a multimodal, local-first educational AI platform for learning-disorder screening and support, with dyslexia as the primary use case. Its technical strengths are the combination of multiple signals, the support for Bengali and multilingual workflows, the presence of explainability and intervention components, and the ability to run through both Python and browser-based interfaces.

The codebase is already organized in a way that can support a formal paper. The next research step is to run controlled experiments, compare model families, document the dataset carefully, and evaluate whether the explanations and intervention plans are useful to real users.

## References

For a curated list of directly relevant papers and links, see [`docs/REFERENCES.md`](/d:/Project/Dyslexia_Detection_System/docs/REFERENCES.md).
