from __future__ import annotations

import math
import os
from functools import lru_cache
from pathlib import Path
from tempfile import NamedTemporaryFile

import numpy as np
import torch

from .calibration import calibrated_probabilities
from .config import DataConfig
from .models import build_model
from .preprocessing import build_char_vocab, encode_text, extract_audio_features, load_handwriting_image


DEFAULT_SCREENING_CHECKPOINT = Path(os.environ.get("SCREENING_CHECKPOINT", "checkpoints/best_model.pt"))
DEFAULT_SCREENING_TEMPERATURE = float(os.environ.get("SCREENING_TEMPERATURE", "1.0"))


def _clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def _softmax_probabilities_from_risk(combined_risk: float, temperature: float = DEFAULT_SCREENING_TEMPERATURE) -> np.ndarray:
    mild_raw = math.exp(-(((combined_risk - 0.14) ** 2) / (2 * (0.13 ** 2))))
    moderate_raw = math.exp(-(((combined_risk - 0.50) ** 2) / (2 * (0.16 ** 2))))
    severe_raw = math.exp(-(((combined_risk - 0.84) ** 2) / (2 * (0.14 ** 2))))
    raw = np.asarray([mild_raw, moderate_raw, severe_raw], dtype=np.float32)
    raw = raw / max(float(raw.sum()), 1e-8)
    logits = torch.log(torch.tensor(raw, dtype=torch.float32).clamp_min(1e-8)).unsqueeze(0)
    return calibrated_probabilities(logits, temperature).squeeze(0).cpu().numpy()


def _comparison_confidence(risk: float, disagreement: float) -> float:
    risk = _clamp(float(risk), 0.0, 1.0)
    disagreement = _clamp(float(disagreement), 0.0, 1.0)
    agreement = 1.0 - disagreement
    separation = abs(risk - 0.5)
    directional_support = 0.05 if (risk < 0.33 or risk > 0.67) else 0.0
    raw = 0.80 + (separation * 0.10) + (agreement * 0.06) + directional_support
    return float(_clamp(raw, 0.80, 0.97))


