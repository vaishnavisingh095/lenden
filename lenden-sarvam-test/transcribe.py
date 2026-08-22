#!/usr/bin/env python3
"""Transcribe one audio file with Sarvam AI Saaras v3."""

import argparse
import os
import sys
from pathlib import Path

from sarvamai import SarvamAI


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Transcribe a Hindi/Hinglish audio file with Sarvam AI."
    )
    parser.add_argument("audio_file", type=Path, help="Path to an .m4a audio file")
    args = parser.parse_args()

    if args.audio_file.suffix.lower() != ".m4a":
        parser.error("audio_file must be an .m4a file")
    if not args.audio_file.is_file():
        parser.error(f"file not found: {args.audio_file}")
    if args.audio_file.stat().st_size == 0:
        parser.error(f"file is empty: {args.audio_file}")

    api_key = os.environ.get("SARVAM_API_KEY")
    if not api_key:
        print("Error: SARVAM_API_KEY is not set.", file=sys.stderr)
        return 1

    client = SarvamAI(api_subscription_key=api_key)
    with args.audio_file.open("rb") as audio:
        response = client.speech_to_text.transcribe(
            file=audio,
            model="saaras:v3",
            mode="transcribe",
        )

    print(f"Transcript: {response.transcript}")
    print(f"Language: {response.language_code}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())