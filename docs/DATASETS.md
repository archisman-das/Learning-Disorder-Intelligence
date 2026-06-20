# Dataset Overview

## 1. Purpose

This document describes the datasets and dataset-like assets currently stored in the repository.
It is meant to be the single place to check what each folder is for, which files are meant for training or testing,
and which files are only for demos or interface checks.

## 2. Dataset Groups

| Group | Location | Main contents | Intended use |
|---|---|---|---|
| Demo dataset | [`data/demo/`](/d:/Project/Dyslexia_Detection_System/data/demo) | manifest CSVs, audio samples, handwriting samples, split folders | Quick testing, local experimentation, dashboard demos |
| Collection dataset | [`data/collection/`](/d:/Project/Dyslexia_Detection_System/data/collection) | raw collection workspace, processed outputs, split folders, collection docs | Real sample collection and preparation workflow |
| Collection test dataset | [`data/collection_test/`](/d:/Project/Dyslexia_Detection_System/data/collection_test) | test collection workspace and processed outputs | Secondary collection/testing workspace |
| Benchmark datasets | [`data/benchmarks/`](/d:/Project/Dyslexia_Detection_System/data/benchmarks) | tough manifests and hard family splits | Model selection, hard holdout sanity checks, strict evaluation |
| Biomarker test CSVs | [`data/biomarker_tests/`](/d:/Project/Dyslexia_Detection_System/data/biomarker_tests) | synthetic biomarker CSVs for English and Bengali | Biomarker UI testing and visualization checks |

## 3. Demo Dataset Details

The demo dataset is the quickest way to run the project locally.

### 3.1 Main files

| File | Role |
|---|---|
| [`data/demo/manifest.csv`](/d:/Project/Dyslexia_Detection_System/data/demo/manifest.csv) | Small starter manifest |
| [`data/demo/manifest_anonymized.csv`](/d:/Project/Dyslexia_Detection_System/data/demo/manifest_anonymized.csv) | Anonymized version of the demo manifest |
| [`data/demo/augmented_manifest.csv`](/d:/Project/Dyslexia_Detection_System/data/demo/augmented_manifest.csv) | Augmented manifest for training tests |
| [`data/demo/audio_augmented_manifest.csv`](/d:/Project/Dyslexia_Detection_System/data/demo/audio_augmented_manifest.csv) | Audio-augmented manifest used in many training examples |

### 3.2 Subfolders

| Folder | Contents |
|---|---|
| [`data/demo/audio/`](/d:/Project/Dyslexia_Detection_System/data/demo/audio) | Demo audio assets |
| [`data/demo/handwriting/`](/d:/Project/Dyslexia_Detection_System/data/demo/handwriting) | Demo handwriting assets |
| [`data/demo/augmented/`](/d:/Project/Dyslexia_Detection_System/data/demo/augmented) | Augmented demo samples |
| [`data/demo/splits/`](/d:/Project/Dyslexia_Detection_System/data/demo/splits) | Train/validation/test splits |
| [`data/demo/audio_aug_splits/`](/d:/Project/Dyslexia_Detection_System/data/demo/audio_aug_splits) | Audio-focused splits |

## 4. Collection Workspace

The collection folders support a real data-gathering workflow.

### 4.1 Main files

| File | Role |
|---|---|
| [`data/collection/manifest.csv`](/d:/Project/Dyslexia_Detection_System/data/collection/manifest.csv) | Active collection manifest |
| [`data/collection/manifest_template.csv`](/d:/Project/Dyslexia_Detection_System/data/collection/manifest_template.csv) | Blank template for new collection rows |

### 4.2 Subfolders

| Folder | Contents |
|---|---|
| [`data/collection/raw/`](/d:/Project/Dyslexia_Detection_System/data/collection/raw) | Raw collected samples |
| [`data/collection/augmented/`](/d:/Project/Dyslexia_Detection_System/data/collection/augmented) | Augmented collection outputs |
| [`data/collection/processed/`](/d:/Project/Dyslexia_Detection_System/data/collection/processed) | Cleaned and prepared outputs |
| [`data/collection/splits/`](/d:/Project/Dyslexia_Detection_System/data/collection/splits) | Prepared train/validation/test splits |
| [`data/collection/docs/`](/d:/Project/Dyslexia_Detection_System/data/collection/docs) | Collection notes and supporting docs |
| [`data/collection/eye_tracking_smoke/`](/d:/Project/Dyslexia_Detection_System/data/collection/eye_tracking_smoke) | Eye-tracking smoke-test assets |

## 5. Benchmark Datasets

The benchmark folder is for more realistic or stricter evaluation.

### 5.1 Primary benchmark manifest

| File | Role |
|---|---|
| [`data/benchmarks/tough_confidence_manifest.csv`](/d:/Project/Dyslexia_Detection_System/data/benchmarks/tough_confidence_manifest.csv) | Main tough benchmark manifest used for selection snapshots |

### 5.2 Hard split folders

| Folder | Role |
|---|---|
| [`data/benchmarks/hard_family_split/`](/d:/Project/Dyslexia_Detection_System/data/benchmarks/hard_family_split) | Family-safe split variant |
| [`data/benchmarks/hard_family_split_strict/`](/d:/Project/Dyslexia_Detection_System/data/benchmarks/hard_family_split_strict) | Stricter family-safe split |
| [`data/benchmarks/hard_family_split_balanced/`](/d:/Project/Dyslexia_Detection_System/data/benchmarks/hard_family_split_balanced) | More label-balanced hard split |
| [`data/benchmarks/hard_family_split_realistic/`](/d:/Project/Dyslexia_Detection_System/data/benchmarks/hard_family_split_realistic) | Hard split tuned for realistic evaluation |
| [`data/benchmarks/hard_family_split_balanced_harder/`](/d:/Project/Dyslexia_Detection_System/data/benchmarks/hard_family_split_balanced_harder) | Toughest balanced hard split used for final sanity-checks |

## 6. Biomarker Test Files

These CSVs are synthetic and are only intended for dashboard and UI testing.

| File | Language | Purpose |
|---|---|---|
| [`data/biomarker_tests/english_biomarker_test.csv`](/d:/Project/Dyslexia_Detection_System/data/biomarker_tests/english_biomarker_test.csv) | English | Biomarker page smoke test |
| [`data/biomarker_tests/bengali_biomarker_test.csv`](/d:/Project/Dyslexia_Detection_System/data/biomarker_tests/bengali_biomarker_test.csv) | Bengali | Biomarker page smoke test |

## 7. Dataset Usage Notes

- Use demo data for quick local checks and UI validation.
- Use collection data only after anonymization and manifest validation.
- Use benchmark data for model selection and hard holdout sanity checks.
- Treat biomarker test CSVs as synthetic interface assets, not as training evidence.
- Keep all learner identities anonymized before training or reporting.

## 8. Related Docs

- [`docs/PROJECT_DOCUMENTATION.md`](/d:/Project/Dyslexia_Detection_System/docs/PROJECT_DOCUMENTATION.md)
- [`docs/further_research/experiment_matrix.md`](/d:/Project/Dyslexia_Detection_System/docs/further_research/experiment_matrix.md)
- [`docs/MODEL_CATALOG.md`](/d:/Project/Dyslexia_Detection_System/docs/MODEL_CATALOG.md)

