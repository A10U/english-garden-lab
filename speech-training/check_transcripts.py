"""Compare generated words with prompt text; this is not a naturalness rating."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re


def words(text):
    text = text.casefold().replace("’", "'")
    text = re.sub(r"\ba\s*\.?\s*i\b\.?", "ai", text)
    return re.findall(r"[a-z0-9]+(?:'[a-z]+)?", text)


def distance(reference, hypothesis):
    row = list(range(len(hypothesis) + 1))
    for i, ref in enumerate(reference, 1):
        new = [i]
        for j, hyp in enumerate(hypothesis, 1):
            new.append(min(new[-1] + 1, row[j] + 1, row[j - 1] + (ref != hyp)))
        row = new
    return row[-1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--asr-model", type=Path, default=Path(__file__).parent / "models/whisper-base.en-mlx")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    os.environ["HF_HUB_OFFLINE"] = "1"
    import mlx_whisper
    import mlx.core as mx

    output = {"checker": str(args.asr_model.resolve()),
        "purpose": "Generated-word transcription sanity check only",
        "naturalness_score": None,
        "limitations": "ASR can mishear names, contractions and short clips. Its errors are not necessarily synthesis errors. Results require listening review.",
        "sets": {}}
    for label, directory in [("baseline", args.baseline), ("candidate", args.candidate)]:
        data = json.loads((directory / "metadata.json").read_text())
        results, total_edits, total_words = [], 0, 0
        for record in data["results"]:
            if record["status"] != "ok":
                raise ValueError("Cannot evaluate a failed generated utterance")
            text = mlx_whisper.transcribe(str(directory / record["file"]),
                path_or_hf_repo=str(args.asr_model.resolve()), language="en",
                temperature=0.0, condition_on_previous_text=False)["text"].strip()
            expected, actual = words(record["text"]), words(text)
            edits = distance(expected, actual)
            total_edits += edits
            total_words += len(expected)
            results.append({"id": record["id"], "expected": record["text"],
                "transcript": text, "word_edits": edits, "reference_words": len(expected),
                "wer": edits / max(len(expected), 1)})
            print(label, record["id"], text, flush=True)
            mx.clear_cache()
        output["sets"][label] = {"utterances": len(results), "word_edits": total_edits,
            "reference_words": total_words, "wer": total_edits / max(total_words, 1),
            "results": results}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps({k: {x: y for x, y in v.items() if x != 'results'} for k, v in output['sets'].items()}, indent=2))


if __name__ == "__main__":
    main()
