import base64
import json
import os

from dotenv import load_dotenv
load_dotenv()

from flask import Flask, render_template, request, jsonify
from flask_cors import CORS

from worker import (
    speech_to_text,
    text_to_speech,
    process_chat_message,
    analyze_document,
    analyze_image,
    translate_text,
)

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

MAX_UPLOAD_MB = 20
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_MB * 1024 * 1024

ALLOWED_DOCUMENT_EXTENSIONS = {".pdf", ".docx", ".txt", ".md"}
ALLOWED_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp"}
IMAGE_MIME_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
}


def error_response(message, status=400):
    return jsonify({"error": message}), status


def get_extension(filename):
    return os.path.splitext(filename or "")[1].lower()


@app.route("/", methods=["GET"])
def index():
    return render_template("index.html")


# ---------------------------------------------------------------------------
# Voice
# ---------------------------------------------------------------------------

@app.route("/speech-to-text", methods=["POST"])
def speech_to_text_route():
    audio_binary = request.data
    if not audio_binary:
        return error_response("No audio data received.")

    try:
        text = speech_to_text(audio_binary)
    except Exception as exc:
        return error_response(f"Speech-to-text failed: {exc}", 500)

    return jsonify({"text": text})


@app.route("/text-to-speech", methods=["POST"])
def text_to_speech_route():
    data = request.json or {}
    text = data.get("text", "")
    voice = data.get("voice", "")

    if not text:
        return error_response("No text provided.")

    try:
        audio = text_to_speech(text, voice)
    except Exception as exc:
        return error_response(f"Text-to-speech failed: {exc}", 500)

    encoded = base64.b64encode(audio).decode("utf-8")
    return jsonify({"audio": encoded})


# ---------------------------------------------------------------------------
# Chat
# ---------------------------------------------------------------------------

@app.route("/process-message", methods=["POST"])
def process_message_route():
    data = request.json or {}
    user_message = data.get("userMessage", "")
    voice = data.get("voice", "")
    history = data.get("history", [])
    speak = data.get("speak", True)

    if not user_message:
        return error_response("No message provided.")

    try:
        response_text = process_chat_message(user_message, history)
    except Exception as exc:
        return error_response(f"Chat failed: {exc}", 500)

    response_text = os.linesep.join(
        [s for s in response_text.splitlines() if s.strip() != ""]
    )

    payload = {"assistantResponseText": response_text}

    if speak:
        try:
            speech = text_to_speech(response_text, voice)
            payload["assistantResponseSpeech"] = base64.b64encode(speech).decode("utf-8")
        except Exception as exc:
            payload["speechError"] = str(exc)

    return jsonify(payload)


# ---------------------------------------------------------------------------
# Document analysis
# ---------------------------------------------------------------------------

@app.route("/analyze-document", methods=["POST"])
def analyze_document_route():
    if "file" not in request.files:
        return error_response("No file uploaded.")

    file = request.files["file"]
    filename = file.filename or "document"
    extension = get_extension(filename)

    if extension not in ALLOWED_DOCUMENT_EXTENSIONS:
        return error_response(
            f"Unsupported file type '{extension}'. "
            f"Supported: {', '.join(sorted(ALLOWED_DOCUMENT_EXTENSIONS))}"
        )

    question = request.form.get("question", "").strip() or None
    file_bytes = file.read()

    try:
        result = analyze_document(file_bytes, filename, question)
    except Exception as exc:
        return error_response(f"Document analysis failed: {exc}", 500)

    return jsonify({
        "filename": filename,
        "excerpt": result["text_excerpt"],
        "answer": result["answer"],
    })


# ---------------------------------------------------------------------------
# Image analysis & captioning
# ---------------------------------------------------------------------------

@app.route("/analyze-image", methods=["POST"])
def analyze_image_route():
    if "file" not in request.files:
        return error_response("No file uploaded.")

    file = request.files["file"]
    filename = file.filename or "image"
    extension = get_extension(filename)

    if extension not in ALLOWED_IMAGE_EXTENSIONS:
        return error_response(
            f"Unsupported image type '{extension}'. "
            f"Supported: {', '.join(sorted(ALLOWED_IMAGE_EXTENSIONS))}"
        )

    mode = request.form.get("mode", "analyze")
    question = request.form.get("question", "").strip() or None
    mime_type = IMAGE_MIME_TYPES.get(extension, "image/png")
    image_bytes = file.read()

    try:
        result = analyze_image(image_bytes, mime_type, mode, question)
    except Exception as exc:
        return error_response(f"Image analysis failed: {exc}", 500)

    return jsonify({"filename": filename, "result": result})


# ---------------------------------------------------------------------------
# Translation
# ---------------------------------------------------------------------------

@app.route("/translate", methods=["POST"])
def translate_route():
    data = request.json or {}
    text = data.get("text", "").strip()
    target_language = data.get("targetLanguage", "")
    source_language = data.get("sourceLanguage", "")
    speak = data.get("speak", False)
    voice = data.get("voice", "")

    if not text:
        return error_response("No text provided.")
    if not target_language:
        return error_response("No target language provided.")

    try:
        translated = translate_text(text, target_language, source_language)
    except Exception as exc:
        return error_response(f"Translation failed: {exc}", 500)

    payload = {"translatedText": translated}

    if speak:
        try:
            speech = text_to_speech(translated, voice)
            payload["speech"] = base64.b64encode(speech).decode("utf-8")
        except Exception as exc:
            payload["speechError"] = str(exc)

    return jsonify(payload)


@app.errorhandler(413)
def handle_file_too_large(_exc):
    return error_response(
        f"File is too large. Max size is {MAX_UPLOAD_MB}MB.", 413
    )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000, debug=True)
