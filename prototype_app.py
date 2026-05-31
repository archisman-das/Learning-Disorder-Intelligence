from __future__ import annotations

import os
import tempfile
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
import streamlit as st
import torch
from PIL import Image

from src.dyslexia_detection.config import DataConfig, SUPPORTED_LANGUAGES
from src.dyslexia_detection.adaptive_tutoring import AdaptiveTutorAgent, append_tutoring_event, build_state, compute_reward
from src.dyslexia_detection.intervention import (
    InterventionPolicy,
    InterventionProfile,
    SEVERITY_NAME_TO_LEVEL,
    append_intervention_log,
    build_intervention_plan,
    reward_from_progress,
)
from src.dyslexia_detection.dataset_tools import append_manifest_row, create_dataset_workspace, validate_manifest
from src.dyslexia_detection.educational_explanations import build_educational_explanation
from src.dyslexia_detection.models import build_model
from src.dyslexia_detection.preprocessing import build_char_vocab, encode_text, extract_audio_features, load_handwriting_image
from src.dyslexia_detection.speech_therapy import (
    append_therapy_session,
    create_therapy_workspace,
    estimate_wav_duration,
    relative_audio_path,
    score_therapy_session,
    speech_therapy_tasks_for_language,
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
    "Hindi": "\u092e\u0948\u0902 \u0939\u093f\u0902\u0926\u0940 \u092a\u0922\u0924\u093e \u0939\u0942\u0901",
    "English": "I read a short book",
    "Multilingual": "\u0986\u09ae\u09bf \u09ac\u09be\u0982\u09b2\u09be \u09aa\u09dc\u09bf",
}
WORKSPACE = Path("data/mobile_collection")


st.set_page_config(
    page_title="Dyslexia Screening",
    page_icon="DS",
    layout="centered",
    initial_sidebar_state="collapsed",
)


st.markdown(
    """
    <style>
    .block-container {max-width: 760px; padding-top: 1rem; padding-bottom: 4rem;}
    div[data-testid="stMetric"] {
        background: #f7f7f2;
        border: 1px solid #deded3;
        border-radius: 8px;
        padding: 0.7rem;
    }
    .stButton > button {width: 100%; min-height: 2.8rem;}
    .stTabs [data-baseweb="tab-list"] {gap: 0.25rem;}
    .stTabs [data-baseweb="tab"] {padding: 0.55rem 0.7rem;}
    </style>
    """,
    unsafe_allow_html=True,
)


@st.cache_resource
def load_runtime_model(model_path: str, checkpoint_path: str):
    deployment = Path(model_path)
    if deployment.exists():
        model = torch.jit.load(str(deployment), map_location="cpu")
        model.eval()
        return model, "TorchScript"

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
    return model, "PyTorch checkpoint"


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


def persist_upload(uploaded_file, destination: Path, root: Path) -> str:
    if uploaded_file is None:
        return ""
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("wb") as handle:
        handle.write(uploaded_file.getbuffer())
    return os.path.relpath(destination, root)


def predict(
    model,
    handwriting_path: Path | None,
    audio_path: Path | None,
    text_sample: str,
    spelling_errors: int,
    pronunciation_errors: int,
    reading_time_seconds: float,
    hesitation_count: int,
    repetition_count: int,
    omission_count: int,
    sample_language: str,
    model_text_language: str,
) -> tuple[int, float, np.ndarray]:
    config = DataConfig()
    vocab = build_char_vocab(model_text_language)
    image = torch.tensor(load_handwriting_image(handwriting_path, config), dtype=torch.float32).unsqueeze(0)
    audio = torch.tensor(extract_audio_features(audio_path, config), dtype=torch.float32).unsqueeze(0)
    text = torch.tensor(encode_text(text_sample, vocab, config.max_text_length, sample_language), dtype=torch.long).unsqueeze(0)
    errors = torch.tensor([[spelling_errors, pronunciation_errors]], dtype=torch.float32)
    behavior = torch.tensor(
        [[reading_time_seconds, hesitation_count, repetition_count, omission_count]],
        dtype=torch.float32,
    )
    with torch.no_grad():
        probabilities = torch.softmax(model(image, audio, text, errors, behavior), dim=1).squeeze(0).numpy()
    predicted = int(np.argmax(probabilities))
    return predicted, float(probabilities[predicted]), probabilities