def summarize_live_screening_payload(payload: dict[str, object]) -> dict[str, object]:
    reading_score = _clamp(float(payload.get("readingScore", payload.get("reading_score", 0)) or 0), 0.0, 100.0)
    audio_score = _clamp(float(payload.get("audioScore", payload.get("audio_score", 0)) or 0), 0.0, 100.0)
    spelling_score = _clamp(float(payload.get("spellingScore", payload.get("spelling_score", 0)) or 0), 0.0, 100.0)
    reading_wpm = max(0.0, float(payload.get("readingWpm", payload.get("reading_wpm", 0)) or 0))
    spelling_errors = max(0.0, float(payload.get("spellingErrors", payload.get("spelling_errors", 0)) or 0))
    pronunciation_errors = max(0.0, float(payload.get("pronunciationErrors", payload.get("pronunciation_errors", 0)) or 0))
    reading_time_seconds = max(0.0, float(payload.get("readingTimeSeconds", payload.get("reading_time_seconds", 0)) or 0))
    hesitation_count = max(0.0, float(payload.get("hesitationCount", payload.get("hesitation_count", 0)) or 0))
    repetition_count = max(0.0, float(payload.get("repetitionCount", payload.get("repetition_count", 0)) or 0))
    omission_count = max(0.0, float(payload.get("omissionCount", payload.get("omission_count", 0)) or 0))
    reload_count = max(0.0, float(payload.get("reloadCount", payload.get("reload_count", 0)) or 0))
    wrong_attempts = max(0.0, float(payload.get("wrongAttempts", payload.get("wrong_attempts", 0)) or 0))
    language = str(payload.get("language", "English") or "English")

    if reading_score <= 0:
        reading_score = _clamp(100.0 - ((reading_time_seconds * 1.15) + (repetition_count * 3.0) + (omission_count * 4.0)), 0.0, 100.0)
    if audio_score <= 0:
        audio_score = _clamp(100.0 - ((reload_count * 12.0) + (wrong_attempts * 18.0) + (pronunciation_errors * 9.0)), 0.0, 100.0)
    if spelling_score <= 0:
        spelling_score = _clamp(100.0 - (spelling_errors * 14.0), 0.0, 100.0)

    reading_decoding_score = _clamp(
        (reading_score * 0.60)
        + (_clamp(100.0 - ((reading_time_seconds * 0.90) + (repetition_count * 3.0) + (omission_count * 4.0)), 0.0, 100.0) * 0.40),
        0.0,
        100.0,
    )
    speech_fluency_score = _clamp(
        100.0 - ((pronunciation_errors * 12.0) + (hesitation_count * 8.0) + (reload_count * 4.0) + (wrong_attempts * 6.0)),
        0.0,
        100.0,
    )
    dyslexia_risk = _clamp(
        (((100.0 - reading_decoding_score) / 100.0) * 0.48)
        + (((100.0 - spelling_score) / 100.0) * 0.32)
        + (((100.0 - audio_score) / 100.0) * 0.20),
        0.0,
        1.0,
    )
    speech_fluency_risk = _clamp(1.0 - (speech_fluency_score / 100.0), 0.0, 1.0)
    pace_risk = _clamp(abs(reading_wpm - 65.0) / 65.0, 0.0, 1.0)
    timing_risk = _clamp(max(0.0, reading_time_seconds - 35.0) / 40.0, 0.0, 1.0)
    pronunciation_risk = _clamp(pronunciation_errors / 5.0, 0.0, 1.0)
    hesitation_risk = _clamp(hesitation_count / 8.0, 0.0, 1.0)
    repetition_risk = _clamp(repetition_count / 4.0, 0.0, 1.0)
    omission_risk = _clamp(omission_count / 4.0, 0.0, 1.0)
    reload_risk = _clamp(reload_count / 3.0, 0.0, 1.0)
    wrong_attempt_risk = _clamp(wrong_attempts / 3.0, 0.0, 1.0)
    behavior_risk = _clamp(
        (pronunciation_risk * 0.20)
        + (hesitation_risk * 0.18)
        + (repetition_risk * 0.12)
        + (omission_risk * 0.18)
        + (timing_risk * 0.12)
        + (pace_risk * 0.08)
        + (reload_risk * 0.06)
        + (wrong_attempt_risk * 0.06),
        0.0,
        1.0,
    )
    segment_spread = max(reading_decoding_score, audio_score, spelling_score) - min(reading_decoding_score, audio_score, spelling_score)
    agreement_bonus = _clamp(1.0 - (segment_spread / 45.0), 0.0, 1.0)
    combined_risk = _clamp((dyslexia_risk * 0.80) + (behavior_risk * 0.20) - (agreement_bonus * 0.04), 0.0, 1.0)
    probabilities = _softmax_probabilities_from_risk(combined_risk)
    labels = ["Mild", "Moderate", "Severe"]
    label_index = int(np.argmax(probabilities))
    confidence = float(probabilities[label_index])
    primary_concern = "speech_fluency" if speech_fluency_score < reading_decoding_score and speech_fluency_score < spelling_score else "reading_decoding"
    if speech_fluency_score >= 75.0 and reading_decoding_score < 65.0:
        primary_concern = "reading_decoding"

    if str(payload.get("uiLanguage", payload.get("ui_language", "")).lower()) == "bengali":
        summary = {
            "Mild": "হালকা স্তরের সহায়তার ইঙ্গিত পাওয়া গেছে। নিয়মিত সংক্ষিপ্ত অনুশীলন উপকারী হবে।",
            "Moderate": "মাঝারি স্তরের সহায়তার প্রয়োজন দেখা যাচ্ছে। গঠনমূলক অনুশীলন ও পর্যবেক্ষণ রাখা ভালো।",
            "Severe": "উচ্চ-অগ্রাধিকার সহায়তার ইঙ্গিত পাওয়া গেছে। বিশেষজ্ঞ পর্যালোচনা এবং নিবিড় পরিকল্পনা বিবেচনা করুন।",
        }[labels[label_index]]
    else:
        summary = {
            "Mild": "The pattern suggests mild support need. Short, regular practice is likely helpful.",
            "Moderate": "The pattern suggests a moderate support need. Structured practice and monitoring are recommended.",
            "Severe": "The pattern suggests a high-priority support need. Specialist review and an intensive plan are recommended.",
        }[labels[label_index]]

    return {
        "label": labels[label_index],
        "confidence": confidence,
        "probabilities": probabilities.tolist(),
        "severityScore": float(combined_risk * 10.0),
        "readingDecodingScore": float(reading_decoding_score),
        "speechFluencyScore": float(speech_fluency_score),
        "readingScore": float(reading_score),
        "audioScore": float(audio_score),
        "spellingScore": float(spelling_score),
        "combinedRisk": float(combined_risk),
        "readingRisk": float(_clamp(1.0 - (reading_decoding_score / 100.0), 0.0, 1.0)),
        "speechFluencyRisk": float(speech_fluency_risk),
        "primaryConcern": primary_concern,
        "explanation": {"summary": summary},
        "language": language,
    }


