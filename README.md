# Aria — Personal AI Assistant

A voice-first personal assistant with chat, document analysis, image
analysis & captioning, and a live translator — built on Flask and the
Groq API.

## Features

- **Chat** — text or voice conversation, with spoken replies (Whisper
  large-v3-turbo for speech-to-text, Llama 3.3 70B for reasoning, Orpheus
  for speech-out — all served on Groq's LPUs for very low latency)
- **Documents** — upload a PDF, Word doc, or text file and get a summary,
  or ask a specific question about its contents
- **Image** — upload a photo for a one-line caption, a detailed breakdown,
  or ask a specific question about what's in it (Qwen3.6-27B vision)
- **Translate** — type, paste, or dictate text and translate it into 30+
  languages, then listen to the result

## Why Groq

Groq hosts open models (Llama, Qwen, Whisper, Orpheus) on custom LPU
hardware, so responses — especially chat and transcription — come back
noticeably faster than typical GPU-hosted APIs, and pricing is
significantly cheaper per token/hour. Everything in this app runs through
a single `GROQ_API_KEY`.

## Setup

### 1. Install dependencies

```bash
python -m venv venv
source venv/bin/activate   # on Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Add your Groq API key

Get a free key at [console.groq.com](https://console.groq.com), then
create a `.env` file in the project root (or set the variable in your
shell):

```bash
GROQ_API_KEY=gsk_...
```

> The English Orpheus TTS model requires accepting its model terms once
> in the [Groq console](https://console.groq.com/playground?model=canopylabs/orpheus-v1-english)
> before the `/text-to-speech` and voice-reply features will work.

### 3. Run it

```bash
python server.py
```

Visit `http://localhost:8000`.

## Deploying

The app is a plain Flask app — it runs on any host that supports Python
(Render, Railway, Fly.io, a VM, etc.). For production, run it behind
`gunicorn` instead of the Flask dev server:

```bash
gunicorn -w 2 -b 0.0.0.0:8000 server:app
```

Make sure `GROQ_API_KEY` is set in the host's environment variables.

## Project structure

```
server.py               Flask routes
worker.py                Groq API calls (chat, whisper, orpheus tts, vision, docs, translation)
templates/index.html     App shell (4 panels: chat, documents, image, translate)
static/style.css         Design system
static/script.js         Panel logic, recording, uploads, API calls
requirements.txt
```

## Models used

| Capability       | Model                              |
|-------------------|-------------------------------------|
| Chat / reasoning  | `llama-3.3-70b-versatile`          |
| Vision            | `qwen/qwen3.6-27b`                 |
| Speech-to-text    | `whisper-large-v3-turbo`           |
| Text-to-speech    | `canopylabs/orpheus-v1-english`    |

Swap any of these in `worker.py` (top of the file) if you'd like to try
alternatives from Groq's model catalog.

## Notes

- Uploads are capped at 20MB.
- Supported document types: `.pdf`, `.docx`, `.txt`, `.md`.
- Supported image types: `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`.
- Voice recording requires the browser to have microphone permission and
  runs over `MediaRecorder`, so use a modern browser (Chrome, Edge, Firefox,
  Safari 14.1+) served over `https://` or `localhost`.
- TTS audio comes back as `.wav`.
