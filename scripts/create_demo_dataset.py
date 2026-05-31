from __future__ import annotations

import wave
from pathlib import Path

import numpy as np
import pandas as pd
from PIL import Image, ImageDraw


def make_handwriting(path: Path, text: str, risk: int) -> None:
    image = Image.new("L", (220, 80), color=255)
    draw = ImageDraw.Draw(image)
    jitter = 5 if risk else 1
    x = 10
    for index, char in enumerate(text):
        y = 24 + ((index % 3) - 1) * jitter
        draw.text((x, y), char, fill=0)
        x += 17 + (risk * (index % 2))
    image.save(path)


def make_audio(path: Path, risk: int, sample_rate: int = 16_000) -> None:
    duration = 1.5
    t = np.linspace(0, duration, int(sample_rate * duration), endpoint=False)
    base = np.sin(2 * np.pi * 220 * t)
    hesitation = np.zeros_like(base)
    if risk:
        hesitation[int(0.45 * sample_rate) : int(0.65 * sample_rate)] = -base[
            int(0.45 * sample_rate) : int(0.65 * sample_rate)
        ]
    waveform = 0.2 * (base + hesitation)
    pcm = np.clip(waveform * 32767, -32768, 32767).astype(np.int16)
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        handle.writeframes(pcm.tobytes())


def main() -> None:
    root = Path("data/demo")
    handwriting_dir = root / "handwriting"
    audio_dir = root / "audio"
    handwriting_dir.mkdir(parents=True, exist_ok=True)
    audio_dir.mkdir(parents=True, exist_ok=True)

    rows = []
    texts = [
        "\u0986\u09ae\u09bf \u09ac\u09be\u0982\u09b2\u09be \u09aa\u09dc\u09bf",
        "\u09b8\u09c7 \u09ac\u0987 \u09aa\u09dc\u09c7",
        "\u0986\u09ae\u09be\u09b0 \u09b8\u09cd\u0995\u09c1\u09b2 \u09ad\u09be\u09b2\u09cb",
        "\u09ac\u09be\u0982\u09b2\u09be \u09ad\u09be\u09b7\u09be \u09ae\u09a7\u09c1\u09b0",
        "\u0986\u099c \u0986\u09ae\u09b0\u09be \u09b2\u09bf\u0996\u09bf",
        "\u09a4\u09c1\u09ae\u09bf \u0997\u09be\u09a8 \u0995\u09b0\u09cb",
        "\u09b6\u09bf\u09b6\u09c1 \u09ab\u09c1\u09b2 \u09a6\u09c7\u0996\u09c7",
        "\u09a8\u09a6\u09c0 \u09ac\u09df\u09c7 \u09af\u09be\u09df",
        "\u09aa\u09be\u0996\u09bf \u0989\u09dc\u09c7 \u09af\u09be\u09df",
        "\u0986\u09ae\u09b0\u09be \u098f\u0995\u09b8\u09be\u09a5\u09c7 \u09aa\u09dc\u09bf",
    ]

    for index in range(40):
        risk = int(index % 4 in {0, 1})
        sample_id = f"S{index + 1:03d}"
        text = texts[index % len(texts)]
        handwriting_path = handwriting_dir / f"{sample_id}.png"
        audio_path = audio_dir / f"{sample_id}.wav"
        make_handwriting(handwriting_path, text, risk)
        make_audio(audio_path, risk)
        rows.append(
            {
                "sample_id": sample_id,
                "student_hash": f"anon_{index + 1:03d}",
                "handwriting_path": f"handwriting/{sample_id}.png",
                "audio_path": f"audio/{sample_id}.wav",
                "text_sample": text,
                "spelling_errors": int(risk + (index % 2)),
                "pronunciation_errors": int(risk + (index % 3 == 0)),
                "reading_time_seconds": round(18 + risk * 12 + (index % 5) * 1.7, 2),
                "hesitation_count": int(risk * 3 + (index % 3)),
                "repetition_count": int(risk * 2 + (index % 2)),
                "omission_count": int(risk + (index % 4 == 0)),
                "language": "Bengali",
                "label": risk,
            }
        )

    pd.DataFrame(rows).to_csv(root / "manifest.csv", index=False)
    print(f"Demo dataset written to {root / 'manifest.csv'}")


if __name__ == "__main__":
    main()
