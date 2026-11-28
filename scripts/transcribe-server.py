# /// script
# requires-python = ">=3.11,<3.14"
# dependencies = ["mlx-whisper"]
# ///
# Agentic Platform – long-lived dictation process (phase 3). Started by extras.js via `uv run transcribe-server.py`.
# The whisper-large-v3-turbo model (mlx, local, the voice never leaves the Mac) loads once at start, then transcribes
# recordings one by one. Protocol: on stdin a JSON line {"id": 1, "file": "/path/recording.webm"},
# on stdout a JSON line {"id": 1, "text": "...", "ms": 812} or {"id": 1, "error": "..."}.
import json, sys, time, os, tempfile, subprocess

import mlx_whisper

MODEL = "mlx-community/whisper-large-v3-turbo"
PROMPT = "Mesto agentov, Claude, poschodie, vedúci, zamestnanec, priečinok, CLAUDE.md, commit."


def send(o):
    sys.stdout.write(json.dumps(o, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def transcription(file):
    return mlx_whisper.transcribe(file, path_or_hf_repo=MODEL, language="sk", initial_prompt=PROMPT,
                                  condition_on_previous_text=False)["text"].strip()


# warm-up: a short silence so the model loads right away and the first real message is fast
t = time.time()
try:
    quiet = os.path.join(tempfile.gettempdir(), "city-quiet.wav")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono", "-t", "0.5", quiet], check=True)
    transcription(quiet)
except Exception as e:  # warm-up is optional
    print("zahriatie zlyhalo:", e, file=sys.stderr)
send({"ready": True, "ms": round((time.time() - t) * 1000)})

for row in sys.stdin:
    try:
        z = json.loads(row)
    except ValueError:
        continue
    t = time.time()
    try:
        send({"id": z.get("id"), "text": transcription(z["file"]), "ms": round((time.time() - t) * 1000)})
    except Exception as e:
        send({"id": z.get("id"), "error": str(e)})
