from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class DataConfig:
    image_size: int = 128
    sample_rate: int = 16_000
    n_mfcc: int = 40
    max_audio_frames: int = 160
    max_text_length: int = 96
    text_language: str = "bengali"


@dataclass(frozen=True)
class TrainConfig:
    batch_size: int = 8
    epochs: int = 10
    learning_rate: float = 1e-3
    weight_decay: float = 1e-4
    num_workers: int = 0
    checkpoint_dir: Path = Path("checkpoints")


DEFAULT_BENGALI_CHARS = (
    "অআইঈউঊঋএঐওঔ"
    "কখগঘঙচছজঝঞটঠডঢণতথদধনপফবভমযরলশষসহড়ঢ়য়ৎংঃঁ"
    "ািীুূৃেৈোৌ্"
    "0123456789 .,!?-"
)

DEFAULT_DEVANAGARI_CHARS = (
    "\u0905\u0906\u0907\u0908\u0909\u090a\u090b\u090f\u0910\u0913\u0914"
    "\u0915\u0916\u0917\u0918\u0919\u091a\u091b\u091c\u091d\u091e\u091f\u0920\u0921\u0922\u0923"
    "\u0924\u0925\u0926\u0927\u0928\u092a\u092b\u092c\u092d\u092e\u092f\u0930\u0932\u0935"
    "\u0936\u0937\u0938\u0939\u093c\u0902\u0903\u0901"
    "\u093e\u093f\u0940\u0941\u0942\u0943\u0947\u0948\u094b\u094c\u094d"
    "0123456789 .,!?-"
)

DEFAULT_LATIN_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,!?-'"

LANGUAGE_CHARSETS = {
    "bengali": DEFAULT_BENGALI_CHARS,
    "bangla": DEFAULT_BENGALI_CHARS,
    "devanagari": DEFAULT_DEVANAGARI_CHARS,
    "english": DEFAULT_LATIN_CHARS,
    "latin": DEFAULT_LATIN_CHARS,
}

SUPPORTED_LANGUAGES = {
    "bengali": "Bengali",
    "english": "English",
    "multilingual": "Multilingual",
}

MULTILINGUAL_CHARS = "".join(dict.fromkeys(DEFAULT_BENGALI_CHARS + DEFAULT_DEVANAGARI_CHARS + DEFAULT_LATIN_CHARS))


def get_language_charset(language: str = "bengali") -> str:
    key = str(language or "bengali").strip().lower()
    if key == "multilingual":
        return MULTILINGUAL_CHARS
    return LANGUAGE_CHARSETS.get(key, DEFAULT_BENGALI_CHARS)