def risk_guidance(label: int, confidence: float) -> str:
    if label == 1 and confidence >= 0.65:
        return "Review this sample with a specialist and collect more reading and handwriting evidence."
    if label == 1:
        return "Some risk indicators are present. Repeat screening with more samples before making decisions."
    return "No strong risk signal in this sample. Keep observing reading fluency and writing consistency."


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
    t_teacher, t_parent, t_student = st.tabs(["Teacher", "Parent", "Student"])
    with t_teacher:
        st.write(explanation.teacher)
    with t_parent:
        st.write(explanation.parent)
    with t_student:
        st.write(explanation.student)
    st.markdown("**Suggested Next Steps**")
    for step in explanation.next_steps:
        st.write(f"- {step}")


def label_from_probabilities(probabilities: np.ndarray) -> str:
    predicted = int(np.argmax(probabilities))
    if probabilities.shape[0] == 3:
        return SEVERITY_LABELS.get(predicted, f"Class {predicted}")
    return RISK_LABELS.get(predicted, f"Class {predicted}")


def _profile_from_screening(
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


def render_intervention_recommendations(
    profile: InterventionProfile,
    student_hash: str,
    recommendation_root: Path,
    key_prefix: str,
) -> None:
    policy_path = recommendation_root / "policy.json"
    log_path = recommendation_root / "recommendations.csv"
    policy = InterventionPolicy.load_or_create(policy_path)
    plan = build_intervention_plan(profile, policy)
    st.subheader("Personalized Intervention Plan")
    st.write(f"Reading: {plan.reading_exercise}")
    st.write(f"Pronunciation: {plan.pronunciation_exercise}")
    st.write(f"Spelling: {plan.spelling_exercise}")
    st.metric("Weekly target minutes", plan.weekly_target_minutes)
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

    if st.button("Update Recommendation Policy", key=f"{key_prefix}_update_intervention_policy"):
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
        st.success(f"Recommendation policy updated (reward={reward:.2f}).")


def render_screening(model, runtime_name: str, model_text_language: str) -> None:
    st.subheader("Quick Screening")
    sample_language = st.selectbox("Sample language", list(DEFAULT_TEXT_BY_LANGUAGE), key="screen_language")
    handwriting = st.file_uploader("Handwriting image", type=["png", "jpg", "jpeg"], key="screen_handwriting")
    audio = st.file_uploader("Reading audio", type=["wav"], key="screen_audio")
    text_sample = st.text_area("Text sample", value=DEFAULT_TEXT_BY_LANGUAGE[sample_language])

    left, right = st.columns(2)
    with left:
        spelling_errors = st.number_input("Spelling errors", min_value=0, max_value=100, value=0)
        reading_time_seconds = st.number_input("Reading time", min_value=0.0, max_value=600.0, value=0.0)
        repetition_count = st.number_input("Repetitions", min_value=0, max_value=100, value=0)
    with right:
        pronunciation_errors = st.number_input("Pronunciation errors", min_value=0, max_value=100, value=0)
        hesitation_count = st.number_input("Hesitations", min_value=0, max_value=100, value=0)
        omission_count = st.number_input("Omissions", min_value=0, max_value=100, value=0)

    if handwriting is not None:
        st.image(Image.open(handwriting), caption="Handwriting preview")

    if st.button("Run Screening", type="primary"):
        handwriting_path = save_upload(handwriting)
        audio_path = save_upload(audio)
        label, confidence, probabilities = predict(
            model,
            handwriting_path,
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
        left, right = st.columns(2)
        with left:
            st.metric("Result", label_from_probabilities(probabilities))
        with right:
            st.metric("Confidence", f"{confidence:.1%}")
        risk_probability = float(probabilities[1]) if probabilities.shape[0] > 1 else float(probabilities[0])
        st.progress(risk_probability, text=f"Risk probability: {risk_probability:.1%}")
        if probabilities.shape[0] == 3:
            st.caption(
                f"Mild: {probabilities[0]:.1%} | Moderate: {probabilities[1]:.1%} | Severe: {probabilities[2]:.1%}"
            )
        st.info(risk_guidance(label, confidence))
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
        profile = _profile_from_screening(
            label_from_probabilities(probabilities),
            sample_language,
            int(spelling_errors),
            int(pronunciation_errors),
            float(reading_time_seconds),
            int(hesitation_count),
            int(repetition_count),
            int(omission_count),
        )
        render_intervention_recommendations(profile, "screening_user", WORKSPACE / "intervention", "screen")
        st.caption(f"Runtime: {runtime_name}. This is a screening aid, not a diagnosis.")


def render_webcam_analysis(model, runtime_name: str, model_text_language: str) -> None:
    st.subheader("Webcam Analysis")
    st.caption("Capture a handwriting page with the device camera and run the same lightweight screening model.")
    sample_language = st.selectbox("Sample language", list(DEFAULT_TEXT_BY_LANGUAGE), key="webcam_language")
    camera_image = st.camera_input("Capture handwriting page")
    text_sample = st.text_area("Text sample", value=DEFAULT_TEXT_BY_LANGUAGE[sample_language], key="webcam_text")

    left, right = st.columns(2)
    with left:
        spelling_errors = st.number_input("Spelling errors", min_value=0, max_value=100, value=0, key="webcam_spell")
        reading_time_seconds = st.number_input("Reading time", min_value=0.0, max_value=600.0, value=0.0, key="webcam_time")
        repetition_count = st.number_input("Repetitions", min_value=0, max_value=100, value=0, key="webcam_repeat")
    with right:
        pronunciation_errors = st.number_input("Pronunciation errors", min_value=0, max_value=100, value=0, key="webcam_pron")
        hesitation_count = st.number_input("Hesitations", min_value=0, max_value=100, value=0, key="webcam_hes")
        omission_count = st.number_input("Omissions", min_value=0, max_value=100, value=0, key="webcam_omit")

    if st.button("Analyze Webcam Capture", type="primary"):
        image_path = save_camera_capture(camera_image)
        if image_path is None:
            st.error("Capture a camera image before analysis.")
            return
        label, confidence, probabilities = predict(
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
        left, right = st.columns(2)
        with left:
            st.metric("Result", label_from_probabilities(probabilities))
        with right:
            st.metric("Confidence", f"{confidence:.1%}")
        risk_probability = float(probabilities[1]) if probabilities.shape[0] > 1 else float(probabilities[0])
        st.progress(risk_probability, text=f"Risk probability: {risk_probability:.1%}")
        if probabilities.shape[0] == 3:
            st.caption(
                f"Mild: {probabilities[0]:.1%} | Moderate: {probabilities[1]:.1%} | Severe: {probabilities[2]:.1%}"
            )
        st.info(risk_guidance(label, confidence))
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
        profile = _profile_from_screening(
            label_from_probabilities(probabilities),
            sample_language,
            int(spelling_errors),
            int(pronunciation_errors),
            float(reading_time_seconds),
            int(hesitation_count),
            int(repetition_count),
            int(omission_count),
        )
        render_intervention_recommendations(profile, "webcam_user", WORKSPACE / "intervention", "webcam")
        st.caption(f"Runtime: {runtime_name}. Webcam analysis uses captured handwriting plus entered behavior values.")


def render_collection() -> None:
    st.subheader("Collect Sample")
    workspace = Path(st.text_input("Workspace", value=str(WORKSPACE)))
    create_dataset_workspace(workspace)
    manifest = workspace / "manifest.csv"

    with st.form("mobile_collection"):
        sample_id = st.text_input("Sample ID", value=f"MOB_{date.today().strftime('%Y%m%d')}_001")
        student_hash = st.text_input("Anonymous user ID", value="anon_user_001")
        sample_language = st.selectbox("Sample language", list(DEFAULT_TEXT_BY_LANGUAGE), key="collect_language_mobile")
        handwriting = st.file_uploader("Handwriting image", type=["png", "jpg", "jpeg"], key="collect_handwriting_mobile")
        audio = st.file_uploader("Reading audio", type=["wav"], key="collect_audio_mobile")
        text_sample = st.text_area("Text sample", value=DEFAULT_TEXT_BY_LANGUAGE[sample_language], key="collect_text_mobile")

        left, right = st.columns(2)
        with left:
            spelling_errors = st.number_input("Spelling errors", min_value=0, max_value=100, value=0, key="collect_spell")
            reading_time_seconds = st.number_input("Reading time", min_value=0.0, max_value=600.0, value=0.0, key="collect_time")
            repetition_count = st.number_input("Repetitions", min_value=0, max_value=100, value=0, key="collect_repeats")
        with right:
            pronunciation_errors = st.number_input("Pronunciation errors", min_value=0, max_value=100, value=0, key="collect_pron")
            hesitation_count = st.number_input("Hesitations", min_value=0, max_value=100, value=0, key="collect_hes")
            omission_count = st.number_input("Omissions", min_value=0, max_value=100, value=0, key="collect_omit")

        guardian_consent = st.checkbox("Consent from participant/guardian recorded", value=True)
        student_assent = st.checkbox("Participant assent/acknowledgement recorded", value=True)
        label = st.selectbox("Screening label", [0, 1], format_func=lambda value: RISK_LABELS[value])
        submitted = st.form_submit_button("Save Sample", type="primary")

    if submitted:
        if not guardian_consent or not student_assent:
            st.error("Consent and assent are required before saving.")
            return
        handwriting_suffix = Path(handwriting.name).suffix if handwriting else ".png"
        audio_suffix = Path(audio.name).suffix if audio else ".wav"
        handwriting_path = persist_upload(
            handwriting,
            workspace / "raw" / "handwriting" / f"{sample_id}{handwriting_suffix}",
            workspace,
        )
        audio_path = persist_upload(
            audio,
            workspace / "raw" / "audio" / f"{sample_id}{audio_suffix}",
            workspace,
        )
        try:
            append_manifest_row(
                manifest,
                {
                    "sample_id": sample_id,
                    "student_hash": student_hash,
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
                    "data_use_scope": "screening",
                    "language": sample_language,
                    "collection_date": str(date.today()),
                    "label": int(label),
                },
            )
        except ValueError as error:
            st.error(str(error))
            return
        st.success(f"Saved {sample_id}")
        issues = validate_manifest(manifest)
        if issues:
            st.warning("Saved, but validation needs review.")
            st.write(issues)
        else:
            st.info("Collection manifest validates.")


def render_practice() -> None:
    st.subheader("Guided Practice")
    language = st.selectbox("Practice language", list(DEFAULT_TEXT_BY_LANGUAGE), key="practice_language")
    tasks = {
        "Bengali": ["\u0995 \u0996 \u0997 \u0998", "\u09ac\u0987 \u09ab\u09c1\u09b2 \u09a8\u09a6\u09c0", "\u0986\u09ae\u09bf \u09ac\u09be\u0982\u09b2\u09be \u09aa\u09dc\u09bf"],
        "Hindi": ["\u0915 \u0916 \u0917 \u0918", "\u092b\u0942\u0932 \u0928\u0926\u0940 \u0915\u093f\u0924\u093e\u092c", "\u092e\u0948\u0902 \u0939\u093f\u0902\u0926\u0940 \u092a\u0922\u0924\u093e \u0939\u0942\u0901"],
        "English": ["b d p q", "book flower river", "I read a short book"],
        "Multilingual": ["\u0995 \u0915 b d", "\u09ac\u0987 \u0915\u093f\u0924\u093e\u092c book", "\u0986\u09ae\u09bf \u092a\u0922\u0924\u093e read"],
    }[language]
    prompt = st.selectbox("Reading prompt", tasks)
    policy_path = WORKSPACE / "tutoring" / "policy.json"
    events_path = WORKSPACE / "tutoring" / "events.csv"
    actions = [f"task_{index}" for index in range(len(tasks))]
    agent = AdaptiveTutorAgent.load_or_create(policy_path, actions)
    st.text_area("Prompt", value=prompt, height=110)
    time_seconds = st.number_input("Reading time seconds", min_value=0.0, max_value=600.0, value=0.0)
    hesitations = st.number_input("Hesitations", min_value=0, max_value=100, value=0, key="practice_h_mobile")
    repetitions = st.number_input("Repetitions", min_value=0, max_value=100, value=0, key="practice_r_mobile")
    omissions = st.number_input("Omissions", min_value=0, max_value=100, value=0, key="practice_o_mobile")
    state = build_state(language, float(time_seconds), int(hesitations), int(repetitions), int(omissions))
    suggested_action = agent.select_action(state, explore=False)
    suggested_index = int(suggested_action.split("_")[-1]) if "_" in suggested_action else 0
    suggested_index = min(max(suggested_index, 0), len(tasks) - 1)
    st.caption(f"RL tutor suggests next prompt: {tasks[suggested_index]}")

    if st.button("Update RL Tutor", key="update_rl_tutor_mobile"):
        current_action = f"task_{int(tasks.index(prompt))}"
        reward = compute_reward(float(time_seconds), int(hesitations), int(repetitions), int(omissions))
        next_state = build_state(language, max(float(time_seconds) - 4.0, 0.0), max(int(hesitations) - 1, 0), max(int(repetitions) - 1, 0), max(int(omissions) - 1, 0))
        agent.update(state, current_action, reward, next_state)
        agent.save(policy_path)
        append_tutoring_event(
            events_path,
            {
                "language": language,
                "state": state.key(),
                "action": current_action,
                "reward": reward,
                "reading_time_seconds": float(time_seconds),
                "hesitations": int(hesitations),
                "repetitions": int(repetitions),
                "omissions": int(omissions),
            },
        )
        next_action = agent.select_action(next_state, explore=False)
        next_index = int(next_action.split("_")[-1]) if "_" in next_action else suggested_index
        next_index = min(max(next_index, 0), len(tasks) - 1)
        st.success(f"Tutor updated. Suggested next prompt: {tasks[next_index]}")
    difficulty = min(time_seconds / 60, 2.0) + hesitations * 0.4 + repetitions * 0.35 + omissions * 0.5
    if difficulty >= 4:
        st.warning("Use a shorter prompt and repeat slowly with guided support.")
    elif difficulty >= 2:
        st.info("Repeat this prompt and mark difficult letters or words.")
    else:
        st.success("This prompt is suitable. Move forward when the user is comfortable.")


def render_speech_therapy() -> None:
    st.subheader("Speech Therapy")
    therapy_root = WORKSPACE / "therapy"
    paths = create_therapy_workspace(therapy_root)

    language = st.selectbox("Therapy language", list(DEFAULT_TEXT_BY_LANGUAGE), key="therapy_language")
    therapy_tasks = speech_therapy_tasks_for_language(language)
    selected_index = st.selectbox(
        "Therapy exercise",
        range(len(therapy_tasks)),
        format_func=lambda index: f"{therapy_tasks[index].level} - {therapy_tasks[index].target_sound}",
    )
    task = therapy_tasks[selected_index]
    st.text_area("Practice prompt", value=task.prompt, height=90)
    st.caption(task.goal)

    student_hash = st.text_input("Anonymous user ID", value="anon_user_001", key="therapy_student")
    if hasattr(st, "audio_input"):
        speech_audio = st.audio_input("Record therapy audio")
    else:
        speech_audio = st.file_uploader("Therapy audio", type=["wav"], key="therapy_audio_upload")

    left, right = st.columns(2)
    with left:
        pronunciation_errors = st.number_input("Pronunciation errors", min_value=0, max_value=100, value=0, key="therapy_pron")
        syllable_repetitions = st.number_input("Syllable repetitions", min_value=0, max_value=100, value=0, key="therapy_repeat")
    with right:
        sound_substitutions = st.number_input("Sound substitutions", min_value=0, max_value=100, value=0, key="therapy_sub")
        attention_rating = st.slider("Attention rating", min_value=1, max_value=5, value=3)

    if st.button("Analyze Therapy Session", type="primary"):
        session_id = f"THER_{date.today().strftime('%Y%m%d')}_{pd.Timestamp.now().strftime('%H%M%S')}"
        audio_path = ""
        duration_seconds = 0.0
        if speech_audio is not None:
            suffix = Path(getattr(speech_audio, "name", "therapy.wav")).suffix or ".wav"
            destination = paths["audio"] / f"{session_id}{suffix}"
            audio_path = persist_upload(speech_audio, destination, therapy_root)
            duration_seconds = estimate_wav_duration(therapy_root / audio_path)

        result = score_therapy_session(
            duration_seconds,
            int(pronunciation_errors),
            int(syllable_repetitions),
            int(sound_substitutions),
            int(attention_rating),
        )
        append_therapy_session(
            paths["sessions"],
            {
                "session_id": session_id,
                "student_hash": student_hash,
                "task_id": task.task_id,
                "language": task.language,
                "level": task.level,
                "target_sound": task.target_sound,
                "prompt": task.prompt,
                "audio_path": audio_path,
                "duration_seconds": round(duration_seconds, 3),
                "pronunciation_errors": int(pronunciation_errors),
                "syllable_repetitions": int(syllable_repetitions),
                "sound_substitutions": int(sound_substitutions),
                "attention_rating": int(attention_rating),
                "therapy_score": result.therapy_score,
                "recommendation": result.recommendation,
                "session_date": pd.Timestamp.now().isoformat(),
            },
        )

        left, right = st.columns(2)
        with left:
            st.metric("Therapy score", f"{result.therapy_score:.0%}")
        with right:
            st.metric("Next step", result.next_level.title())
        st.progress(result.therapy_score, text=result.recommendation)
        if audio_path:
            st.caption(f"Saved audio: {relative_audio_path(therapy_root / audio_path, Path.cwd())}")
        st.success(f"Saved therapy session {session_id}")


def render_records() -> None:
    st.subheader("Local Records")
    manifest = WORKSPACE / "manifest.csv"
    therapy_log = WORKSPACE / "therapy" / "therapy_sessions.csv"
    tutoring_log = WORKSPACE / "tutoring" / "events.csv"
    intervention_log = WORKSPACE / "intervention" / "recommendations.csv"
    if manifest.exists():
        frame = pd.read_csv(manifest)
        st.metric("Collected samples", len(frame))
        st.dataframe(frame.tail(20), width="stretch", hide_index=True)
    else:
        st.info("No collected screening records yet.")
    if therapy_log.exists():
        therapy_frame = pd.read_csv(therapy_log)
        st.metric("Therapy sessions", len(therapy_frame))
        st.dataframe(therapy_frame.tail(20), width="stretch", hide_index=True)
    if tutoring_log.exists():
        tutor_frame = pd.read_csv(tutoring_log)
        st.metric("RL tutoring events", len(tutor_frame))
        st.dataframe(tutor_frame.tail(20), width="stretch", hide_index=True)
    if intervention_log.exists():
        intervention_frame = pd.read_csv(intervention_log)
        st.metric("Intervention plans", len(intervention_frame))
        st.dataframe(intervention_frame.tail(20), width="stretch", hide_index=True)


def main() -> None:
    with st.sidebar:
        st.header("Runtime")
        model_path = st.text_input("Optimized model", value="exports/deployment/pruned_30_quantized.pt")
        checkpoint_path = st.text_input("Fallback checkpoint", value="checkpoints/best_model.pt")
        model_text_language = st.selectbox(
            "Model text vocabulary",
            list(SUPPORTED_LANGUAGES),
            format_func=lambda key: SUPPORTED_LANGUAGES[key],
        )

    model, runtime_name = load_runtime_model(model_path, checkpoint_path)
    st.title("Dyslexia Screening")
    st.caption("Mobile/web prototype for Bengali screening, sample collection, speech therapy, and guided practice for all users.")

    tabs = st.tabs(["Screen", "Webcam", "Collect", "Practice", "Speech", "Records"])
    with tabs[0]:
        render_screening(model, runtime_name, model_text_language)
    with tabs[1]:
        render_webcam_analysis(model, runtime_name, model_text_language)
    with tabs[2]:
        render_collection()
    with tabs[3]:
        render_practice()
    with tabs[4]:
        render_speech_therapy()
    with tabs[5]:
        render_records()


if __name__ == "__main__":
    main()
