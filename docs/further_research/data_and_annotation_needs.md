# Data and Annotation Needs

## 1. Purpose

This file lists the data and annotation details needed for future research.
It is intended to reduce ambiguity before collecting or labeling new samples.

## 2. Required Data Types

### 2.1 Handwriting

Needed:

- scanned or photographed handwriting pages
- tablet or stylus handwriting samples
- optionally stroke-order or pen-dynamics data

Useful labels:

- learning-disorder / not flagged
- mild / moderate / severe
- dysgraphia-related handwriting difficulty

### 2.2 Reading audio

Needed:

- spoken reading samples
- prompt text for each recording
- metadata about language and reading context

Useful labels:

- pronunciation errors
- hesitations
- repetitions
- omissions
- reading fluency level

### 2.3 Text samples

Needed:

- short reading passages
- sentence reading prompts
- spelling task inputs

Useful labels:

- error count
- error type
- language tag

### 2.4 Reading behavior

Needed:

- reading time
- hesitation count
- repetition count
- omission count

Useful labels:

- fluency level
- task difficulty
- progress over time

### 2.5 Eye-tracking and visual focus

Needed:

- gaze traces
- fixation and saccade records
- visual-focus test outcomes

Useful labels:

- reading speed
- regressions
- fixation duration
- attention stability

### 2.6 Biomarker tables

Needed:

- numeric feature tables
- clear label columns
- consistent sample identifiers

Useful labels:

- screening label
- severity label
- language group

## 3. Annotation Guidelines

### 3.1 Consistency

- use the same label definitions across all annotators
- keep language tags explicit
- keep severity scales documented

### 3.2 Anonymization

- do not store names in manifests
- do not store phone numbers or school IDs unless absolutely required and consented
- prefer stable hashed identifiers

### 3.3 Missing values

- keep missing modality indicators explicit
- do not silently invent values
- record whether a missing value means not collected or not applicable

## 4. Recommended Metadata

Useful extra metadata fields:

- age group
- grade
- language
- school region
- device type
- annotator ID
- collection date

## 5. Data Quality Checks

- verify required columns exist
- check for duplicate sample IDs
- verify file paths resolve correctly
- inspect class imbalance
- inspect language coverage
- confirm audio duration is non-zero
- confirm handwriting files are readable

## 6. Research Implications

Higher-quality annotation will help most with:

- cross-lingual transfer
- severity modeling
- biomarker ranking
- intervention evaluation
- explainability validation
- trustworthy cross-validation selection and holdout evaluation