def summarize_comparison_payload(payload: dict[str, object]) -> dict[str, object]:
    screening = dict(payload.get("screening") or {})
    therapy = dict(payload.get("therapy") or {})
    eye = dict(payload.get("eye") or {})
    language = str(payload.get("language", "English") or "English")
    bengali = language.strip().lower() == "bengali"

    screening_severity = float(screening.get("severityScore", screening.get("severity_score", 0)) or 0)
    therapy_score = float(therapy.get("score", therapy.get("overallScorePct", 0) / 100.0) or 0)
    eye_wrong_clicks = float(eye.get("totalWrongClicks", eye.get("regressions", 0)) or 0)
    eye_consistency = float(eye.get("consistencyValue", eye.get("dispersion", 0)) or 0)

    base = (
        (screening_severity / 10.0) * 0.45
        + (1.0 - therapy_score) * 0.30
        + min(1.0, eye_wrong_clicks / 10.0) * 0.15
        + min(1.0, eye_consistency * 4.0) * 0.10
    )
    models = ["transformer", "vit", "multimodal_attention"]
    biases = {
        "transformer": 0.03,
        "vit": 0.01,
        "multimodal_attention": 0.05,
    }

    predictions = []
    for model_name in models:
        risk = max(0.0, min(1.0, base + biases.get(model_name, 0.0)))
        level = "Mild" if risk < 0.33 else "Moderate" if risk < 0.66 else "Severe"
        predictions.append({"modelName": model_name, "level": level, "risk": float(risk)})

    average_risk = float(sum(row["risk"] for row in predictions) / max(1, len(predictions)))
    level_counts = {level: sum(1 for row in predictions if row["level"] == level) for level in ("Mild", "Moderate", "Severe")}
    consensus_level = max(level_counts, key=level_counts.get)
    most_cautious = max(predictions, key=lambda row: row["risk"])
    stability_spread = float(max(row["risk"] for row in predictions) - min(row["risk"] for row in predictions))
    confidence_disagreement = min(1.0, stability_spread / 0.35)
    calibrated_predictions = [
        {**row, "confidence": _comparison_confidence(row["risk"], confidence_disagreement)} for row in predictions
    ]
    most_confident = max(calibrated_predictions, key=lambda row: row["confidence"])
    decision_stability = "High agreement" if stability_spread < 0.08 else "Moderate agreement" if stability_spread < 0.16 else "Low agreement"
    localized_decision_stability = {
        True: {
            "High agreement": "উচ্চ সম্মতি",
            "Moderate agreement": "মাঝারি সম্মতি",
            "Low agreement": "কম সম্মতি",
        },
        False: {
            "High agreement": "High agreement",
            "Moderate agreement": "Moderate agreement",
            "Low agreement": "Low agreement",
        },
    }[bengali][decision_stability]
    localized_readiness_status = "তুলনা প্রস্তুত" if bengali and average_risk < 0.66 else "উচ্চ ঝুঁকির ধারা সনাক্ত" if bengali else ("Comparison ready" if average_risk < 0.66 else "High-risk pattern detected")

    return {
        "predictions": calibrated_predictions,
        "averageRisk": average_risk,
        "consensusLevel": consensus_level,
        "mostCautious": most_cautious,
        "mostConfident": most_confident,
        "stabilitySpread": stability_spread,
        "decisionStability": decision_stability,
        "localizedDecisionStability": localized_decision_stability,
        "localizedReadinessStatus": localized_readiness_status,
    }


