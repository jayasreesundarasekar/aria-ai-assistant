const baseUrl = window.location.origin;

const LANGUAGES = [
  "Arabic", "Bengali", "Chinese (Simplified)", "Chinese (Traditional)",
  "Dutch", "English", "French", "German", "Greek", "Gujarati", "Hebrew",
  "Hindi", "Indonesian", "Italian", "Japanese", "Kannada", "Korean",
  "Malayalam", "Marathi", "Polish", "Portuguese", "Punjabi", "Russian",
  "Spanish", "Swedish", "Tamil", "Telugu", "Thai", "Turkish", "Ukrainian",
  "Urdu", "Vietnamese",
];

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const escapeHtml = (str) =>
  str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

// Very small markdown-ish renderer: bullets + bold + line breaks
function renderRichText(text) {
  const escaped = escapeHtml(text);
  const withBold = escaped.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  const lines = withBold.split("\n");

  let html = "";
  let inList = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^[-*]\s+/.test(trimmed)) {
      if (!inList) {
        html += "<ul>";
        inList = true;
      }
      html += `<li>${trimmed.replace(/^[-*]\s+/, "")}</li>`;
    } else {
      if (inList) {
        html += "</ul>";
        inList = false;
      }
      if (trimmed) html += `<p>${trimmed}</p>`;
    }
  }
  if (inList) html += "</ul>";
  return html || `<p>${withBold}</p>`;
}

let toastTimer = null;
function showToast(message, isError = false) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.toggle("is-error", isError);
  toast.hidden = false;
  requestAnimationFrame(() => toast.classList.add("is-visible"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove("is-visible");
    setTimeout(() => (toast.hidden = true), 200);
  }, 3200);
}

