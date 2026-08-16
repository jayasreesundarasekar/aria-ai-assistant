"""
AI logic layer for the assistant.

Every function here wraps a real Groq API call (chat, whisper, orpheus tts,
vision). Requires the GROQ_API_KEY environment variable to be set.
"""
import base64
import io
import os

from groq import Groq
from pypdf import PdfReader
from docx import Document

groq_client = Groq()

CHAT_MODEL = "llama-3.3-70b-versatile"
VISION_MODEL = "qwen/qwen3.6-27b"
TTS_MODEL = "canopylabs/orpheus-v1-english"
STT_MODEL = "whisper-large-v3-turbo"

ASSISTANT_SYSTEM_PROMPT = (
    "You are Aria, a warm, sharp personal assistant. You can chat, answer "
    "questions, summarize, and reason things through. Keep replies "
    "conversational and concise (2-4 sentences) unless the user is asking "
    "for something detailed like a list or explanation, in which case use "
    "clear short paragraphs or bullet points."
)

# Orpheus (English) voices hosted on Groq
VOICE_MAP = {
    "": "hannah",
    "default": "hannah",
    "hannah": "hannah",
    "autumn": "autumn",
    "diana": "diana",
    "austin": "austin",
    "daniel": "daniel",
    "troy": "troy",
}


# ---------------------------------------------------------------------------
# Speech <-> Text
# ---------------------------------------------------------------------------

def speech_to_text(audio_binary, filename="audio.webm"):
    """Transcribe raw audio bytes to text using Whisper on Groq."""
    if not audio_binary:
        return ""

    transcript = groq_client.audio.transcriptions.create(
        model=STT_MODEL,
        file=(filename, audio_binary),
    )

    return (transcript.text or "").strip()


def text_to_speech(text, voice=""):
    """Synthesize speech audio (wav bytes) from text using Orpheus on Groq."""
    if not text:
        return b""

    resolved_voice = VOICE_MAP.get(voice, "hannah")

    response = groq_client.audio.speech.create(
        model=TTS_MODEL,
        voice=resolved_voice,
        input=text,
        response_format="wav",
    )

    return response.read()


# ---------------------------------------------------------------------------
# Chat
# ---------------------------------------------------------------------------

def process_chat_message(user_message, history=None):
    """Continue a conversation. `history` is a list of {role, content} dicts."""
    messages = [{"role": "system", "content": ASSISTANT_SYSTEM_PROMPT}]

    if history:
        messages.extend(history[-12:])  # keep recent context bounded

    messages.append({"role": "user", "content": user_message})

    response = groq_client.chat.completions.create(
        model=CHAT_MODEL,
        messages=messages,
        max_tokens=700,
        temperature=0.7,
    )

    return response.choices[0].message.content.strip()


# ---------------------------------------------------------------------------
# Document analysis
# ---------------------------------------------------------------------------

def extract_document_text(file_bytes, filename):
    """Pull raw text out of a pdf / docx / txt file."""
    lower = filename.lower()

    if lower.endswith(".pdf"):
        reader = PdfReader(io.BytesIO(file_bytes))
        pages = [page.extract_text() or "" for page in reader.pages]
        return "\n\n".join(pages).strip()

    if lower.endswith(".docx"):
        doc = Document(io.BytesIO(file_bytes))
        paragraphs = [p.text for p in doc.paragraphs]
        return "\n".join(paragraphs).strip()

    # Fall back: treat as plain text
    try:
        return file_bytes.decode("utf-8", errors="ignore").strip()
    except Exception:
        return ""


def analyze_document(file_bytes, filename, question=None):
    """Summarize a document, or answer a question about it if provided."""
    text = extract_document_text(file_bytes, filename)

    if not text:
        return {
            "text_excerpt": "",
            "answer": (
                "I couldn't extract any readable text from that file. "
                "It may be a scanned/image-only document."
            ),
        }

    # Keep prompt bounded for very large documents
    truncated = text[:18000]

    if question:
        prompt = (
            f"Here is the content of a document named '{filename}':\n\n"
            f"{truncated}\n\n"
            f"Answer this question about the document as accurately as "
            f"possible, citing specific details where relevant:\n{question}"
        )
    else:
        prompt = (
            f"Here is the content of a document named '{filename}':\n\n"
            f"{truncated}\n\n"
            "Give a clear, well-structured summary: a 2-3 sentence overview, "
            "then key points as bullets, then anything notable (dates, "
            "numbers, action items) if present."
        )

    response = groq_client.chat.completions.create(
        model=CHAT_MODEL,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a precise document analyst. Base answers only "
                    "on the provided document text. If the answer isn't in "
                    "the document, say so clearly."
                ),
            },
            {"role": "user", "content": prompt},
        ],
        max_tokens=900,
        temperature=0.3,
    )

    return {
        "text_excerpt": truncated[:600],
        "answer": response.choices[0].message.content.strip(),
    }


# ---------------------------------------------------------------------------
# Image analysis & captioning
# ---------------------------------------------------------------------------

def analyze_image(image_bytes, mime_type, mode="analyze", question=None):
    """Caption or analyze an image using a vision-capable model."""
    b64_image = base64.b64encode(image_bytes).decode("utf-8")
    data_url = f"data:{mime_type};base64,{b64_image}"

    if mode == "caption":
        instruction = (
            "Write one vivid, natural single-sentence caption for this "
            "image, the way a good alt-text or photo caption would read. "
            "No preamble, just the caption."
        )
    elif question:
        instruction = (
            f"Look closely at this image and answer the question: {question}"
        )
    else:
        instruction = (
            "Analyze this image in detail: describe the scene, notable "
            "objects, people (generically, not identifying anyone), colors, "
            "mood, and any visible text. Structure it as short labeled "
            "sections (Scene, Details, Text) if there's enough to say."
        )

    response = groq_client.chat.completions.create(
        model=VISION_MODEL,
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": instruction},
                    {"type": "image_url", "image_url": {"url": data_url}},
                ],
            }
        ],
        max_tokens=600,
    )

    return response.choices[0].message.content.strip()


# ---------------------------------------------------------------------------
# Translation
# ---------------------------------------------------------------------------

def translate_text(text, target_language, source_language=None):
    if not text:
        return ""

    source_clause = (
        f"from {source_language} "
        if source_language and source_language != "Auto-detect"
        else ""
    )

    response = groq_client.chat.completions.create(
        model=CHAT_MODEL,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a professional translator. Translate exactly "
                    "what is given, preserving tone and meaning. Return "
                    "ONLY the translation, nothing else - no notes, no "
                    "quotation marks, no explanations."
                ),
            },
            {
                "role": "user",
                "content": f"Translate the following text {source_clause}into "
                f"{target_language}:\n\n{text}",
            },
        ],
        max_tokens=800,
        temperature=0.3,
    )

    return response.choices[0].message.content.strip()
