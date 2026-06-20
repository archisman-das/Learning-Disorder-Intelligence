# Biomarker Test CSVs

This repository includes two ready-to-upload synthetic CSV files for the Biomarkers page:

- [`data/biomarker_tests/english_biomarker_test.csv`](/d:/Project/Dyslexia_Detection_System/data/biomarker_tests/english_biomarker_test.csv)
- [`data/biomarker_tests/bengali_biomarker_test.csv`](/d:/Project/Dyslexia_Detection_System/data/biomarker_tests/bengali_biomarker_test.csv)

## Why these columns

The columns were chosen to mirror biomarker patterns used in the project and in the related literature:

- reading fluency signals such as reading time, hesitations, repetitions, and omissions
- speech-related signals such as pronunciation errors and pause-like behavior
- eye-tracking style signals such as fixation duration, regressions, and gaze dispersion
- handwriting-style signals such as stroke density, spacing consistency, baseline variation, and pressure variability

The dataset is synthetic and intended only for interface testing, not for clinical use.
It is meant to support the biomarker page and can be read alongside the model comparison and validation matrices
in the other docs, but it should not be treated as a model-selection benchmark.

## Research basis

The design is informed by eye-tracking and handwriting research showing that dyslexia/dysgraphia screening often benefits from:

- fixation and saccade statistics in reading tasks
- regression-heavy scanpaths and longer fixation durations
- handwriting geometry, spacing, baseline drift, and pressure-related features

Relevant references:

- [DysLexML: Screening Tool for Dyslexia Using Machine Learning](https://arxiv.org/abs/1903.06274)
- [Fixation Sequences as Time Series: A Topological Approach to Dyslexia Detection](https://arxiv.org/abs/2604.21698)
- [Handwriting Anomalies and Learning Disabilities through Recurrent Neural Networks and Geometric Pattern Analysis](https://arxiv.org/abs/2405.07238)
- [A statistical procedure to assist dysgraphia detection through dynamic modelling of handwriting](https://arxiv.org/abs/2408.02099)

## Suggested use

1. Open the Biomarkers page in the dashboard.
2. Upload one of the CSV files.
3. Keep the default `label` column.
4. Run the analysis to inspect the top-ranked markers.

## Notes

- The `label` column uses `0` for lower-risk rows and `1` for higher-risk rows.
- Bengali and English text samples are both included so you can test the UI in either language context.
- The numeric columns are intentionally consistent across both files so they can be compared directly.
