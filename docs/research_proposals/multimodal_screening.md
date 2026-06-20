# Research Proposal: Multimodal Dyslexia Screening

## Title

Multimodal Dyslexia Screening Using Handwriting, Speech, Text, and Reading-Behavior Signals

## Problem Statement

Single-signal screening can miss important educational evidence.
This project already combines handwriting, speech, text, and behavior inputs, which makes it a strong base for a multimodal screening study.

## Research Scope

- compare baseline models against multimodal fusion models
- test whether attention-based fusion improves interpretability
- evaluate whether a ViT handwriting branch improves image sensitivity
- compare binary risk, severity classification, and regression-style scoring
- select the best model with cross-validation, then sanity-check it on a hard holdout split
- compare old and new threshold settings side by side when recall needs tuning

## Hypothesis

Multimodal fusion will outperform single-modality baselines, and attention fusion will improve the usefulness of explanations.

## Data Requirements

- anonymized manifest CSV
- handwriting images
- reading audio files
- text samples
- spelling and pronunciation counts
- behavior features

## Candidate Methods

- `InitialCNNModel`
- `InitialLSTMModel`
- `InitialCNNLSTMModel`
- `MultimodalDyslexiaModel`
- `TransformerMultimodalModel`
- `AttentionMultimodalModel`

## Evaluation Ideas

- accuracy
- F1 score
- MAE for regression mode
- calibration / confidence analysis
- modality-attention consistency
- validation matrix reporting
- holdout test sanity-check

## Expected Output

- best-performing screening architecture
- ranked evidence sources
- teacher-friendly explanation summary

## Main Risks

- small dataset size
- noisy labels
- class imbalance
- modality missingness