async function postJSON(path, body) {
  const response = await fetch(baseUrl + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

async function postForm(path, formData) {
  const response = await fetch(baseUrl + path, { method: "POST", body: formData });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function playBase64Audio(base64, mime = "audio/wav") {
  if (!base64) return null;
  const audio = new Audio(`data:${mime};base64,${base64}`);
  audio.play().catch(() => {});
  return audio;
}

// ---------------------------------------------------------------------------
// Theme toggle
// ---------------------------------------------------------------------------

function initTheme() {
  const stored = localStorage.getItem("aria-theme");
  const prefersLight = window.matchMedia("(prefers-color-scheme: light)").matches;
  const isLight = stored ? stored === "light" : prefersLight;

  document.body.classList.toggle("light", isLight);
  updateThemeIcon(isLight);

  $("#theme-toggle").addEventListener("click", () => {
    const nowLight = !document.body.classList.contains("light");
    document.body.classList.toggle("light", nowLight);
    localStorage.setItem("aria-theme", nowLight ? "light" : "dark");
    updateThemeIcon(nowLight);
  });
}

function updateThemeIcon(isLight) {
  const icon = $("#theme-toggle i");
  icon.className = isLight ? "fa fa-moon-o" : "fa fa-sun-o";
}

// ---------------------------------------------------------------------------
// Panel navigation
// ---------------------------------------------------------------------------

function initNav() {
  $$(".rail-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.panel;

      $$(".rail-item").forEach((b) => {
        b.classList.toggle("is-active", b === btn);
        b.setAttribute("aria-selected", b === btn ? "true" : "false");
      });

      $$(".panel").forEach((panel) => {
        panel.classList.toggle("is-active", panel.id === `panel-${target}`);
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Shared audio recording helper (used by chat mic + translate mic)
// ---------------------------------------------------------------------------

function createRecorder() {
  let mediaRecorder = null;
  let chunks = [];
  let stream = null;

  return {
    async start() {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks = [];
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.addEventListener("dataavailable", (e) => chunks.push(e.data));
      mediaRecorder.start();
    },
    stop() {
      return new Promise((resolve) => {
        mediaRecorder.addEventListener("stop", () => {
          const blob = new Blob(chunks, { type: "audio/webm" });
          stream.getTracks().forEach((t) => t.stop());
          resolve(blob);
        });
        mediaRecorder.stop();
      });
    },
  };
}

async function transcribeBlob(blob) {
  const response = await fetch(baseUrl + "/speech-to-text", {
    method: "POST",
    body: blob,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Transcription failed");
  return data.text;
}

// ---------------------------------------------------------------------------
// Chat panel
// ---------------------------------------------------------------------------

function initChat() {
  const chatWindow = $("#chat-window");
  const chatEmpty = $("#chat-empty");
  const messageList = $("#message-list");
  const messageInput = $("#message-input");
  const chatForm = $("#chat-form");
  const sendButton = $("#send-button");
  const micButton = $("#mic-button");
  const typingIndicator = $("#typing-indicator");
  const voiceSelect = $("#voice-options");

  const history = [];
  let recorder = null;
  let recording = false;

  function scrollToBottom() {
    chatWindow.scrollTop = chatWindow.scrollHeight;
  }

  function addUserMessage(text) {
    chatEmpty.style.display = "none";
    const row = document.createElement("div");
    row.className = "message-row from-user";
    row.innerHTML = `<div class="bubble bubble-user">${escapeHtml(text)}</div>`;
    messageList.appendChild(row);
    scrollToBottom();
  }

  function addBotMessage(text, audioBase64) {
    const row = document.createElement("div");
    row.className = "message-row from-bot";
    const bubble = document.createElement("div");
    bubble.className = "bubble bubble-bot";
    bubble.innerHTML = renderRichText(text);

    if (audioBase64) {
      const actions = document.createElement("div");
      actions.className = "bubble-actions";
      const playBtn = document.createElement("button");
      playBtn.className = "bubble-play";
      playBtn.innerHTML = '<i class="fa fa-volume-up"></i> Replay';
      playBtn.addEventListener("click", () => playBase64Audio(audioBase64));
      actions.appendChild(playBtn);
      bubble.appendChild(actions);
    }

    row.appendChild(bubble);
    messageList.appendChild(row);
    scrollToBottom();
  }

  async function sendMessage(text) {
    if (!text.trim()) return;

    addUserMessage(text);
    history.push({ role: "user", content: text });
    messageInput.value = "";
    updateSendButtonState();

    typingIndicator.hidden = false;
    scrollToBottom();

    try {
      const data = await postJSON("/process-message", {
        userMessage: text,
        voice: voiceSelect.value,
        history: history.slice(0, -1),
        speak: true,
      });

      typingIndicator.hidden = true;
      addBotMessage(data.assistantResponseText, data.assistantResponseSpeech);
      history.push({ role: "assistant", content: data.assistantResponseText });

      if (data.assistantResponseSpeech) {
        playBase64Audio(data.assistantResponseSpeech);
      }
    } catch (err) {
      typingIndicator.hidden = true;
      showToast(err.message || "Something went wrong.", true);
    }
  }

  function updateSendButtonState() {
    sendButton.disabled = messageInput.value.trim().length === 0;
  }

  messageInput.addEventListener("input", updateSendButtonState);
  updateSendButtonState();

  chatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    sendMessage(messageInput.value);
  });

  micButton.addEventListener("click", async () => {
    if (!recording) {
      try {
        recorder = createRecorder();
        await recorder.start();
        recording = true;
        micButton.classList.add("is-recording");
      } catch (err) {
        showToast("Microphone access was denied.", true);
      }
      return;
    }

    recording = false;
    micButton.classList.remove("is-recording");
    const blob = await recorder.stop();

    try {
      typingIndicator.hidden = false;
      const text = await transcribeBlob(blob);
      typingIndicator.hidden = true;
      if (text) {
        sendMessage(text);
      } else {
        showToast("Couldn't catch that — try again.", true);
      }
    } catch (err) {
      typingIndicator.hidden = true;
      showToast(err.message || "Transcription failed.", true);
    }
  });
}

// ---------------------------------------------------------------------------
// Documents panel
// ---------------------------------------------------------------------------

function initDocuments() {
  const dropzone = $("#doc-dropzone");
  const input = $("#doc-input");
  const fileNameTag = $("#doc-file-name");
  const submitBtn = $("#doc-submit");
  const questionInput = $("#doc-question");
  const resultCard = $("#doc-result");
  const resultFilename = $("#doc-result-filename");
  const resultBody = $("#doc-result-body");

  let selectedFile = null;

  function setFile(file) {
    selectedFile = file;
    fileNameTag.hidden = false;
    fileNameTag.innerHTML = `<i class="fa fa-file-o"></i> ${escapeHtml(file.name)}`;
    submitBtn.disabled = false;
  }

  dropzone.addEventListener("click", () => input.click());
  dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") input.click();
  });

  input.addEventListener("change", () => {
    if (input.files[0]) setFile(input.files[0]);
  });

  ["dragover", "dragenter"].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add("is-dragover");
    })
  );
  ["dragleave", "drop"].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove("is-dragover");
    })
  );
  dropzone.addEventListener("drop", (e) => {
    const file = e.dataTransfer.files[0];
    if (file) setFile(file);
  });

  submitBtn.addEventListener("click", async () => {
    if (!selectedFile) return;

    const formData = new FormData();
    formData.append("file", selectedFile);
    formData.append("question", questionInput.value.trim());

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> <span>Analyzing…</span>';

    try {
      const data = await postForm("/analyze-document", formData);
      resultFilename.textContent = data.filename;
      resultBody.innerHTML = renderRichText(data.answer);
      resultCard.hidden = false;
      resultCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (err) {
      showToast(err.message || "Document analysis failed.", true);
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="fa fa-magic"></i> <span>Analyze document</span>';
    }
  });
}

