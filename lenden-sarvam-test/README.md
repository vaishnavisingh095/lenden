# lenden-sarvam-test

Minimal Python command-line test for Sarvam AI Speech-to-Text using the Saaras v3 model.

## Run

From this directory:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python transcribe.py /path/to/voice-note.m4a
```

The project reads `SARVAM_API_KEY` from the environment. The key is already configured as a Replit Secret for this project.

The synchronous REST endpoint supports audio up to 30 seconds. For longer recordings, split the file or use Sarvam's batch API.