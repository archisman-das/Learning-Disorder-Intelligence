# Research Proposal: Cross-Lingual Low-Resource Transfer

## Title

Cross-Lingual Transfer Learning for Bengali Dyslexia Screening and Support

## Problem Statement

Bengali educational datasets are often smaller and noisier than higher-resource English datasets.
The project already supports multilingual text handling and checkpoint transfer, which makes cross-lingual transfer a natural research direction.

## Research Scope

- transfer shared weights from English to Bengali models
- test freeze-vs-finetune strategies
- compare standard multimodal training with foundation-model adaptation
- measure how much each modality benefits from source-language knowledge

## Hypothesis

Starting from a source-language checkpoint will improve Bengali performance when target data is limited.

## Data Requirements

- English checkpoint
- Bengali manifest
- consistent schema between source and target datasets
- language-tagged text samples

## Candidate Methods

- `transfer_matching_weights`
- `set_trainable_by_prefix`
- `shared_feature_distillation_loss`
- `BengaliLearningDisorderFoundationModel`
- `LearningDisorderAdapter`

## Evaluation Ideas

- target-language validation score
- transfer gain versus scratch training
- modality ablation
- feature similarity comparison
- cross-validation model selection followed by holdout evaluation on the hardest split

## Expected Output

- transfer recipe for Bengali fine-tuning
- best branch-freezing strategy
- report on which modalities transfer best

## Main Risks

- vocabulary mismatch
- overfitting on small target data
- transfer of irrelevant source-language patterns
