from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class StudentSample:
    sample_id: str
    student_hash: str
    handwriting_path: Path | None
    audio_path: Path | None
    text_sample: str
    spelling_errors: int
    pronunciation_errors: int
    label: int
    reading_time_seconds: float = 0.0
    hesitation_count: int = 0
    repetition_count: int = 0
    omission_count: int = 0


REQUIRED_MANIFEST_COLUMNS = {
    "sample_id",
    "student_hash",
    "handwriting_path",
    "audio_path",
    "text_sample",
    "spelling_errors",
    "pronunciation_errors",
    "label",
}

BEHAVIOR_COLUMNS = [
    "reading_time_seconds",
    "hesitation_count",
    "repetition_count",
    "omission_count",
]

EYE_TRACKING_COLUMNS = [
    "fixation_duration_ms",
    "regressions_count",
    "reading_speed_wpm",
    "gaze_dispersion",
    "scanpath_length",
    "mean_saccade_velocity",
]

ETHICS_COLUMNS = [
    "guardian_consent",
    "student_assent",
    "data_use_scope",
]

COLLECTION_METADATA_COLUMNS = [
    "age_group",
    "grade",
    "gender",
    "language",
    "school_region",
    "device_type",
    "collection_date",
    "annotator_id",
]

ERROR_DETAIL_COLUMNS = [
    "spelling_error_notes",
    "pronunciation_error_notes",
]
