# Research Proposal: Explainable Intervention Planning

## Title

Explainable Educational AI for Adaptive Intervention Planning in Learning-Disorder Support

## Problem Statement

Predictions alone are not enough for educational practice.
Teachers and parents need to know why a learner was flagged and what to do next.

## Research Scope

- convert model predictions into teacher, parent, and student explanations
- compare intervention plans across severity and error profiles
- evaluate whether biomarker summaries improve actionability
- study how explanation format affects usability
- keep the explanation layer separate from the model-selection snapshot used in the statistics hub

## Hypothesis

Plain-language explanations and structured intervention plans will make the system more actionable for non-technical users.

## Data Requirements

- screening outputs
- modality attention scores
- biomarker summaries
- therapy session metrics
- intervention logs

## Candidate Methods

- `build_educational_explanation`
- `InterventionPolicy`
- `AdaptiveTutorAgent`
- `score_therapy_session`
- `discover_digital_biomarkers`

## Evaluation Ideas

- human interpretability study
- teacher usability feedback
- intervention consistency across repeated sessions
- improvement between practice rounds

## Expected Output

- explanation templates for each user group
- intervention plan selection guidelines
- actionability report for classroom use

## Main Risks

- explanation quality may depend on model quality
- intervention policy may be too simple for complex learners
- human evaluation may be required to judge usefulness
