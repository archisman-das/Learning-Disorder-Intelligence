from __future__ import annotations

import tempfile
import textwrap
import wave
from datetime import datetime
from pathlib import Path
import os
import subprocess
import sys

import numpy as np
import pandas as pd
import streamlit as st
import torch
from PIL import Image

from src.dyslexia_detection.architecture import ScreeningPipeline
from src.dyslexia_detection.adaptive_tutoring import AdaptiveTutorAgent, append_tutoring_event, build_state, compute_reward
from src.dyslexia_detection.biomarkers import discover_digital_biomarkers
from src.dyslexia_detection.intervention import (
    InterventionPolicy,
    InterventionProfile,
    SEVERITY_NAME_TO_LEVEL,
    append_intervention_log,
    build_intervention_plan,
    reward_from_progress,
)
from src.dyslexia_detection.config import DataConfig, SUPPORTED_LANGUAGES
from src.dyslexia_detection.dataset import DyslexiaManifestDataset
from src.dyslexia_detection.dataset_tools import (
    ALL_MANIFEST_COLUMNS,
    append_manifest_row,
    create_dataset_workspace,
    prepare_dataset,
    split_manifest,
    validate_manifest,
)
from src.dyslexia_detection.educational_explanations import build_educational_explanation
from src.dyslexia_detection.eye_tracking import append_eye_tracking_metrics, compute_eye_tracking_metrics
from src.dyslexia_detection.explainability import GradCAM, transformer_text_attention_scores, vit_patch_attention_heatmap
from src.dyslexia_detection.federated import FederatedConfig, run_federated_training
from src.dyslexia_detection.optimization import (
    apply_dynamic_quantization,
    apply_global_pruning,
    benchmark_torchscript,
    export_torchscript,
)
from src.dyslexia_detection.models import build_model
from src.dyslexia_detection.preprocessing import (
    build_char_vocab,
    encode_text,
    extract_audio_features,
    load_handwriting_image,
)
from src.dyslexia_detection.speech_therapy import (
    append_therapy_session,
    create_therapy_workspace,
    estimate_wav_duration,
    relative_audio_path,
    score_therapy_session,
    speech_therapy_tasks_for_language,
    therapy_task_frame,
)


RISK_LABELS = {
    0: "Low risk",
    1: "Elevated risk",
}
SEVERITY_LABELS = {
    0: "Mild",
    1: "Moderate",
    2: "Severe",
}
DEFAULT_TEXT = "\u0986\u09ae\u09bf \u09ac\u09be\u0982\u09b2\u09be \u09aa\u09dc\u09bf"
DEFAULT_TEXT_BY_LANGUAGE = {
    "Bengali": "\u0986\u09ae\u09bf \u09ac\u09be\u0982\u09b2\u09be \u09aa\u09dc\u09bf",
    "English": "I read a short book",
    "Multilingual": "\u0986\u09ae\u09bf \u09ac\u09be\u0982\u09b2\u09be \u09aa\u09dc\u09bf",
}

REPORT_FIELD_LABELS = {
    "student_name": "Student Name",
    "age": "Age",
    "student_class": "Class",
    "roll_no": "Roll No",
    "section": "Section",
    "school_name": "School Name",
}


st.set_page_config(page_title="Dyslexia Detection Dashboard", layout="wide")
st.markdown(
    """
    <style>
    .block-container {padding-top: 1rem; padding-bottom: 2rem;}
    div[data-testid="stMetric"] {
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        padding: 0.55rem;
        background: #fafafa;
    }
    .stTabs [data-baseweb="tab-list"] {gap: 0.2rem;}
    .stTabs [data-baseweb="tab"] {
        border-radius: 6px;
        border: 1px solid #e5e7eb;
        padding: 0.4rem 0.7rem;
    }
    </style>
    """,
    unsafe_allow_html=True,
)


@st.cache_resource
def load_model(checkpoint_path: str = "checkpoints/best_model.pt") -> torch.nn.Module:
    checkpoint = Path(checkpoint_path)
    model = build_model("multimodal", DataConfig())
    if checkpoint.exists():
        payload = torch.load(checkpoint, map_location="cpu")
        data_config = payload.get("data_config", DataConfig())
        if isinstance(data_config, dict):
            data_config = DataConfig(**data_config)
        num_classes = int(payload.get("num_classes", 2))
        model = build_model(payload.get("model_name", "multimodal"), data_config, num_classes=num_classes)
        model.load_state_dict(payload["model_state"])
    model.eval()
    return model


@st.cache_data
def load_manifest(manifest_path: str) -> pd.DataFrame:
    return pd.read_csv(manifest_path)


@st.cache_data
def load_history(history_path: str) -> pd.DataFrame:
    path = Path(history_path)
    if not path.exists():
        return pd.DataFrame(columns=["epoch", "loss", "val_accuracy", "val_f1"])
    return pd.read_csv(path)


def initialize_report_state() -> None:
    st.session_state.setdefault(
        "report_student_info",
        {
            "student_name": "",
            "age": "",
            "student_class": "",
            "roll_no": "",
            "section": "",
            "school_name": "",
        },
    )
    st.session_state.setdefault("report_screening", None)
    st.session_state.setdefault("report_therapy", None)
    st.session_state.setdefault("report_eye", None)
    st.session_state.setdefault("report_biomarkers", None)
    st.session_state.setdefault("generated_final_report", None)


def set_report_result(key: str, value: dict[str, object]) -> None:
    st.session_state[key] = value
    st.session_state["generated_final_report"] = None


def format_percent(value: object) -> str:
    try:
        return f"{float(value) * 100:.1f}%"
    except (TypeError, ValueError):
        return "N/A"


def format_decimal(value: object, digits: int = 2) -> str:
    try:
        return f"{float(value):.{digits}f}"
    except (TypeError, ValueError):
        return "N/A"


def missing_report_fields(student_info: dict[str, str]) -> list[str]:
    missing: list[str] = []
    for key, label in REPORT_FIELD_LABELS.items():
        if not str(student_info.get(key, "")).strip():
            missing.append(label)
    return missing


def build_final_report_payload() -> dict[str, object]:
    student_info = dict(st.session_state.get("report_student_info", {}))
    screening = st.session_state.get("report_screening")
    therapy = st.session_state.get("report_therapy")
    eye = st.session_state.get("report_eye")
    biomarkers = st.session_state.get("report_biomarkers")

    sections: list[dict[str, object]] = []
    overview: list[str] = []
    recommendations: list[str] = []

    if screening:
        sections.append(
            {
                "title": "Screening",
                "lines": [
                    f"Result: {screening.get('label_text', 'Not available')}",
                    f"Confidence: {format_percent(screening.get('confidence'))}",
                    str(screening.get("summary", "Screening summary is not available.")),
                ],
            }
        )
        overview.append(f"Screening suggests {screening.get('label_text', 'an undetermined pattern')}.")
        recommendations.append("Review the screening result together with the class teacher and guardian.")

    if therapy:
        sections.append(
            {
                "title": "Speech Therapy",
                "lines": [
                    f"Session score: {format_percent(therapy.get('therapy_score'))}",
                    str(therapy.get("recommendation", "Therapy recommendation is not available.")),
                ],
            }
        )
        overview.append(f"Speech practice score is {format_percent(therapy.get('therapy_score'))}.")
        recommendations.append("Continue short and regular speech practice sessions.")

    if eye:
        sections.append(
            {
                "title": "Eye Tracking",
                "lines": [
                    f"Reading speed: {format_decimal(eye.get('reading_speed_wpm'))} WPM",
                    f"Regressions: {eye.get('regressions_count', 'N/A')}",
                    f"Fixation duration: {format_decimal(eye.get('fixation_duration_ms'))} ms",
                    f"Gaze dispersion: {format_decimal(eye.get('gaze_dispersion'))}",
                ],
            }
        )
        overview.append(f"Eye tracking recorded reading speed of {format_decimal(eye.get('reading_speed_wpm'))} WPM.")
        recommendations.append("Repeat the eye-tracking task in a calm setting if the child seemed distracted.")

    if biomarkers:
        strongest_name = biomarkers.get("top_biomarker", "Not available")
        strongest_score = biomarkers.get("top_importance")
        sections.append(
            {
                "title": "Biomarkers",
                "lines": [
                    f"Markers analyzed: {biomarkers.get('count', 0)}",
                    f"Strongest marker: {strongest_name} ({format_decimal(strongest_score, 4)})",
                ],
            }
        )
        overview.append(f"Biomarker review highlights {strongest_name} as the strongest signal.")
        recommendations.append("Use biomarker findings together with screening, therapy, and classroom observation.")

    if not sections:
        overview.append("No test results have been saved yet.")
        recommendations.append("Complete at least one test before generating the final report.")

    unique_recommendations = list(dict.fromkeys(recommendations))
    return {
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "student_info": student_info,
        "sections": sections,
        "overview": overview,
        "recommendations": unique_recommendations,
    }