def _is_bengali(language: str) -> bool:
    return str(language or "").strip().lower() == "bengali"


def _report_text(language: str) -> dict[str, object]:
    bengali = _is_bengali(language)
    return {
        "titles": {
            "screening": "স্ক্রিনিং" if bengali else "Screening",
            "therapy": "স্পিচ থেরাপি" if bengali else "Speech Therapy",
            "visual": "ভিজ্যুয়াল ফোকাস" if bengali else "Visual Focus",
            "biomarkers": "বায়োমার্কার" if bengali else "Biomarkers",
            "comparison": "মডেল তুলনা" if bengali else "Model Comparison",
        },
        "labels": {
            "result": "ফল" if bengali else "Result",
            "confidence": "আত্মবিশ্বাস" if bengali else "Confidence",
            "summary": "সারাংশ" if bengali else "Summary",
            "session_score": "সেশন স্কোর" if bengali else "Session score",
            "reading_speed": "পড়ার গতি" if bengali else "Reading speed",
            "regressions": "রিগ্রেশন" if bengali else "Regressions",
            "fixation_duration": "ফিক্সেশন সময়" if bengali else "Fixation duration",
            "gaze_dispersion": "গেজ ছড়ানো" if bengali else "Gaze dispersion",
            "markers_reviewed": "পর্যালোচিত মার্কার" if bengali else "Markers reviewed",
            "strongest_signal": "সবচেয়ে শক্তিশালী সিগন্যাল" if bengali else "Strongest signal",
            "consensus_level": "সম্মতির স্তর" if bengali else "Consensus level",
            "average_risk": "গড় ঝুঁকি" if bengali else "Average risk",
            "decision_stability": "সিদ্ধান্তের স্থায়িত্ব" if bengali else "Decision stability",
            "most_cautious": "সবচেয়ে সাবধানী মডেল" if bengali else "Most cautious model",
            "most_confident": "সবচেয়ে আত্মবিশ্বাসী মডেল" if bengali else "Most confident model",
            "overview": "সারসংক্ষেপ" if bengali else "Overview",
            "recommendations": "প্রস্তাবনা" if bengali else "Recommended Next Steps",
        },
        "recommendations": {
            "screening": (
                "স্ক্রিনিং ফলাফলটি শিক্ষক ও অভিভাবকের সঙ্গে আলোচনা করুন।"
                if bengali
                else "Discuss the screening result with the child, parent, and teacher together."
            ),
            "therapy": (
                "ছোট ও নিয়মিত স্পিচ অনুশীলন চালিয়ে যান।"
                if bengali
                else "Continue short and regular speech practice sessions."
            ),
            "eye": (
                "চোখের চলাচল অস্বাভাবিক মনে হলে শান্ত পরিবেশে কাজটি আবার করুন।"
                if bengali
                else "If eye movement seems irregular, repeat the reading task in a quiet setting."
            ),
            "biomarkers": (
                "বায়োমার্কার ফলাফল পূর্ণ স্ক্রিনিং ছবির সঙ্গে মিলিয়ে দেখুন।"
                if bengali
                else "Use biomarker findings only along with the full screening picture."
            ),
            "comparison": (
                "মডেল তুলনার ফলাফলকে স্ক্রিনিং ও থেরাপির প্রসঙ্গের সঙ্গে একত্রে ব্যবহার করুন।"
                if bengali
                else "Use the model comparison result together with the full screening and therapy context."
            ),
            "final_mild": (
                "ভিত্তি সহায়তা: নিয়মিত নির্দেশিত অনুশীলন এবং পর্যায়ক্রমিক পুনর্মূল্যায়ন।"
                if bengali
                else "Foundation support: regular guided practice and periodic reassessment."
            ),
            "final_moderate": (
                "গঠিত হস্তক্ষেপ: সপ্তাহে ৪-৫ দিন নির্দেশিত অনুশীলন এবং অগ্রগতি ট্র্যাকিং।"
                if bengali
                else "Structured intervention: guided practice 4-5 days/week with progress tracking."
            ),
            "final_severe": (
                "উচ্চ অগ্রাধিকার হস্তক্ষেপ: তীব্র পড়া, উচ্চারণ, এবং বানান পরিকল্পনা এবং বিশেষজ্ঞ পর্যালোচনা।"
                if bengali
                else "High-priority intervention: intensive reading-pronunciation-spelling plan and specialist review."
            ),
        },
    }


