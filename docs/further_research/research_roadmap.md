# Research Roadmap

## 1. Purpose

This roadmap translates the current codebase into a sequence of research milestones.
It focuses on what can be tested next, what should be compared, and what can become paper-worthy results.

## 2. Short-Term Roadmap

### 2.1 Baseline consolidation

Goal:

- lock down baseline results for the current multimodal screening stack
- compare the current three-model supervised ranking set: attention, transformer, and ViT
- keep CNN and LSTM baselines only as legacy references
- use cross-validation to choose the model, then confirm it on a hard holdout split

Why:

- a stable baseline is needed before larger research claims can be made

### 2.2 Data quality auditing

Goal:

- check manifest completeness
- inspect missing modality patterns
- audit label imbalance
- inspect language-specific token coverage

Why:

- noisy or incomplete data can distort both screening and biomarker findings

### 2.3 Explainability validation

Goal:

- compare attention summaries with human expectations
- check whether Grad-CAM highlights plausible archived image regions
- verify that explanation text stays readable for teachers and parents

Why:

- explainability is a core feature of the platform

## 3. Mid-Term Roadmap

### 3.1 Cross-lingual experiments

Goal:

- transfer from English to Bengali
- compare scratch training with warm-start training
- evaluate whether foundation-style adaptation improves low-resource results

### 3.2 Biomarker ranking studies

Goal:

- measure which biomarkers are stable across splits
- compare archived image, speech, and reading-behavior feature families
- test whether the same markers stay important across language groups

### 3.3 Intervention effectiveness studies

Goal:

- test whether adaptive exercise plans improve session scores
- compare intervention actions across different severity groups
- track progress across repeated sessions

## 4. Long-Term Roadmap

### 4.1 Larger multilingual benchmark

Goal:

- evaluate the platform on larger Bengali, English, and mixed-language datasets
- compare performance by language, age range, and school context

### 4.2 Stronger multimodal fusion

Goal:

- test more advanced fusion modules
- compare simple concatenation against multi-step fusion and bottleneck fusion

### 4.3 Better deployment support

Goal:

- reduce local inference cost
- improve browser capture reliability
- streamline local installation and offline usage

### 4.4 Human-centered evaluation

Goal:

- test whether teachers and parents can understand the output
- study usability of the dashboard and report outputs
- refine wording based on feedback

## 5. Priority Order

Recommended sequence:

1. Baseline consolidation
2. Data quality auditing
3. Explainability validation
4. Cross-lingual transfer experiments
5. Biomarker ranking studies
6. Intervention effectiveness studies
7. Larger benchmark and deployment work
