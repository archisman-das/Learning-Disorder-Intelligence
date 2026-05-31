from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.dyslexia_detection.biomarkers import discover_digital_biomarkers


def main() -> None:
    parser = argparse.ArgumentParser(description="Discover digital biomarkers for Bengali dyslexia from multimodal data.")
    parser.add_argument("--manifest", required=True, help="Manifest CSV with handwriting, audio, and reading behavior fields.")
    parser.add_argument("--output-dir", default="reports/biomarkers")
    parser.add_argument("--top-k", type=int, default=15)
    args = parser.parse_args()

    result = discover_digital_biomarkers(args.manifest)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    dataset_path = output_dir / "biomarker_dataset.csv"
    summary_path = output_dir / "biomarker_summary.csv"
    result.dataset.to_csv(dataset_path, index=False)
    result.summary.to_csv(summary_path, index=False)

    print(f"Saved biomarker dataset: {dataset_path}")
    print(f"Saved biomarker summary: {summary_path}")
    print("Top biomarkers:")
    preview = result.summary.head(max(1, args.top_k))
    for _, row in preview.iterrows():
        print(
            f"{row['biomarker']}: importance={row['importance_score']:.4f} "
            f"cohens_d={row['cohens_d']:.4f} corr={row['label_correlation']:.4f}"
        )


if __name__ == "__main__":
    main()