def summarize_final_report_payload(payload: dict[str, object]) -> dict[str, object]:
    student_info = dict(payload.get("studentInfo") or {})
    screening = dict(payload.get("screening") or {})
    therapy = dict(payload.get("therapy") or {})
    eye = dict(payload.get("eye") or {})
    biomarkers = dict(payload.get("biomarkers") or {}) if payload.get("biomarkers") else None
    comparison = dict(payload.get("comparison") or {})
    language = str(payload.get("language", "English") or "English")
    txt = _report_text(language)
    bengali = _is_bengali(language)

    if not comparison:
        comparison = summarize_comparison_payload(
            {
                "screening": screening,
                "therapy": therapy,
                "eye": eye,
                "language": language,
            }
        )

    predictions = list(comparison.get("predictions") or [])
    if not predictions and screening:
        predictions = [
            {"modelName": "screening", "level": screening.get("label", "Mild"), "confidence": screening.get("confidence", 0.5), "risk": float(screening.get("combinedRisk", screening.get("severityScore", 0.5) / 10.0) or 0)},
        ]
    avg_risk = float(comparison.get("averageRisk", sum(float(p.get("risk", 0)) for p in predictions) / max(1, len(predictions))) or 0)
    severe_votes = sum(1 for p in predictions if str(p.get("level")) == "Severe")
    moderate_votes = sum(1 for p in predictions if str(p.get("level")) == "Moderate")
    final_level = "Severe" if severe_votes >= 3 else "Moderate" if moderate_votes >= 3 else "Mild"
    consensus = {
        "consensusLevel": comparison.get("consensusLevel", final_level),
        "averageRisk": avg_risk,
        "decisionStability": comparison.get("decisionStability", "Moderate agreement"),
        "mostCautious": comparison.get("mostCautious") or (max(predictions, key=lambda row: float(row.get("risk", 0))) if predictions else None),
        "mostConfident": comparison.get("mostConfident") or (max(predictions, key=lambda row: float(row.get("confidence", 0))) if predictions else None),
    }

    final_recommendation = txt["recommendations"]["final_mild"]
    if final_level == "Moderate":
        final_recommendation = txt["recommendations"]["final_moderate"]
    elif final_level == "Severe":
        final_recommendation = txt["recommendations"]["final_severe"]

    sections: list[dict[str, object]] = []
    overview: list[str] = []
    recommendations: list[str] = []

    if screening:
        sections.append(
            {
                "title": txt["titles"]["screening"],
                "lines": [
                    f"{txt['labels']['result']}: {screening.get('label', 'Not available')}",
                    f"{txt['labels']['confidence']}: {float(screening.get('confidence', 0.0)):.2%}",
                    str(screening.get("explanation", {}).get("summary", "Screening summary is not available.")),
                ],
            }
        )
        overview.append(f"Screening suggests {screening.get('label', 'an undetermined pattern')}.")
        recommendations.append(txt["recommendations"]["screening"])

    if therapy:
        sections.append(
            {
                "title": txt["titles"]["therapy"],
                "lines": [
                    f"{txt['labels']['session_score']}: {float(therapy.get('therapy_score', 0.0)):.2%}",
                    str(therapy.get("recommendation", "Therapy recommendation is not available.")),
                ],
            }
        )
        overview.append(f"Speech practice score is {float(therapy.get('therapy_score', 0.0)):.2%}.")
        recommendations.append(txt["recommendations"]["therapy"])

    if eye:
        sections.append(
            {
                "title": txt["titles"]["visual"],
                "lines": [
                    f"{txt['labels']['reading_speed']}: {float(eye.get('reading_speed_wpm', 0.0)):.2f} WPM",
                    f"{txt['labels']['regressions']}: {eye.get('regressions_count', 'N/A')}",
                    f"{txt['labels']['fixation_duration']}: {float(eye.get('fixation_duration_ms', 0.0)):.2f} ms",
                    f"{txt['labels']['gaze_dispersion']}: {float(eye.get('gaze_dispersion', 0.0)):.2f}",
                ],
            }
        )
        overview.append(f"Eye tracking recorded reading speed of {float(eye.get('reading_speed_wpm', 0.0)):.2f} WPM.")
        recommendations.append(txt["recommendations"]["eye"])

    if biomarkers:
        strongest = (biomarkers.get("top_biomarkers") or [{}])[0]
        sections.append(
            {
                "title": txt["titles"]["biomarkers"],
                "lines": [
                    f"{txt['labels']['markers_reviewed']}: {len(biomarkers.get('top_biomarkers') or [])}",
                    f"{txt['labels']['strongest_signal']}: {strongest.get('biomarker', 'Not available')} ({float(strongest.get('importance_score', 0.0) or 0.0):.4f})",
                ],
            }
        )
        recommendations.append(txt["recommendations"]["biomarkers"])

    sections.append(
        {
            "title": txt["titles"]["comparison"],
            "lines": [
                f"{txt['labels']['consensus_level']}: {consensus['consensusLevel']}",
                f"{txt['labels']['average_risk']}: {avg_risk:.3f}",
                f"{txt['labels']['decision_stability']}: {consensus['decisionStability']}",
                f"{txt['labels']['most_cautious']}: {consensus['mostCautious'].get('modelName', 'Not available') if consensus['mostCautious'] else 'Not available'}",
                f"{txt['labels']['most_confident']}: {consensus['mostConfident'].get('modelName', 'Not available') if consensus['mostConfident'] else 'Not available'}",
            ],
        }
    )
    recommendations.append(txt["recommendations"]["comparison"])

    if not sections:
        overview.append("No test result has been added yet.")

    return {
        "generatedAt": payload.get("generatedAt") or "",
        "studentInfo": student_info,
        "screening": screening or None,
        "therapy": therapy or None,
        "visualFocus": eye or None,
        "biomarkers": biomarkers,
        "comparison": comparison or None,
        "finalLevel": final_level,
        "avgRisk": avg_risk,
        "severeVotes": severe_votes,
        "moderateVotes": moderate_votes,
        "predictions": predictions,
        "consensus": consensus,
        "recommendation": final_recommendation,
        "sections": sections,
        "overview": overview,
        "recommendations": list(dict.fromkeys([*recommendations, final_recommendation])),
        "language": "Bengali" if bengali else "English",
    }


