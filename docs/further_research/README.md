# Further Research Pack

This folder groups research-oriented notes for future work on top of the current project.

## Overview

| File | Use |
|---|---|
| [`research_roadmap.md`](/d:/Project/Dyslexia_Detection_System/docs/further_research/research_roadmap.md) | Milestones and sequencing for future work |
| [`data_and_annotation_needs.md`](/d:/Project/Dyslexia_Detection_System/docs/further_research/data_and_annotation_needs.md) | Data collection and labeling checklist |
| [`experiment_matrix.md`](/d:/Project/Dyslexia_Detection_System/docs/further_research/experiment_matrix.md) | Experiment-by-experiment comparison matrix |
| [`publication_directions.md`](/d:/Project/Dyslexia_Detection_System/docs/further_research/publication_directions.md) | Paper and thesis direction ideas |

## Current Experiment Matrix Snapshot

The live dashboard and training pipeline now track a separate model-statistics hub plus the final test-lab comparison flow. For the latest tough benchmark snapshot, the active supervised model families are currently ranked as:

| Rank | Model | Notes |
|---|---|---|
| 1 | `multimodal_attention` | Best overall selection in the latest run |
| 2 | `transformer` | Strong sequence-aware multimodal baseline |
| 3 | `vit` | Vision-heavy variant with a stronger weighted selection score than CNN |

Older CNN and LSTM baselines remain in the catalog for historical comparison, but they are no longer part of the active three-model ranking snapshot.

Use [`experiment_matrix.md`](/d:/Project/Dyslexia_Detection_System/docs/further_research/experiment_matrix.md) for the more detailed experiment-by-experiment notes and to extend this table when you add new benchmark runs.

## Recommended Reading Order

1. Research roadmap
2. Data and annotation needs
3. Experiment matrix
4. Publication directions

## Files

- [`research_roadmap.md`](/d:/Project/Dyslexia_Detection_System/docs/further_research/research_roadmap.md)
- [`data_and_annotation_needs.md`](/d:/Project/Dyslexia_Detection_System/docs/further_research/data_and_annotation_needs.md)
- [`experiment_matrix.md`](/d:/Project/Dyslexia_Detection_System/docs/further_research/experiment_matrix.md)
- [`publication_directions.md`](/d:/Project/Dyslexia_Detection_System/docs/further_research/publication_directions.md)