def create_pdf_bytes(lines: list[str]) -> bytes:
    page_width = 612
    page_height = 792
    start_x = 50
    start_y = 750
    line_height = 16
    max_lines_per_page = 42

    def escape_pdf_text(value: str) -> str:
        return value.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")

    pages = [lines[index : index + max_lines_per_page] for index in range(0, len(lines), max_lines_per_page)] or [[]]
    objects: list[str] = []

    def add_object(content: str) -> int:
        objects.append(content)
        return len(objects)

    catalog_id = add_object("<< /Type /Catalog /Pages 2 0 R >>")
    pages_id = add_object("<< /Type /Pages /Count 0 /Kids [] >>")
    font_id = add_object("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    page_ids: list[int] = []

    for page_lines in pages:
        stream_lines = ["BT", "/F1 11 Tf", f"{line_height} TL", f"{start_x} {start_y} Td"]
        for index, line in enumerate(page_lines):
            if index > 0:
                stream_lines.append("T*")
            stream_lines.append(f"({escape_pdf_text(line)}) Tj")
        stream_lines.append("ET")
        stream = "\n".join(stream_lines)
        content_id = add_object(f"<< /Length {len(stream)} >>\nstream\n{stream}\nendstream")
        page_id = add_object(
            f"<< /Type /Page /Parent {pages_id} 0 R /MediaBox [0 0 {page_width} {page_height}] "
            f"/Resources << /Font << /F1 {font_id} 0 R >> >> /Contents {content_id} 0 R >>"
        )
        page_ids.append(page_id)

    objects[pages_id - 1] = (
        f"<< /Type /Pages /Count {len(page_ids)} /Kids [{' '.join(f'{page_id} 0 R' for page_id in page_ids)}] >>"
    )

    pdf = "%PDF-1.4\n"
    offsets = [0]
    for index, content in enumerate(objects, start=1):
        offsets.append(len(pdf))
        pdf += f"{index} 0 obj\n{content}\nendobj\n"

    xref_start = len(pdf)
    pdf += f"xref\n0 {len(objects) + 1}\n"
    pdf += "0000000000 65535 f \n"
    for offset in offsets[1:]:
        pdf += f"{offset:010d} 00000 n \n"
    pdf += f"trailer\n<< /Size {len(objects) + 1} /Root {catalog_id} 0 R >>\nstartxref\n{xref_start}\n%%EOF"
    return pdf.encode("latin-1", errors="replace")


def final_report_pdf_bytes(report: dict[str, object]) -> bytes:
    student_info = report["student_info"]
    lines = [
        "Learning Disorder Intelligence - Final Report",
        "",
        f"Generated: {report['generated_at']}",
        "",
        "Student Details",
        f"Student Name: {student_info['student_name']}",
        f"Age: {student_info['age']}",
        f"Class: {student_info['student_class']}",
        f"Roll No: {student_info['roll_no']}",
        f"Section: {student_info['section']}",
        f"School Name: {student_info['school_name']}",
        "",
        "Overview",
    ]
    for item in report["overview"]:
        lines.extend(textwrap.wrap(str(item), width=90) or [""])
    lines.append("")

    for section in report["sections"]:
        lines.append(str(section["title"]))
        for line in section["lines"]:
            lines.extend(textwrap.wrap(str(line), width=90) or [""])
        lines.append("")

    lines.append("Recommended Next Steps")
    for item in report["recommendations"]:
        lines.extend(textwrap.wrap(str(item), width=90) or [""])
    return create_pdf_bytes(lines)


def save_upload(uploaded_file) -> Path | None:
    if uploaded_file is None:
        return None
    suffix = Path(uploaded_file.name).suffix
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as handle:
        handle.write(uploaded_file.getbuffer())
        return Path(handle.name)


def save_camera_capture(camera_file) -> Path | None:
    if camera_file is None:
        return None
    with tempfile.NamedTemporaryFile(delete=False, suffix=".png") as handle:
        handle.write(camera_file.getbuffer())
        return Path(handle.name)


def persist_uploaded_file(uploaded_file, destination: Path, relative_root: Path) -> str:
    if uploaded_file is None:
        return ""
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("wb") as handle:
        handle.write(uploaded_file.getbuffer())
    return os.path.relpath(destination, relative_root)


def resolve_manifest_path(manifest_path: Path, value: object) -> Path | None:
    if pd.isna(value) or not str(value).strip():
        return None
    path = Path(str(value))
    if path.is_absolute():
        return path
    return manifest_path.parent / path


def audio_duration(path: Path | None) -> float | None:
    if path is None or not path.exists() or path.suffix.lower() != ".wav":
        return None
    with wave.open(str(path), "rb") as handle:
        return handle.getnframes() / float(handle.getframerate())


def predict(
    model: torch.nn.Module,
    image_path: Path | None,
    audio_path: Path | None,
    text_sample: str,
    spelling_errors: int,
    pronunciation_errors: int,
    reading_time_seconds: float = 0.0,
    hesitation_count: int = 0,
    repetition_count: int = 0,
    omission_count: int = 0,
    sample_language: str = "Bengali",
    model_text_language: str = "bengali",
) -> tuple[int, float, np.ndarray]:
    config = DataConfig()
    vocab = build_char_vocab(model_text_language)
    image = torch.tensor(load_handwriting_image(image_path, config), dtype=torch.float32).unsqueeze(0)
    audio = torch.tensor(extract_audio_features(audio_path, config), dtype=torch.float32).unsqueeze(0)
    text = torch.tensor(encode_text(text_sample, vocab, config.max_text_length, sample_language), dtype=torch.long).unsqueeze(0)
    errors = torch.tensor([[spelling_errors, pronunciation_errors]], dtype=torch.float32)
    behavior = torch.tensor(
        [[reading_time_seconds, hesitation_count, repetition_count, omission_count]],
        dtype=torch.float32,
    )

    with torch.no_grad():
        probabilities = torch.softmax(model(image, audio, text, errors, behavior), dim=1)
    predicted = int(probabilities.argmax(dim=1).item())
    confidence = float(probabilities[0, predicted].item())
    return predicted, confidence, probabilities.squeeze(0).numpy()


def label_from_probabilities(probabilities: np.ndarray) -> str:
    label = int(np.argmax(probabilities))
    if probabilities.shape[0] == 3:
        return SEVERITY_LABELS.get(label, f"Class {label}")
    return RISK_LABELS.get(label, f"Class {label}")


def profile_from_screening(
    label_text: str,
    sample_language: str,
    spelling_errors: int,
    pronunciation_errors: int,
    reading_time_seconds: float,
    hesitation_count: int,
    repetition_count: int,
    omission_count: int,
) -> InterventionProfile:
    severity_level = SEVERITY_NAME_TO_LEVEL.get(label_text.lower(), 1)
    return InterventionProfile(
        language=sample_language,
        severity_level=int(severity_level),
        spelling_errors=int(spelling_errors),
        pronunciation_errors=int(pronunciation_errors),
        reading_time_seconds=float(reading_time_seconds),
        hesitation_count=int(hesitation_count),
        repetition_count=int(repetition_count),
        omission_count=int(omission_count),
    )


def render_intervention_panel(profile: InterventionProfile, student_hash: str = "dashboard_user") -> None:
    root = Path("data/collection/intervention")
    policy_path = root / "policy.json"
    log_path = root / "recommendations.csv"
    policy = InterventionPolicy.load_or_create(policy_path)
    plan = build_intervention_plan(profile, policy)
    st.subheader("Personalized Intervention Recommendation")
    st.write(f"Reading exercise: {plan.reading_exercise}")
    st.write(f"Pronunciation exercise: {plan.pronunciation_exercise}")
    st.write(f"Spelling exercise: {plan.spelling_exercise}")
    st.metric("Weekly practice target", f"{plan.weekly_target_minutes} min")
    st.caption(plan.notes)
    append_intervention_log(
        log_path,
        {
            "student_hash": student_hash,
            "language": profile.language,
            "state": profile.state_key(),
            "action": plan.action,
            "severity_level": profile.severity_level,
            "reading_exercise": plan.reading_exercise,
            "pronunciation_exercise": plan.pronunciation_exercise,
            "spelling_exercise": plan.spelling_exercise,
            "weekly_target_minutes": plan.weekly_target_minutes,
        },
    )
    if st.button("Update Intervention Policy", key="update_intervention_policy_dashboard"):
        reward = reward_from_progress(
            profile.reading_time_seconds,
            profile.hesitation_count,
            profile.repetition_count,
            profile.omission_count,
            profile.pronunciation_errors,
            profile.spelling_errors,
        )
        next_profile = InterventionProfile(
            language=profile.language,
            severity_level=max(profile.severity_level - 1, 0) if reward > 0.35 else profile.severity_level,
            spelling_errors=max(profile.spelling_errors - (1 if reward > 0.35 else 0), 0),
            pronunciation_errors=max(profile.pronunciation_errors - (1 if reward > 0.35 else 0), 0),
            reading_time_seconds=max(profile.reading_time_seconds - (4.0 if reward > 0.35 else 0.0), 0.0),
            hesitation_count=max(profile.hesitation_count - (1 if reward > 0.35 else 0), 0),
            repetition_count=max(profile.repetition_count - (1 if reward > 0.35 else 0), 0),
            omission_count=max(profile.omission_count - (1 if reward > 0.35 else 0), 0),
        )
        policy.update(profile.state_key(), plan.action, reward, next_profile.state_key())
        policy.save(policy_path)
        st.success(f"Intervention policy updated (reward={reward:.2f}).")


def score_manifest(manifest_path: str, checkpoint_modified_time: float) -> pd.DataFrame:
    _ = checkpoint_modified_time
    dataset = DyslexiaManifestDataset(manifest_path)
    model = load_model()
    rows = []
    with torch.no_grad():
        for index in range(len(dataset)):
            batch = dataset[index]
            logits = model(
                batch["image"].unsqueeze(0),
                batch["audio"].unsqueeze(0),
                batch["text"].unsqueeze(0),
                batch["errors"].unsqueeze(0),
                batch["behavior"].unsqueeze(0),
            )
            probabilities = torch.softmax(logits, dim=1).squeeze(0).numpy()
            rows.append(
                {
                    "sample_id": dataset.frame.iloc[index]["sample_id"],
                    "actual_label": int(dataset.frame.iloc[index]["label"]),
                    "predicted_label": int(probabilities.argmax()),
                    "low_risk_probability": float(probabilities[0]),
                    "elevated_risk_probability": float(probabilities[1]) if probabilities.shape[0] > 1 else float(probabilities[0]),
                    "confidence": float(probabilities.max()),
                }
            )
    return pd.DataFrame(rows)


def overlay_heatmap(image_tensor: torch.Tensor, heatmap_tensor: torch.Tensor) -> Image.Image:
    heatmap = heatmap_tensor.squeeze().detach().cpu().numpy()
    image = image_tensor.squeeze().detach().cpu().numpy()
    image_rgb = np.stack([image, image, image], axis=-1)
    overlay = image_rgb.copy()
    overlay[:, :, 0] = np.clip(overlay[:, :, 0] + heatmap * 0.75, 0, 1)
    overlay[:, :, 1] = np.clip(overlay[:, :, 1] * (1 - heatmap * 0.35), 0, 1)
    overlay[:, :, 2] = np.clip(overlay[:, :, 2] * (1 - heatmap * 0.35), 0, 1)
    return Image.fromarray((overlay * 255).astype(np.uint8))


def generate_explanations(manifest_path: Path, sample_id: str, checkpoint_path: str) -> dict[str, object]:
    dataset = DyslexiaManifestDataset(manifest_path)
    matches = dataset.frame.index[dataset.frame["sample_id"].astype(str) == str(sample_id)].tolist()
    if not matches:
        return {}

    row = dataset.frame.iloc[matches[0]]
    batch = dataset[matches[0]]
    model = load_model(checkpoint_path)
    image = batch["image"].unsqueeze(0)
    audio = batch["audio"].unsqueeze(0)
    text = batch["text"].unsqueeze(0)
    errors = batch["errors"].unsqueeze(0)
    behavior = batch["behavior"].unsqueeze(0)
    explanations: dict[str, object] = {}

    if hasattr(model.handwriting, "features"):
        target_layer = model.handwriting.features[8]
        cam = GradCAM(model, target_layer).generate(
            image,
            audio,
            text,
            errors,
            behavior,
        )
        explanations["grad_cam"] = overlay_heatmap(batch["image"], cam)

    vit_heatmap = vit_patch_attention_heatmap(model, image)
    if vit_heatmap is not None:
        explanations["vit_attention"] = overlay_heatmap(batch["image"], vit_heatmap)

    text_attention = transformer_text_attention_scores(model, text)
    if text_attention is not None:
        chars = list(str(row["text_sample"]))[: DataConfig().max_text_length]
        scores = text_attention.squeeze(0).detach().cpu().numpy()[: len(chars)]
        explanations["text_attention"] = pd.DataFrame(
            {
                "position": list(range(1, len(chars) + 1)),
                "token": chars,
                "attention": scores,
            }
        )

    with torch.no_grad():
        probabilities = torch.softmax(
            model(
                image,
                audio,
                text,
                errors,
                behavior,
            ),
            dim=1,
        ).squeeze(0)
    modality_attention: dict[str, float] = {}
    last_attention = getattr(model, "last_modality_attention", None)
    if isinstance(last_attention, dict):
        for key, value in last_attention.items():
            if hasattr(value, "mean"):
                modality_attention[key] = float(value.mean().detach().cpu().item())
    explanations["prediction"] = {
        "label": int(probabilities.argmax().item()),
        "confidence": float(probabilities.max().item()),
        "probabilities": probabilities.detach().cpu().numpy(),
        "sample_language": str(row.get("sample_language", "Bengali")),
        "spelling_errors": int(row.get("spelling_errors", 0)),
        "pronunciation_errors": int(row.get("pronunciation_errors", 0)),
        "reading_time_seconds": float(row.get("reading_time_seconds", 0.0)),
        "hesitation_count": int(row.get("hesitation_count", 0)),
        "repetition_count": int(row.get("repetition_count", 0)),
        "omission_count": int(row.get("omission_count", 0)),
        "modality_attention": modality_attention,
    }
    return explanations


def render_educational_ai_panel(
    label_text: str,
    confidence: float,
    probabilities: np.ndarray,
    sample_language: str,
    spelling_errors: int,
    pronunciation_errors: int,
    reading_time_seconds: float,
    hesitation_count: int,
    repetition_count: int,
    omission_count: int,
    modality_attention: dict[str, float] | None = None,
) -> None:
    explanation = build_educational_explanation(
        label_text=label_text,
        confidence=confidence,
        probabilities=probabilities,
        spelling_errors=spelling_errors,
        pronunciation_errors=pronunciation_errors,
        reading_time_seconds=reading_time_seconds,
        hesitation_count=hesitation_count,
        repetition_count=repetition_count,
        omission_count=omission_count,
        sample_language=sample_language,
        modality_attention=modality_attention,
    )
    st.markdown("**Explainable Educational AI**")
    st.caption(explanation.summary)
    tab_teacher, tab_parent, tab_student = st.tabs(["Teacher", "Parent", "Student"])
    with tab_teacher:
        st.write(explanation.teacher)
    with tab_parent:
        st.write(explanation.parent)
    with tab_student:
        st.write(explanation.student)
    st.markdown("**Suggested Next Steps**")
    for step in explanation.next_steps:
        st.write(f"- {step}")


def metric_card(label: str, value: object, help_text: str | None = None) -> None:
    st.metric(label, value, help=help_text)


def render_overview(frame: pd.DataFrame) -> None:
    total_samples = len(frame)
    elevated_count = int((frame["label"] == 1).sum()) if "label" in frame else 0
    missing_handwriting = int(frame["handwriting_path"].isna().sum() + (frame["handwriting_path"].astype(str).str.len() == 0).sum())
    missing_audio = int(frame["audio_path"].isna().sum() + (frame["audio_path"].astype(str).str.len() == 0).sum())

    top = st.columns(4)
    with top[0]:
        metric_card("Samples", total_samples)
    with top[1]:
        metric_card("Elevated risk", elevated_count)
    with top[2]:
        metric_card("Missing handwriting", missing_handwriting)
    with top[3]:
        metric_card("Missing audio", missing_audio)

    left, right = st.columns([1, 1])
    with left:
        label_counts = frame["label"].map(RISK_LABELS).value_counts().rename_axis("risk_label").reset_index(name="samples")
        st.subheader("Risk Distribution")
        st.bar_chart(label_counts, x="risk_label", y="samples", width="stretch")

    with right:
        error_frame = frame[["spelling_errors", "pronunciation_errors", "label"]].copy()
        error_frame["risk_label"] = error_frame["label"].map(RISK_LABELS)
        st.subheader("Error Pattern")
        st.scatter_chart(
            error_frame,
            x="spelling_errors",
            y="pronunciation_errors",
            color="risk_label",
            width="stretch",
        )

    behavior_columns = ["reading_time_seconds", "hesitation_count", "repetition_count", "omission_count"]
    if set(behavior_columns).issubset(frame.columns):
        st.subheader("Reading Behavior by Risk Group")
        behavior_frame = frame.assign(risk_label=frame["label"].map(RISK_LABELS))
        st.bar_chart(
            behavior_frame.groupby("risk_label")[behavior_columns].mean(),
            width="stretch",
        )

    st.subheader("Average Errors by Risk Group")
    grouped = (
        frame.assign(risk_label=frame["label"].map(RISK_LABELS))
        .groupby("risk_label")[["spelling_errors", "pronunciation_errors"]]
        .mean()
        .reset_index()
    )
    st.dataframe(grouped, width="stretch", hide_index=True)


def render_biomarker_discovery(manifest_path: Path) -> None:
    st.subheader("Digital Biomarker Discovery")
    top_k = st.slider("Top biomarkers to view", min_value=5, max_value=30, value=12, step=1)
    if st.button("Run Biomarker Discovery", type="primary"):
        result = discover_digital_biomarkers(manifest_path)
        if result.summary.empty:
            st.warning("No biomarker summary could be generated.")
            return
        st.metric("Biomarkers analyzed", len(result.summary))
        top = result.summary.head(top_k)
        st.dataframe(top, width="stretch", hide_index=True)
        st.bar_chart(top.set_index("biomarker")["importance_score"], width="stretch")
        top_row = top.iloc[0]
        set_report_result(
            "report_biomarkers",
            {
                "count": int(len(result.summary)),
                "top_biomarker": str(top_row["biomarker"]),
                "top_importance": float(top_row["importance_score"]),
            },
        )
        output_dir = Path("reports/biomarkers")
        output_dir.mkdir(parents=True, exist_ok=True)
        dataset_path = output_dir / "biomarker_dataset.csv"
        summary_path = output_dir / "biomarker_summary.csv"
        result.dataset.to_csv(dataset_path, index=False)
        result.summary.to_csv(summary_path, index=False)
        st.caption(f"Saved biomarker dataset: {dataset_path}")
        st.caption(f"Saved biomarker summary: {summary_path}")


def render_dataset_explorer(frame: pd.DataFrame, manifest_path: Path) -> None:
    selected_id = st.selectbox("Sample", frame["sample_id"].astype(str).tolist())
    row = frame.loc[frame["sample_id"].astype(str) == selected_id].iloc[0]
    image_path = resolve_manifest_path(manifest_path, row["handwriting_path"])
    audio_path = resolve_manifest_path(manifest_path, row["audio_path"])

    left, middle, right = st.columns([1, 1, 1])
    with left:
        st.subheader("Handwriting")
        if image_path and image_path.exists():
            st.image(Image.open(image_path), width="stretch")
        else:
            st.info("No handwriting image found for this sample.")

    with middle:
        st.subheader("Reading Audio")
        duration = audio_duration(audio_path)
        if audio_path and audio_path.exists():
            st.audio(str(audio_path))
            if duration is not None:
                st.metric("Duration", f"{duration:.2f}s")
        else:
            st.info("No audio file found for this sample.")

    with right:
        st.subheader("Annotation")
        st.metric("Risk label", RISK_LABELS[int(row["label"])])
        st.metric("Spelling errors", int(row["spelling_errors"]))
        st.metric("Pronunciation errors", int(row["pronunciation_errors"]))
        if "reading_time_seconds" in row:
            st.metric("Reading time", f"{float(row['reading_time_seconds']):.2f}s")
        if "hesitation_count" in row:
            st.metric("Hesitations", int(row["hesitation_count"]))
        if "repetition_count" in row:
            st.metric("Repetitions", int(row["repetition_count"]))
        if "omission_count" in row:
            st.metric("Omissions", int(row["omission_count"]))

    st.subheader("Text Sample")
    st.code(str(row["text_sample"]), language=None)
    st.subheader("Manifest Row")
    st.dataframe(pd.DataFrame([row]), width="stretch", hide_index=True)


def render_dataset_creation(frame: pd.DataFrame, manifest_path: Path) -> None:
    st.subheader("Dataset Creation Workflow")
    st.code(
        "python scripts/setup_dataset_workspace.py --root data/collection\n"
        "python scripts/create_collection_template.py --output data/collection/manifest_template.csv\n"
        "python scripts/validate_manifest.py --manifest data/collection/manifest.csv\n"
        "python scripts/anonymize_manifest.py --input data/collection/manifest.csv --output data/collection/manifest_anonymized.csv --salt YOUR_PRIVATE_SALT\n"
        "python scripts/augment_handwriting_dataset.py --manifest data/collection/manifest_anonymized.csv --output-manifest data/collection/augmented_manifest.csv\n"
        "python scripts/augment_audio_dataset.py --manifest data/collection/augmented_manifest.csv --output-manifest data/collection/audio_augmented_manifest.csv\n"
        "python scripts/split_manifest.py --manifest data/collection/audio_augmented_manifest.csv --output-dir data/collection/splits",
        language="powershell",
    )
    st.caption("For the complete cleaning, normalization, augmentation, and split pipeline, run:")
    st.code(
        "python scripts/prepare_collected_dataset.py --manifest data/collection/manifest.csv --output-root data/collection/processed --split",
        language="powershell",
    )

    st.subheader("Schema")
    schema_frame = pd.DataFrame(
        {
            "column": ALL_MANIFEST_COLUMNS,
            "purpose": [
                "unique sample id",
                "anonymous user id",
                "relative or absolute handwriting image path",
                "relative or absolute reading audio path",
                "Bengali text prompt or response",
                "count of spelling errors",
                "count of pronunciation errors",
                "reading duration",
                "observed pauses",
                "repeated letters or words",
                "missed letters or words",
                "spelling error details",
                "pronunciation error details",
                "guardian consent flag",
                "participant assent flag",
                "allowed research use scope",
                "participant age band",
                "school grade",
                "optional demographic field",
                "primary language",
                "school location band",
                "recording/scanning device",
                "collection date",
                "anonymous annotator id",
                "risk label",
            ],
        }
    )
    st.dataframe(schema_frame, width="stretch", hide_index=True)

    st.subheader("Current Manifest Quality")
    issues = validate_manifest(manifest_path)
    if issues:
        for issue in issues:
            st.warning(issue)
    else:
        st.success("Current manifest validation passed.")

    quality = {
        "samples": len(frame),
        "unique_students": frame["student_hash"].nunique() if "student_hash" in frame else 0,
        "handwriting_files": int(frame["handwriting_path"].astype(str).str.len().gt(0).sum()),
        "audio_files": int(frame["audio_path"].astype(str).str.len().gt(0).sum()),
        "low_risk": int((frame["label"] == 0).sum()) if "label" in frame else 0,
        "elevated_risk": int((frame["label"] == 1).sum()) if "label" in frame else 0,
    }
    cols = st.columns(3)
    for index, (key, value) in enumerate(quality.items()):
        with cols[index % 3]:
            st.metric(key.replace("_", " ").title(), value)


def render_data_preparation() -> None:
    st.subheader("Clean, Normalize, and Augment Collected Data")
    workspace = Path(st.text_input("Workspace", value="data/collection", key="prep_workspace"))
    source_manifest = Path(st.text_input("Source manifest", value=str(workspace / "manifest.csv"), key="prep_manifest"))
    output_root = Path(st.text_input("Output root", value=str(workspace / "processed"), key="prep_output"))
    left, right = st.columns([1, 1])
    with left:
        handwriting_variants = st.number_input("Handwriting variants per sample", min_value=0, max_value=8, value=2)
    with right:
        audio_variants = st.number_input("Audio variants per sample", min_value=0, max_value=8, value=2)

    if st.button("Prepare collected dataset", type="primary"):
        if not source_manifest.exists():
            st.error(f"Manifest not found: {source_manifest}")
            return
        outputs = prepare_dataset(
            source_manifest,
            output_root,
            handwriting_variants=int(handwriting_variants),
            audio_variants=int(audio_variants),
        )
        split_paths = split_manifest(outputs["prepared_manifest"], output_root / "splits")
        st.success("Dataset preparation complete.")
        st.dataframe(
            pd.DataFrame(
                [{"artifact": key, "path": str(path)} for key, path in {**outputs, **split_paths}.items()]
            ),
            width="stretch",
            hide_index=True,
        )
        issues = validate_manifest(outputs["prepared_manifest"])
        if issues:
            for issue in issues:
                st.warning(issue)
        else:
            st.info("Prepared manifest validates successfully.")


def render_sample_collection() -> None:
    st.subheader("Gather Handwriting, Text, and Audio Samples")
    workspace = Path(st.text_input("Collection workspace", value="data/collection"))
    manifest_path = workspace / "manifest.csv"

    if st.button("Prepare collection workspace"):
        create_dataset_workspace(workspace)
        st.success(f"Workspace ready: {workspace}")

    with st.form("sample_collection_form", clear_on_submit=False):
        left, right = st.columns([1, 1])
        with left:
            sample_id = st.text_input("Sample ID", value="S_NEW_001")
            student_hash = st.text_input("Anonymous user ID", value="anon_user_001")
            sample_language = st.selectbox("Sample language", list(DEFAULT_TEXT_BY_LANGUAGE), key="collect_language")
            handwriting_upload = st.file_uploader("Handwriting image", type=["png", "jpg", "jpeg"], key="collect_handwriting")
            audio_upload = st.file_uploader("Reading audio", type=["wav"], key="collect_audio")
            text_sample = st.text_area("Text sample", value=DEFAULT_TEXT_BY_LANGUAGE[sample_language], key="collect_text")
        with right:
            spelling_errors = st.number_input("Spelling errors", min_value=0, max_value=100, value=0)
            pronunciation_errors = st.number_input("Pronunciation errors", min_value=0, max_value=100, value=0)
            reading_time_seconds = st.number_input("Reading time seconds", min_value=0.0, max_value=600.0, value=0.0)
            hesitation_count = st.number_input("Hesitations", min_value=0, max_value=100, value=0)
            repetition_count = st.number_input("Repetitions", min_value=0, max_value=100, value=0)
            omission_count = st.number_input("Omissions", min_value=0, max_value=100, value=0)
            label = st.selectbox("Screening label", options=[0, 1], format_func=lambda value: RISK_LABELS[value])

        consent_left, consent_right = st.columns([1, 1])
        with consent_left:
            guardian_consent = st.checkbox("Participant/guardian consent received", value=True)
            student_assent = st.checkbox("Participant assent received", value=True)
        with consent_right:
            data_use_scope = st.selectbox("Data use scope", ["research", "screening", "teaching-support"])
            annotator_id = st.text_input("Annotator ID", value="annotator_001")

        submitted = st.form_submit_button("Save collected sample", type="primary")

    if submitted:
        if not sample_id.strip() or not student_hash.strip():
            st.error("Sample ID and anonymous user ID are required.")
            return
        if not guardian_consent or not student_assent:
            st.error("Consent and assent must be recorded before saving a sample.")
            return

        create_dataset_workspace(workspace)
        image_suffix = Path(handwriting_upload.name).suffix if handwriting_upload else ".png"
        audio_suffix = Path(audio_upload.name).suffix if audio_upload else ".wav"
        handwriting_path = persist_uploaded_file(
            handwriting_upload,
            workspace / "raw" / "handwriting" / f"{sample_id}{image_suffix}",
            workspace,
        )
        audio_path = persist_uploaded_file(
            audio_upload,
            workspace / "raw" / "audio" / f"{sample_id}{audio_suffix}",
            workspace,
        )

        try:
            append_manifest_row(
                manifest_path,
                {
                    "sample_id": sample_id.strip(),
                    "student_hash": student_hash.strip(),
                    "handwriting_path": handwriting_path,
                    "audio_path": audio_path,
                    "text_sample": text_sample,
                    "spelling_errors": int(spelling_errors),
                    "pronunciation_errors": int(pronunciation_errors),
                    "reading_time_seconds": float(reading_time_seconds),
                    "hesitation_count": int(hesitation_count),
                    "repetition_count": int(repetition_count),
                    "omission_count": int(omission_count),
                    "guardian_consent": "yes",
                    "student_assent": "yes",
                    "data_use_scope": data_use_scope,
                    "language": sample_language,
                    "annotator_id": annotator_id,
                    "label": int(label),
                },
            )
        except ValueError as error:
            st.error(str(error))
            return

        st.success(f"Saved sample {sample_id} to {manifest_path}")
        issues = validate_manifest(manifest_path)
        if issues:
            for issue in issues:
                st.warning(issue)
        else:
            st.info("Updated collection manifest validates successfully.")


def render_model_analytics(manifest_path: Path) -> None:
    checkpoint = Path("checkpoints/best_model.pt")
    history = load_history("checkpoints/training_history.csv")

    top = st.columns(3)
    with top[0]:
        st.metric("Checkpoint", "Available" if checkpoint.exists() else "Not trained")
    with top[1]:
        if checkpoint.exists():
            st.metric("Checkpoint size", f"{checkpoint.stat().st_size / 1024:.1f} KB")
        else:
            st.metric("Checkpoint size", "0 KB")
    with top[2]:
        st.metric("Training epochs logged", len(history))

    if not history.empty:
        st.subheader("Training Curves")
        curve_frame = history.set_index("epoch")[["loss", "val_accuracy", "val_f1"]]
        st.line_chart(curve_frame, width="stretch")
    else:
        st.info("No training history found yet. Run training to populate this section.")

    if checkpoint.exists():
        st.subheader("Dataset Predictions")
        modified = checkpoint.stat().st_mtime
        scored = score_manifest(str(manifest_path), modified)
        prediction_counts = scored["predicted_label"].map(RISK_LABELS).value_counts().rename_axis("prediction").reset_index(name="samples")
        left, right = st.columns([1, 1])
        with left:
            st.bar_chart(prediction_counts, x="prediction", y="samples", width="stretch")
        with right:
            st.dataframe(scored, width="stretch", hide_index=True)


def render_explainability(frame: pd.DataFrame, manifest_path: Path) -> None:
    st.subheader("Explainability")
    selected_id = st.selectbox("Explain sample", frame["sample_id"].astype(str).tolist(), key="explain_sample")
    checkpoint_path = st.text_input(
        "Checkpoint path",
        value="checkpoints/best_model.pt",
        help="Use checkpoints/transformer/best_model.pt, checkpoints/vit/best_model.pt, or checkpoints/vit_transformer/best_model.pt for attention views.",
    )
    explanations = generate_explanations(manifest_path, selected_id, checkpoint_path)
    if not explanations:
        st.info("No explanation could be generated for this sample.")
        return

    prediction = explanations.get("prediction")
    if prediction:
        left, right = st.columns([1, 1])
        probabilities = np.asarray(prediction.get("probabilities", np.array([float(prediction["confidence"])])))
        if probabilities.size == 3:
            predicted_label_text = SEVERITY_LABELS[int(prediction["label"])]
        else:
            predicted_label_text = RISK_LABELS.get(int(prediction["label"]), f"Class {int(prediction['label'])}")
        with left:
            st.metric("Predicted label", predicted_label_text)
        with right:
            st.metric("Confidence", f"{float(prediction['confidence']):.2%}")
        render_educational_ai_panel(
            label_text=predicted_label_text,
            confidence=float(prediction["confidence"]),
            probabilities=probabilities,
            sample_language=str(prediction.get("sample_language", "Bengali")),
            spelling_errors=int(prediction.get("spelling_errors", 0)),
            pronunciation_errors=int(prediction.get("pronunciation_errors", 0)),
            reading_time_seconds=float(prediction.get("reading_time_seconds", 0.0)),
            hesitation_count=int(prediction.get("hesitation_count", 0)),
            repetition_count=int(prediction.get("repetition_count", 0)),
            omission_count=int(prediction.get("omission_count", 0)),
            modality_attention=prediction.get("modality_attention"),
        )

    if "grad_cam" in explanations:
        st.markdown("**CNN Grad-CAM**")
        st.image(explanations["grad_cam"], caption="Grad-CAM handwriting attention overlay", width="stretch")

    if "vit_attention" in explanations:
        st.markdown("**ViT Patch Attention**")
        st.image(explanations["vit_attention"], caption="ViT class-token attention over handwriting patches", width="stretch")

    if "text_attention" in explanations:
        st.markdown("**Transformer Text Attention**")
        text_attention = explanations["text_attention"]
        st.bar_chart(text_attention, x="position", y="attention", width="stretch")
        st.dataframe(text_attention, width="stretch", hide_index=True)

    if not any(key in explanations for key in ["grad_cam", "vit_attention", "text_attention"]):
        st.info("This checkpoint does not expose CNN Grad-CAM, ViT patch attention, or Transformer text attention.")


def render_architecture_pipeline(frame: pd.DataFrame, manifest_path: Path) -> None:
    st.subheader("Step-by-Step Architecture")
    selected_id = st.selectbox("Pipeline sample", frame["sample_id"].astype(str).tolist(), key="pipeline_sample")
    report = ScreeningPipeline(load_model()).run(manifest_path, selected_id)

    input_layer = report["input_layer"]
    st.markdown("**1. Input Layer**")
    st.json(
        {
            "handwriting_path": str(input_layer.handwriting_path),
            "audio_path": str(input_layer.audio_path),
            "text_sample": input_layer.text_sample,
            "spelling_errors": input_layer.spelling_errors,
            "pronunciation_errors": input_layer.pronunciation_errors,
            "reading_time_seconds": input_layer.reading_time_seconds,
            "hesitation_count": input_layer.hesitation_count,
            "repetition_count": input_layer.repetition_count,
            "omission_count": input_layer.omission_count,
        }
    )

    st.markdown("**2. Preprocessing Layer**")
    st.dataframe(
        pd.DataFrame(
            [{"tensor": key, "shape": str(value)} for key, value in report["preprocessing_layer"].items()]
        ),
        width="stretch",
        hide_index=True,
    )

    st.markdown("**3. Feature Extraction Layer**")
    st.dataframe(
        pd.DataFrame(
            [{"feature": key, "shape": str(value)} for key, value in report["feature_extraction_layer"].items()]
        ),
        width="stretch",
        hide_index=True,
    )

    st.markdown("**4. Sequence Modeling Layer**")
    st.dataframe(
        pd.DataFrame(
            [{"sequence_feature": key, "shape": str(value)} for key, value in report["sequence_modeling_layer"].items()]
        ),
        width="stretch",
        hide_index=True,
    )

    st.markdown("**5. Classification Layer**")
    classification = report["classification_layer"]
    left, right = st.columns([1, 1])
    with left:
        st.metric("Predicted label", RISK_LABELS[int(classification["predicted_label"])])
        st.metric("Confidence", f"{float(classification['confidence']):.2%}")
        st.metric("Fused feature shape", str(classification["fused_feature_shape"]))
    with right:
        probability_frame = pd.DataFrame(
            {
                "risk": [RISK_LABELS[0], RISK_LABELS[1]],
                "probability": classification["probabilities"],
            }
        )
        st.bar_chart(probability_frame, x="risk", y="probability", width="stretch")

    st.markdown("**6. Explainability Module**")
    st.caption("Open the Explainability tab to generate Grad-CAM attention overlays for the same sample.")

    st.markdown("**7. Deployment Layer**")
    st.code(
        "python scripts/export_lightweight_model.py --output-dir exports\n"
        "python scripts/export_lightweight_model.py --output-dir exports --quantize",
        language="powershell",
    )


def render_live_screening() -> None:
    left, right = st.columns([1, 1])

    with left:
        sample_language = st.selectbox("Sample language", list(DEFAULT_TEXT_BY_LANGUAGE), key="live_language")
        model_text_language = st.selectbox(
            "Model text vocabulary",
            list(SUPPORTED_LANGUAGES),
            format_func=lambda key: SUPPORTED_LANGUAGES[key],
            key="live_model_language",
        )
        handwriting = st.file_uploader("Handwriting image", type=["png", "jpg", "jpeg"])
        audio = st.file_uploader("Reading audio", type=["wav"])
        text_sample = st.text_area("Reading or writing sample", value=DEFAULT_TEXT_BY_LANGUAGE[sample_language])
        spelling_errors = st.number_input("Observed spelling errors", min_value=0, max_value=50, value=0)
        pronunciation_errors = st.number_input("Observed pronunciation errors", min_value=0, max_value=50, value=0)
        reading_time_seconds = st.number_input("Reading time in seconds", min_value=0.0, max_value=600.0, value=0.0)
        hesitation_count = st.number_input("Hesitations", min_value=0, max_value=100, value=0)
        repetition_count = st.number_input("Repetitions", min_value=0, max_value=100, value=0)
        omission_count = st.number_input("Omissions", min_value=0, max_value=100, value=0)
        run_prediction = st.button("Screen sample", type="primary")

    with right:
        if handwriting is not None:
            st.image(Image.open(handwriting), caption="Uploaded handwriting", width="stretch")

        if run_prediction:
            model = load_model()
            image_path = save_upload(handwriting)
            audio_path = save_upload(audio)
            label, confidence, probabilities = predict(
                model,
                image_path,
                audio_path,
                text_sample,
                int(spelling_errors),
                int(pronunciation_errors),
                float(reading_time_seconds),
                int(hesitation_count),
                int(repetition_count),
                int(omission_count),
                sample_language,
                model_text_language,
            )
            st.metric("Screening result", label_from_probabilities(probabilities))
            st.progress(np.clip(confidence, 0.0, 1.0), text=f"Confidence: {confidence:.2%}")
            if probabilities.shape[0] == 3:
                names = [SEVERITY_LABELS[0], SEVERITY_LABELS[1], SEVERITY_LABELS[2]]
            else:
                names = [RISK_LABELS[0], RISK_LABELS[1]]
            probability_frame = pd.DataFrame({"risk": names[: len(probabilities)], "probability": probabilities})
            st.bar_chart(probability_frame, x="risk", y="probability", width="stretch")
            modality_attention: dict[str, float] = {}
            last_attention = getattr(model, "last_modality_attention", None)
            if isinstance(last_attention, dict):
                for key, value in last_attention.items():
                    modality_attention[key] = float(value.mean().detach().cpu().item())
            render_educational_ai_panel(
                label_text=label_from_probabilities(probabilities),
                confidence=confidence,
                probabilities=probabilities,
                sample_language=sample_language,
                spelling_errors=int(spelling_errors),
                pronunciation_errors=int(pronunciation_errors),
                reading_time_seconds=float(reading_time_seconds),
                hesitation_count=int(hesitation_count),
                repetition_count=int(repetition_count),
                omission_count=int(omission_count),
                modality_attention=modality_attention,
            )
            explanation = build_educational_explanation(
                label_text=label_from_probabilities(probabilities),
                confidence=confidence,
                probabilities=probabilities,
                spelling_errors=int(spelling_errors),
                pronunciation_errors=int(pronunciation_errors),
                reading_time_seconds=float(reading_time_seconds),
                hesitation_count=int(hesitation_count),
                repetition_count=int(repetition_count),
                omission_count=int(omission_count),
                sample_language=sample_language,
                modality_attention=modality_attention,
            )
            set_report_result(
                "report_screening",
                {
                    "label_text": label_from_probabilities(probabilities),
                    "confidence": float(confidence),
                    "summary": explanation.summary,
                    "sample_language": sample_language,
                },
            )
            profile = profile_from_screening(
                label_from_probabilities(probabilities),
                sample_language,
                int(spelling_errors),
                int(pronunciation_errors),
                float(reading_time_seconds),
                int(hesitation_count),
                int(repetition_count),
                int(omission_count),
            )
            render_intervention_panel(profile)
            st.caption("This is a screening aid for educators and researchers, not a clinical diagnosis.")


def render_student_practice() -> None:
    st.subheader("Guided Reading Practice")
    practice_language = st.selectbox("Practice language", list(DEFAULT_TEXT_BY_LANGUAGE), key="dashboard_practice_language")
    reading_tasks_by_language = {
        "Bengali": [
            {"level": "Letter", "prompt": "\u0995 \u0996 \u0997 \u0998", "focus": "letter recognition"},
            {"level": "Word", "prompt": "\u09ac\u0987 \u09ab\u09c1\u09b2 \u09a8\u09a6\u09c0", "focus": "short word reading"},
            {"level": "Sentence", "prompt": "\u0986\u09ae\u09bf \u09ac\u09be\u0982\u09b2\u09be \u09aa\u09dc\u09bf", "focus": "sentence fluency"},
        ],
        "English": [
            {"level": "Letter", "prompt": "b d p q", "focus": "letter-sound contrast"},
            {"level": "Word", "prompt": "book flower river", "focus": "short word reading"},
            {"level": "Sentence", "prompt": "I read a short book", "focus": "sentence fluency"},
        ],
        "Multilingual": [
            {"level": "Mixed", "prompt": "\u0995 \u0915 b d", "focus": "cross-script recognition"},
            {"level": "Mixed", "prompt": "\u09ac\u0987 \u0915\u093f\u0924\u093e\u092c book", "focus": "mixed vocabulary reading"},
        ],
    }
    reading_tasks = reading_tasks_by_language[practice_language]
    task_index = st.selectbox(
        "Practice level",
        range(len(reading_tasks)),
        format_func=lambda index: f"{reading_tasks[index]['level']} - {reading_tasks[index]['focus']}",
    )
    task = reading_tasks[task_index]
    tutoring_root = Path("data/collection/tutoring")
    policy_path = tutoring_root / "policy.json"
    events_path = tutoring_root / "events.csv"
    actions = [f"task_{index}" for index in range(len(reading_tasks))]
    agent = AdaptiveTutorAgent.load_or_create(policy_path, actions)
    st.text_area("Reading prompt", value=task["prompt"], height=100)

    left, right = st.columns([1, 1])
    with left:
        practice_time = st.number_input("Practice reading time in seconds", min_value=0.0, max_value=600.0, value=0.0)
        practice_hesitations = st.number_input("Practice hesitations", min_value=0, max_value=100, value=0, key="practice_hesitations")
    with right:
        practice_repetitions = st.number_input("Practice repetitions", min_value=0, max_value=100, value=0, key="practice_repetitions")
        practice_omissions = st.number_input("Practice omissions", min_value=0, max_value=100, value=0, key="practice_omissions")
    state = build_state(practice_language, float(practice_time), int(practice_hesitations), int(practice_repetitions), int(practice_omissions))
    suggested_action = agent.select_action(state, explore=False)
    suggested_index = int(suggested_action.split("_")[-1]) if "_" in suggested_action else 0
    suggested_index = min(max(suggested_index, 0), len(reading_tasks) - 1)
    st.caption(f"RL tutor suggests next practice prompt: {reading_tasks[suggested_index]['prompt']}")
    if st.button("Update RL Tutor", key="update_rl_tutor_dashboard"):
        current_action = f"task_{int(task_index)}"
        reward = compute_reward(float(practice_time), int(practice_hesitations), int(practice_repetitions), int(practice_omissions))
        next_state = build_state(
            practice_language,
            max(float(practice_time) - 4.0, 0.0),
            max(int(practice_hesitations) - 1, 0),
            max(int(practice_repetitions) - 1, 0),
            max(int(practice_omissions) - 1, 0),
        )
        agent.update(state, current_action, reward, next_state)
        agent.save(policy_path)
        append_tutoring_event(
            events_path,
            {
                "language": practice_language,
                "state": state.key(),
                "action": current_action,
                "reward": reward,
                "reading_time_seconds": float(practice_time),
                "hesitations": int(practice_hesitations),
                "repetitions": int(practice_repetitions),
                "omissions": int(practice_omissions),
            },
        )
        next_action = agent.select_action(next_state, explore=False)
        next_index = int(next_action.split("_")[-1]) if "_" in next_action else suggested_index
        next_index = min(max(next_index, 0), len(reading_tasks) - 1)
        st.success(f"Tutor updated. Suggested next prompt: {reading_tasks[next_index]['prompt']}")

    difficulty_score = (
        min(practice_time / 60.0, 2.0)
        + practice_hesitations * 0.4
        + practice_repetitions * 0.35
        + practice_omissions * 0.5
    )

    st.subheader("Adaptive Support")
    if difficulty_score >= 4:
        st.warning("Use a shorter prompt, read aloud together, and repeat the same line slowly before moving on.")
    elif difficulty_score >= 2:
        st.info("Practice the same prompt again and mark difficult letters or words for focused review.")
    else:
        st.success("The current prompt looks suitable. Move to the next prompt when the user feels ready.")

    st.subheader("Handwriting Practice")
    writing_prompt = st.selectbox(
        "Copying prompt",
        [
            task["prompt"],
            DEFAULT_TEXT_BY_LANGUAGE[practice_language],
        ],
    )
    st.code(writing_prompt, language=None)
    st.caption("Use this prompt for paper-based copying or tablet handwriting collection, then upload the image in Live Screening.")

    st.subheader("Speech Therapy Support")
    st.dataframe(therapy_task_frame(), width="stretch", hide_index=True)
    therapy_tasks = speech_therapy_tasks_for_language(practice_language)
    selected_index = st.selectbox(
        "Therapy target",
        range(len(therapy_tasks)),
        format_func=lambda index: f"{therapy_tasks[index].level} - {therapy_tasks[index].target_sound}",
    )
    selected_task = therapy_tasks[selected_index]
    st.text_area("Therapy prompt", value=selected_task.prompt, height=90)
    left, right = st.columns([1, 1])
    with left:
        therapy_duration = st.number_input("Therapy duration seconds", min_value=0.0, max_value=600.0, value=0.0)
        therapy_pronunciation = st.number_input("Therapy pronunciation errors", min_value=0, max_value=100, value=0)
    with right:
        therapy_repetitions = st.number_input("Therapy syllable repetitions", min_value=0, max_value=100, value=0)
        therapy_substitutions = st.number_input("Therapy sound substitutions", min_value=0, max_value=100, value=0)
    attention_rating = st.slider("Therapy attention rating", min_value=1, max_value=5, value=3)
    therapy_result = score_therapy_session(
        float(therapy_duration),
        int(therapy_pronunciation),
        int(therapy_repetitions),
        int(therapy_substitutions),
        int(attention_rating),
    )
    st.progress(therapy_result.therapy_score, text=therapy_result.recommendation)


def render_webcam_screening() -> None:
    st.subheader("Real-Time Webcam Screening")
    sample_language = st.selectbox("Sample language", list(DEFAULT_TEXT_BY_LANGUAGE), key="webcam_language_dashboard")
    model_text_language = st.selectbox(
        "Model text vocabulary",
        list(SUPPORTED_LANGUAGES),
        format_func=lambda key: SUPPORTED_LANGUAGES[key],
        key="webcam_model_language_dashboard",
    )
    camera_image = st.camera_input("Capture handwriting page")
    text_sample = st.text_area("Reading or writing sample", value=DEFAULT_TEXT_BY_LANGUAGE[sample_language], key="webcam_text_dashboard")
    left, right = st.columns(2)
    with left:
        spelling_errors = st.number_input("Observed spelling errors", min_value=0, max_value=50, value=0, key="webcam_spell_dashboard")
        reading_time_seconds = st.number_input("Reading time in seconds", min_value=0.0, max_value=600.0, value=0.0, key="webcam_time_dashboard")
        repetition_count = st.number_input("Repetitions", min_value=0, max_value=100, value=0, key="webcam_repetition_dashboard")
    with right:
        pronunciation_errors = st.number_input("Observed pronunciation errors", min_value=0, max_value=50, value=0, key="webcam_pron_dashboard")
        hesitation_count = st.number_input("Hesitations", min_value=0, max_value=100, value=0, key="webcam_hes_dashboard")
        omission_count = st.number_input("Omissions", min_value=0, max_value=100, value=0, key="webcam_omit_dashboard")

    if st.button("Analyze Webcam Sample", type="primary", key="webcam_analyze_dashboard"):
        image_path = save_camera_capture(camera_image)
        if image_path is None:
            st.error("Capture a webcam image before running analysis.")
            return
        model = load_model()
        _, confidence, probabilities = predict(
            model,
            image_path,
            None,
            text_sample,
            int(spelling_errors),
            int(pronunciation_errors),
            float(reading_time_seconds),
            int(hesitation_count),
            int(repetition_count),
            int(omission_count),
            sample_language,
            model_text_language,
        )
        st.metric("Screening result", label_from_probabilities(probabilities))
        st.progress(np.clip(confidence, 0.0, 1.0), text=f"Confidence: {confidence:.2%}")
        render_educational_ai_panel(
            label_text=label_from_probabilities(probabilities),
            confidence=confidence,
            probabilities=probabilities,
            sample_language=sample_language,
            spelling_errors=int(spelling_errors),
            pronunciation_errors=int(pronunciation_errors),
            reading_time_seconds=float(reading_time_seconds),
            hesitation_count=int(hesitation_count),
            repetition_count=int(repetition_count),
            omission_count=int(omission_count),
            modality_attention=None,
        )


def render_speech_therapy_lab() -> None:
    st.subheader("Speech Therapy Integration")
    therapy_root = Path(st.text_input("Therapy workspace", value="data/collection/speech_therapy"))
    workspace = create_therapy_workspace(therapy_root)
    st.dataframe(therapy_task_frame(), width="stretch", hide_index=True)
    language = st.selectbox("Therapy language", list(DEFAULT_TEXT_BY_LANGUAGE), key="therapy_language_dashboard")
    tasks = speech_therapy_tasks_for_language(language)
    task_index = st.selectbox(
        "Therapy task",
        range(len(tasks)),
        format_func=lambda index: f"{tasks[index].level} - {tasks[index].target_sound}",
        key="therapy_task_dashboard",
    )
    task = tasks[task_index]
    st.text_area("Therapy prompt", value=task.prompt, key="therapy_prompt_dashboard", height=90)
    student_hash = st.text_input("Anonymous learner ID", value="therapy_user_001")
    session_id = st.text_input("Session ID", value=f"TH_{pd.Timestamp.now().strftime('%Y%m%d_%H%M%S')}")
    audio_upload = st.file_uploader("Therapy audio (wav)", type=["wav"], key="therapy_audio_dashboard")
    left, right = st.columns(2)
    with left:
        pronunciation_errors = st.number_input("Pronunciation errors", min_value=0, max_value=100, value=0, key="therapy_pron_err_dashboard")
        syllable_repetitions = st.number_input("Syllable repetitions", min_value=0, max_value=100, value=0, key="therapy_rep_dashboard")
    with right:
        sound_substitutions = st.number_input("Sound substitutions", min_value=0, max_value=100, value=0, key="therapy_sub_dashboard")
        attention_rating = st.slider("Attention rating", min_value=1, max_value=5, value=3, key="therapy_attn_dashboard")
    duration_seconds = st.number_input("Session duration seconds", min_value=0.0, max_value=600.0, value=0.0, key="therapy_duration_dashboard")
    result = score_therapy_session(float(duration_seconds), int(pronunciation_errors), int(syllable_repetitions), int(sound_substitutions), int(attention_rating))
    st.progress(result.therapy_score, text=result.recommendation)
    if st.button("Use Current Therapy Result in Report", key="use_therapy_report_dashboard"):
        set_report_result(
            "report_therapy",
            {
                "therapy_score": float(result.therapy_score),
                "recommendation": result.recommendation,
                "language": language,
                "task_id": task.task_id,
            },
        )
        st.success("Current therapy result added to the final report.")

    if st.button("Save Therapy Session", key="save_therapy_dashboard"):
        audio_rel = ""
        final_duration = float(duration_seconds)
        if audio_upload is not None:
            audio_dest = workspace["audio"] / f"{session_id}.wav"
            with audio_dest.open("wb") as handle:
                handle.write(audio_upload.getbuffer())
            audio_rel = relative_audio_path(audio_dest, Path.cwd())
            estimated = estimate_wav_duration(audio_dest)
            if estimated > 0:
                final_duration = float(estimated)
        append_therapy_session(
            workspace["sessions"],
            {
                "session_id": session_id,
                "student_hash": student_hash,
                "task_id": task.task_id,
                "language": task.language,
                "level": task.level,
                "target_sound": task.target_sound,
                "prompt": task.prompt,
                "audio_path": audio_rel,
                "duration_seconds": final_duration,
                "pronunciation_errors": int(pronunciation_errors),
                "syllable_repetitions": int(syllable_repetitions),
                "sound_substitutions": int(sound_substitutions),
                "attention_rating": int(attention_rating),
                "therapy_score": float(result.therapy_score),
                "recommendation": result.recommendation,
            },
        )
        set_report_result(
            "report_therapy",
            {
                "therapy_score": float(result.therapy_score),
                "recommendation": result.recommendation,
                "language": language,
                "task_id": task.task_id,
            },
        )
        st.success(f"Therapy session saved to {workspace['sessions']}")

    if workspace["sessions"].exists():
        st.subheader("Therapy Session Records")
        st.dataframe(pd.read_csv(workspace["sessions"]), width="stretch", hide_index=True)


def render_eye_tracking_lab() -> None:
    st.subheader("Bengali Eye-Tracking Dataset")
    st.caption("Upload a gaze trace CSV with columns: timestamp_ms, gaze_x, gaze_y.")
    trace_upload = st.file_uploader("Gaze trace CSV", type=["csv"], key="eye_trace_upload")
    sample_id = st.text_input("Sample ID", value=f"ET_{pd.Timestamp.now().strftime('%Y%m%d_%H%M%S')}")
    participant_hash = st.text_input("Participant hash", value="anon_eye_001")
    language = st.selectbox("Language", list(DEFAULT_TEXT_BY_LANGUAGE), key="eye_language_dashboard")
    word_count = st.number_input("Word count in prompt", min_value=1, max_value=500, value=6)
    output_path = Path(st.text_input("Metrics CSV path", value="data/collection/eye_tracking/eye_tracking_metrics.csv"))

    if trace_upload is not None:
        trace = pd.read_csv(trace_upload)
        st.dataframe(trace.head(20), width="stretch", hide_index=True)
        if st.button("Compute and Save Eye Metrics", key="compute_eye_metrics_dashboard"):
            metrics = compute_eye_tracking_metrics(trace, int(word_count))
            append_eye_tracking_metrics(output_path, sample_id, participant_hash, language, metrics, int(word_count))
            set_report_result(
                "report_eye",
                {
                    "reading_speed_wpm": float(metrics.reading_speed_wpm),
                    "regressions_count": int(metrics.regressions_count),
                    "fixation_duration_ms": float(metrics.fixation_duration_ms),
                    "gaze_dispersion": float(metrics.gaze_dispersion),
                    "language": language,
                },
            )
            st.success(f"Eye-tracking metrics saved to {output_path}")
            metric_cols = st.columns(4)
            with metric_cols[0]:
                st.metric("Reading speed", f"{metrics.reading_speed_wpm:.2f} WPM")
            with metric_cols[1]:
                st.metric("Regressions", int(metrics.regressions_count))
            with metric_cols[2]:
                st.metric("Fixation duration", f"{metrics.fixation_duration_ms:.2f} ms")
            with metric_cols[3]:
                st.metric("Gaze dispersion", f"{metrics.gaze_dispersion:.2f}")
    if output_path.exists():
        st.subheader("Collected Eye-Tracking Metrics")
        st.dataframe(pd.read_csv(output_path), width="stretch", hide_index=True)


def render_final_report_tab() -> None:
    st.subheader("Final Report")
    st.caption("Fill the student details below, then generate the report. The saved test results will be added automatically to the PDF.")

    student_info = st.session_state["report_student_info"]
    detail_cols = st.columns(3)
    with detail_cols[0]:
        student_info["student_name"] = st.text_input("Student Name", value=student_info["student_name"], key="report_student_name")
        student_info["age"] = st.text_input("Age", value=student_info["age"], key="report_age")
    with detail_cols[1]:
        student_info["student_class"] = st.text_input("Class", value=student_info["student_class"], key="report_class")
        student_info["roll_no"] = st.text_input("Roll No", value=student_info["roll_no"], key="report_roll_no")
    with detail_cols[2]:
        student_info["section"] = st.text_input("Section", value=student_info["section"], key="report_section")
        student_info["school_name"] = st.text_input("School Name", value=student_info["school_name"], key="report_school_name")
    st.session_state["report_student_info"] = student_info

    status_cols = st.columns(4)
    status_map = {
        "Screening": st.session_state.get("report_screening"),
        "Speech Therapy": st.session_state.get("report_therapy"),
        "Eye Tracking": st.session_state.get("report_eye"),
        "Biomarkers": st.session_state.get("report_biomarkers"),
    }
    for index, (label, value) in enumerate(status_map.items()):
        with status_cols[index]:
            st.metric(label, "Ready" if value else "Pending")

    missing = missing_report_fields(student_info)
    if missing:
        st.info(f"Please fill these details before generating the report: {', '.join(missing)}")
    if not any(status_map.values()):
        st.warning("No saved test results are available yet. Run at least one test first.")

    if st.button("Generate Final Report", type="primary", key="generate_final_report_dashboard"):
        if missing:
            st.error(f"Please fill these details first: {', '.join(missing)}")
        elif not any(status_map.values()):
            st.error("Please complete at least one test before generating the final report.")
        else:
            st.session_state["generated_final_report"] = build_final_report_payload()
            st.success("Final report generated successfully.")

    report = st.session_state.get("generated_final_report")
    if not report:
        st.markdown("**Report Preview**")
        st.caption("The final report preview will appear here after you click Generate Final Report.")
        return

    st.markdown("**Report Preview**")
    info_left, info_right = st.columns(2)
    with info_left:
        st.write(f"**Student Name:** {report['student_info']['student_name']}")
        st.write(f"**Age:** {report['student_info']['age']}")
        st.write(f"**Class:** {report['student_info']['student_class']}")
    with info_right:
        st.write(f"**Roll No:** {report['student_info']['roll_no']}")
        st.write(f"**Section:** {report['student_info']['section']}")
        st.write(f"**School Name:** {report['student_info']['school_name']}")
    st.caption(f"Generated on {report['generated_at']}")

    st.markdown("**Overview**")
    for item in report["overview"]:
        st.write(f"- {item}")

    for section in report["sections"]:
        st.markdown(f"**{section['title']}**")
        for line in section["lines"]:
            st.write(f"- {line}")

    st.markdown("**Recommended Next Steps**")
    for item in report["recommendations"]:
        st.write(f"- {item}")

    pdf_bytes = final_report_pdf_bytes(report)
    file_name = f"{report['student_info']['student_name'].strip().replace(' ', '_') or 'student'}_final_report.pdf"
    st.download_button(
        "Download Report PDF",
        data=pdf_bytes,
        file_name=file_name,
        mime="application/pdf",
        key="download_final_report_pdf_dashboard",
    )


def render_model_ops(manifest_path: Path) -> None:
    st.subheader("Model Ops")
    ops_tabs = st.tabs(["Federated Training", "Lightweight Deployment", "Foundation Model"])

    with ops_tabs[0]:
        client_input = st.text_area(
            "Client manifests (one path per line)",
            value="data/demo/audio_augmented_manifest.csv",
            key="federated_clients_dashboard",
        )
        client_paths = [line.strip() for line in client_input.splitlines() if line.strip()]
        val_manifest = st.text_input("Validation manifest", value="data/demo/audio_augmented_manifest.csv")
        rounds = st.number_input("Federated rounds", min_value=1, max_value=50, value=3)
        local_epochs = st.number_input("Local epochs", min_value=1, max_value=20, value=1)
        if st.button("Run Federated Training", key="run_federated_dashboard"):
            cfg = FederatedConfig(rounds=int(rounds), local_epochs=int(local_epochs))
            checkpoint = run_federated_training(client_paths, "checkpoints/federated_dashboard", cfg, validation_manifest=val_manifest)
            st.success(f"Federated training finished: {checkpoint}")
            history_path = checkpoint.parent / "federated_history.csv"
            if history_path.exists():
                st.dataframe(pd.read_csv(history_path), width="stretch", hide_index=True)

    with ops_tabs[1]:
        checkpoint_path = st.text_input("Base checkpoint", value="checkpoints/best_model.pt", key="ops_checkpoint_dashboard")
        prune_amount = st.slider("Pruning amount", min_value=0.0, max_value=0.9, value=0.3, step=0.05)
        output_dir = Path(st.text_input("Export directory", value="exports/dashboard", key="ops_export_dir_dashboard"))
        if st.button("Optimize and Export", key="optimize_export_dashboard"):
            model = load_model(checkpoint_path)
            pruned = apply_global_pruning(model, amount=float(prune_amount))
            quantized = apply_dynamic_quantization(pruned)
            standard_path = export_torchscript(model, output_dir / "standard.pt")
            optimized_path = export_torchscript(quantized, output_dir / "pruned_quantized.pt")
            standard_bench = benchmark_torchscript(standard_path)
            optimized_bench = benchmark_torchscript(optimized_path)
            st.success("Export complete.")
            st.dataframe(
                pd.DataFrame(
                    [
                        {"artifact": "standard", **standard_bench},
                        {"artifact": "pruned_quantized", **optimized_bench},
                    ]
                ),
                width="stretch",
                hide_index=True,
            )

    with ops_tabs[2]:
        pretrain_manifest = st.text_input("Pretraining manifest", value=str(manifest_path), key="foundation_manifest_dashboard")
        pretrain_epochs = st.number_input("Pretraining epochs", min_value=1, max_value=50, value=3, key="foundation_epochs_dashboard")
        if st.button("Run Foundation Pretraining", key="run_foundation_pretrain_dashboard"):
            command = [
                sys.executable,
                "scripts/train_foundation_model.py",
                "--manifest",
                pretrain_manifest,
                "--epochs",
                str(int(pretrain_epochs)),
            ]
            result = subprocess.run(command, capture_output=True, text=True, check=False)
            if result.returncode != 0:
                st.error(result.stderr[-2000:] if result.stderr else "Foundation pretraining failed.")
            else:
                st.success("Foundation pretraining completed.")
                st.code(result.stdout[-4000:] if result.stdout else "Completed.")

        disorder = st.selectbox("Adapter disorder", ["dyslexia", "dysgraphia", "dyscalculia"], key="foundation_disorder_dashboard")
        foundation_ckpt = st.text_input("Foundation checkpoint", value="checkpoints/foundation/bengali_foundation.pt", key="foundation_ckpt_dashboard")
        adapter_epochs = st.number_input("Adapter epochs", min_value=1, max_value=50, value=3, key="adapter_epochs_dashboard")
        if st.button("Fine-Tune Disorder Adapter", key="run_adapter_tune_dashboard"):
            command = [
                sys.executable,
                "scripts/fine_tune_foundation_adapter.py",
                "--manifest",
                pretrain_manifest,
                "--foundation-checkpoint",
                foundation_ckpt,
                "--disorder",
                disorder,
                "--epochs",
                str(int(adapter_epochs)),
                "--freeze-foundation",
            ]
            result = subprocess.run(command, capture_output=True, text=True, check=False)
            if result.returncode != 0:
                st.error(result.stderr[-2000:] if result.stderr else "Adapter fine-tuning failed.")
            else:
                st.success(f"{disorder.title()} adapter fine-tuning completed.")
                st.code(result.stdout[-4000:] if result.stdout else "Completed.")


def main() -> None:
    st.title("Learning Disorder Intelligence Dashboard")
    st.caption("Professional multimodal platform for screening, explainability, intervention, therapy, and deployment workflows.")
    initialize_report_state()

    with st.sidebar:
        st.header("Data Source")
        default_manifest = Path("data/demo/manifest.csv")
        manifest_value = st.text_input("Manifest path", value=str(default_manifest))
        manifest_path = Path(manifest_value)
        st.divider()
        st.write("Workflow")
        st.code(
            "python scripts/create_demo_dataset.py\n"
            "python -m src.dyslexia_detection.train --manifest data/demo/manifest.csv",
            language="powershell",
        )

    if not manifest_path.exists():
        st.warning("Manifest not found. Create demo data or provide a valid CSV manifest path.")
        st.stop()

    frame = load_manifest(str(manifest_path))
    required_columns = {
        "sample_id",
        "handwriting_path",
        "audio_path",
        "text_sample",
        "spelling_errors",
        "pronunciation_errors",
        "label",
    }
    missing_columns = required_columns.difference(frame.columns)
    if missing_columns:
        st.error(f"Manifest is missing required columns: {sorted(missing_columns)}")
        st.stop()

    tabs = st.tabs(
        [
            "Overview",
            "Biomarkers",
            "Dataset Creation",
            "Sample Collection",
            "Data Preparation",
            "Dataset Explorer",
            "Architecture",
            "Model Analytics",
            "Explainability",
            "Live Screening",
            "Webcam Screening",
            "Guided Practice",
            "Speech Therapy",
            "Eye Tracking",
            "Final Report",
            "Model Ops",
        ]
    )
    with tabs[0]:
        render_overview(frame)
    with tabs[1]:
        render_biomarker_discovery(manifest_path)
    with tabs[2]:
        render_dataset_creation(frame, manifest_path)
    with tabs[3]:
        render_sample_collection()
    with tabs[4]:
        render_data_preparation()
    with tabs[5]:
        render_dataset_explorer(frame, manifest_path)
    with tabs[6]:
        render_architecture_pipeline(frame, manifest_path)
    with tabs[7]:
        render_model_analytics(manifest_path)
    with tabs[8]:
        render_explainability(frame, manifest_path)
    with tabs[9]:
        render_live_screening()
    with tabs[10]:
        render_webcam_screening()
    with tabs[11]:
        render_student_practice()
    with tabs[12]:
        render_speech_therapy_lab()
    with tabs[13]:
        render_eye_tracking_lab()
    with tabs[14]:
        render_final_report_tab()
    with tabs[15]:
        render_model_ops(manifest_path)


if __name__ == "__main__":
    main()