// ---------------------------------------------------------------------------
// Image panel
// ---------------------------------------------------------------------------

function initImage() {
  const dropzone = $("#img-dropzone");
  const input = $("#img-input");
  const preview = $("#img-preview");
  const emptyState = $("#img-dropzone-empty");
  const submitBtn = $("#img-submit");
  const modeGroup = $("#img-mode");
  const questionRow = $("#img-question-row");
  const questionInput = $("#img-question");
  const resultCard = $("#img-result");
  const resultFilename = $("#img-result-filename");
  const resultBody = $("#img-result-body");

  let selectedFile = null;
  let mode = "caption";

  function setFile(file) {
    selectedFile = file;
    const url = URL.createObjectURL(file);
    preview.src = url;
    preview.hidden = false;
    emptyState.style.display = "none";
    submitBtn.disabled = false;
  }

  dropzone.addEventListener("click", (e) => {
    if (e.target === preview) return;
    input.click();
  });
  dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") input.click();
  });

  input.addEventListener("change", () => {
    if (input.files[0]) setFile(input.files[0]);
  });

  ["dragover", "dragenter"].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add("is-dragover");
    })
  );
  ["dragleave", "drop"].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove("is-dragover");
    })
  );
  dropzone.addEventListener("drop", (e) => {
    const file = e.dataTransfer.files[0];
    if (file) setFile(file);
  });

  $$(".segmented-item", modeGroup).forEach((btn) => {
    btn.addEventListener("click", () => {
      mode = btn.dataset.mode;
      $$(".segmented-item", modeGroup).forEach((b) => {
        b.classList.toggle("is-active", b === btn);
        b.setAttribute("aria-checked", b === btn ? "true" : "false");
      });
      questionRow.hidden = mode !== "question";
    });
  });

  submitBtn.addEventListener("click", async () => {
    if (!selectedFile) return;

    const formData = new FormData();
    formData.append("file", selectedFile);
    formData.append("mode", mode === "question" ? "analyze" : mode);
    if (mode === "question") formData.append("question", questionInput.value.trim());

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> <span>Looking…</span>';

    try {
      const data = await postForm("/analyze-image", formData);
      resultFilename.textContent = data.filename;
      resultBody.innerHTML = renderRichText(data.result);
      resultCard.hidden = false;
      resultCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (err) {
      showToast(err.message || "Image analysis failed.", true);
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="fa fa-eye"></i> <span>Analyze image</span>';
    }
  });
}

// ---------------------------------------------------------------------------
// Translate panel
// ---------------------------------------------------------------------------

