# Experiment Matrix

## 1. Purpose

This matrix organizes future experiments by research question, input type, and success metric.

The current comparison snapshot used in the project ranks the screening models as:

1. `multimodal_attention`
2. `transformer`
3. `vit`
4. `cnn`
5. `lstm`

## 2. Multimodal Screening Experiments

| Experiment | Inputs | Model | Metric | Why It Matters |
|---|---|---|---|---|
| CNN baseline | handwriting + audio + errors | `InitialCNNModel` | accuracy / F1 | Smallest multimodal baseline |
| Text baseline | text + behavior + errors | `InitialLSTMModel` | accuracy / F1 | Checks text-driven signal strength |
| Full baseline | image + audio + text + behavior + errors | `InitialCNNLSTMModel` | accuracy / F1 | Early full fusion reference |
| Default multimodal | all modalities | `MultimodalDyslexiaModel` | accuracy / F1 | Main production-style baseline |
| Transformer fusion | all modalities | `TransformerMultimodalModel` | accuracy / F1 | Tests stronger text modeling |
| Attention fusion | all modalities | `AttentionMultimodalModel` | accuracy / F1 + attention analysis | Tests interpretability |
| ViT fusion | all modalities | `ViTMultimodalModel` | accuracy / F1 | Tests patch-based handwriting modeling |

## 3. Low-Resource Transfer Experiments

| Experiment | Inputs | Method | Metric | Why It Matters |
|---|---|---|---|---|
| Scratch vs transfer | Bengali manifest | cross-lingual warm start | delta F1 | Measures transfer benefit |
| Freeze vs finetune | Bengali manifest + source checkpoint | prefix freezing | delta F1 | Finds stable warm-start recipe |
| Distillation test | Bengali manifest + teacher checkpoint | shared feature distillation | delta F1 / stability | Tests teacher-guided adaptation |
| Foundation adaptation | Bengali manifest | foundation + adapter | accuracy / F1 | Tests reusable latent space |

## 4. Explainability Experiments

| Experiment | Inputs | Method | Metric | Why It Matters |
|---|---|---|---|---|
| Grad-CAM check | handwriting images | `GradCAM` | human plausibility review | Tests image explanation quality |
| Attention check | multimodal outputs | modality attention | agreement score | Tests if weights are sensible |
| Text attention check | text sequences | transformer token scores | qualitative review | Tests token-level interpretability |
| Educational summary review | prediction output | explanation text | teacher usability feedback | Tests whether explanations are readable |

## 5. Biomarker Experiments

| Experiment | Inputs | Method | Metric | Why It Matters |
|---|---|---|---|---|
| Biomarker ranking | numeric manifest | `discover_digital_biomarkers` | ranking stability | Finds strongest signals |
| Family comparison | feature families | group analysis | effect size | Compares handwriting vs speech vs reading |
| Cross-language comparison | Bengali + English | split-wise analysis | rank overlap | Tests portability of markers |

## 6. Intervention Experiments

| Experiment | Inputs | Method | Metric | Why It Matters |
|---|---|---|---|---|
| Plan selection | learner profile | `InterventionPolicy` | chosen action consistency | Tests policy behavior |
| Reward update | session progress | policy update loop | reward improvement | Tests learning signal |
| Tutor adaptation | tutor state | `AdaptiveTutorAgent` | session score gain | Tests adaptive practice value |

## 7. Suggested Reporting Metrics

- accuracy
- F1 score
- recall for elevated-risk cases
- MAE for regression tasks
- explanation usefulness
- modality-attention stability
- biomarker rank stability
- intervention improvement across sessions
- cross-validation selection accuracy
- hard holdout F1 / precision / recall