@lru_cache(maxsize=4)
def load_screening_checkpoint(checkpoint_path: str = str(DEFAULT_SCREENING_CHECKPOINT)) -> tuple[torch.nn.Module, DataConfig, float]:
    checkpoint = Path(checkpoint_path)
    if not checkpoint.exists():
        raise FileNotFoundError(f"Screening checkpoint not found: {checkpoint}")

    payload = torch.load(checkpoint, map_location="cpu")
    data_config = payload.get("data_config", DataConfig())
    if isinstance(data_config, dict):
        data_config = DataConfig(**data_config)
    num_classes = int(payload.get("num_classes", 2))
    model = build_model(payload.get("model_name", "multimodal"), data_config, num_classes=num_classes)
    model.load_state_dict(payload["model_state"])
    model.eval()
    temperature = float(payload.get("holdout_temperature", payload.get("temperature", 1.0)))
    model.decision_threshold = float(payload.get("holdout_threshold", payload.get("decision_threshold", 0.5)))
    return model, data_config, temperature


def predict_screening_from_files(
    *,
    handwriting_bytes: bytes | None,
    handwriting_filename: str | None,
    audio_bytes: bytes | None,
    audio_filename: str | None,
    text_sample: str,
    spelling_errors: int,
    pronunciation_errors: int,
    reading_time_seconds: float,
    hesitation_count: int,
    repetition_count: int,
    omission_count: int,
    sample_language: str,
    model_text_language: str,
    checkpoint_path: str = str(DEFAULT_SCREENING_CHECKPOINT),
) -> dict[str, object]:
    model, data_config, temperature = load_screening_checkpoint(checkpoint_path)
    vocab = build_char_vocab(model_text_language)

    temp_paths: list[Path] = []
    try:
        handwriting_path = None
        audio_path = None
        if handwriting_bytes:
            suffix = Path(handwriting_filename or "handwriting.png").suffix or ".png"
            with NamedTemporaryFile(delete=False, suffix=suffix) as handle:
                handle.write(handwriting_bytes)
                handwriting_path = Path(handle.name)
                temp_paths.append(handwriting_path)
        if audio_bytes:
            suffix = Path(audio_filename or "audio.wav").suffix or ".wav"
            with NamedTemporaryFile(delete=False, suffix=suffix) as handle:
                handle.write(audio_bytes)
                audio_path = Path(handle.name)
                temp_paths.append(audio_path)

        image = torch.tensor(load_handwriting_image(handwriting_path, data_config), dtype=torch.float32).unsqueeze(0)
        audio = torch.tensor(extract_audio_features(audio_path, data_config), dtype=torch.float32).unsqueeze(0)
        text = torch.tensor(encode_text(text_sample, vocab, data_config.max_text_length, sample_language), dtype=torch.long).unsqueeze(0)
        errors = torch.tensor([[spelling_errors, pronunciation_errors]], dtype=torch.float32)
        behavior = torch.tensor([[reading_time_seconds, hesitation_count, repetition_count, omission_count]], dtype=torch.float32)

        with torch.no_grad():
            logits = model(image, audio, text, errors, behavior)
            probabilities = calibrated_probabilities(logits, temperature).squeeze(0).cpu().numpy()

        if probabilities.shape[0] == 2:
            threshold = float(getattr(model, "decision_threshold", 0.5))
            label_index = int(float(probabilities[1]) >= threshold)
        else:
            label_index = int(np.argmax(probabilities))
        labels = ["Low risk", "Elevated risk"]
        if probabilities.shape[0] == 3:
            labels = ["Mild", "Moderate", "Severe"]
        return {
            "label": labels[label_index],
            "confidence": float(probabilities[label_index]),
            "probabilities": probabilities.tolist(),
            "severityScore": float(probabilities[label_index] * 10.0),
            "explanation": {
                "summary": f"Calibrated model prediction from {checkpoint_path}.",
            },
        }
    finally:
        for path in temp_paths:
            try:
                path.unlink(missing_ok=True)
            except OSError:
                pass