function initTranslate() {
  const sourceLangSelect = $("#source-lang");
  const targetLangSelect = $("#target-lang");
  const sourceText = $("#source-text");
  const targetText = $("#target-text");
  const charCount = $("#source-char-count");
  const submitBtn = $("#translate-submit");
  const swapBtn = $("#swap-langs");
  const micBtn = $("#translate-mic");
  const speakBtn = $("#translate-speak");
  const copyBtn = $("#copy-translation");

  LANGUAGES.forEach((lang) => {
    const opt1 = document.createElement("option");
    opt1.textContent = lang;
    sourceLangSelect.appendChild(opt1);
  });
  LANGUAGES.forEach((lang) => {
    const opt = document.createElement("option");
    opt.textContent = lang;
    if (lang === "Spanish") opt.selected = true;
    targetLangSelect.appendChild(opt);
  });

  let recorder = null;
  let recording = false;
  let lastSpeech = null;

  function updateSubmitState() {
    submitBtn.disabled = sourceText.value.trim().length === 0;
  }

  sourceText.addEventListener("input", () => {
    charCount.textContent = sourceText.value.length;
    updateSubmitState();
  });
  updateSubmitState();

  swapBtn.addEventListener("click", () => {
    if (sourceLangSelect.value === "Auto-detect") return;
    const sVal = sourceLangSelect.value;
    const tVal = targetLangSelect.value;

    if ([...sourceLangSelect.options].some((o) => o.value === tVal)) {
      sourceLangSelect.value = tVal;
    }
    targetLangSelect.value = sVal;

    const tmp = sourceText.value;
    sourceText.value = targetText.value;
    targetText.value = tmp;
    charCount.textContent = sourceText.value.length;
    updateSubmitState();
  });

  submitBtn.addEventListener("click", async () => {
    const text = sourceText.value.trim();
    if (!text) return;

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> <span>Translating…</span>';

    try {
      const data = await postJSON("/translate", {
        text,
        sourceLanguage: sourceLangSelect.value,
        targetLanguage: targetLangSelect.value,
        speak: false,
      });
      targetText.value = data.translatedText;
      speakBtn.disabled = false;
      copyBtn.disabled = false;
      lastSpeech = null;
    } catch (err) {
      showToast(err.message || "Translation failed.", true);
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="fa fa-language"></i> <span>Translate</span>';
      updateSubmitState();
    }
  });

  speakBtn.addEventListener("click", async () => {
    if (!targetText.value.trim()) return;

    if (lastSpeech) {
      playBase64Audio(lastSpeech);
      return;
    }

    speakBtn.disabled = true;
    speakBtn.innerHTML = '<i class="fa fa-spinner fa-spin"></i>';
    try {
      const data = await postJSON("/text-to-speech", { text: targetText.value, voice: "hannah" });
      lastSpeech = data.audio;
      playBase64Audio(lastSpeech);
    } catch (err) {
      showToast(err.message || "Couldn't generate audio.", true);
    } finally {
      speakBtn.disabled = false;
      speakBtn.innerHTML = '<i class="fa fa-volume-up"></i>';
    }
  });

  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(targetText.value);
      showToast("Copied to clipboard.");
    } catch {
      showToast("Couldn't copy — select and copy manually.", true);
    }
  });

  micBtn.addEventListener("click", async () => {
    if (!recording) {
      try {
        recorder = createRecorder();
        await recorder.start();
        recording = true;
        micBtn.classList.add("is-active");
      } catch {
        showToast("Microphone access was denied.", true);
      }
      return;
    }

    recording = false;
    micBtn.classList.remove("is-active");
    const blob = await recorder.stop();

    try {
      const text = await transcribeBlob(blob);
      if (text) {
        sourceText.value = (sourceText.value ? sourceText.value + " " : "") + text;
        charCount.textContent = sourceText.value.length;
        updateSubmitState();
      }
    } catch (err) {
      showToast(err.message || "Transcription failed.", true);
    }
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  initNav();
  initChat();
  initDocuments();
  initImage();
  initTranslate();
});
