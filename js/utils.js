export function shuffle(items) {
  const output = [...items];
  for (let i = output.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [output[i], output[j]] = [output[j], output[i]];
  }
  return output;
}

export function normalizeArabic(value = "") {
  return String(value)
    .toLowerCase()
    .trim()
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[ـ]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isAnswerCorrect(answer, acceptedAnswers = []) {
  const normalizedAnswer = normalizeArabic(answer);
  if (!normalizedAnswer) return false;
  return acceptedAnswers.some((accepted) => {
    const target = normalizeArabic(accepted);
    if (!target) return false;
    if (normalizedAnswer === target) return true;
    const answerWords = normalizedAnswer.split(" ");
    const targetWords = target.split(" ");
    if (targetWords.length >= 3) {
      const matched = targetWords.filter((word) => answerWords.includes(word)).length;
      return matched / targetWords.length >= 0.84;
    }
    return false;
  });
}

export function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function formatDuration(totalSeconds = 0) {
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const seconds = Math.floor(totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function formatDate(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ar", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function downloadTextFile(filename, content, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function setupTheme(toggleButton) {
  const saved = localStorage.getItem("quiz-theme");
  const preferred = saved || (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  document.documentElement.dataset.theme = preferred;
  if (toggleButton) toggleButton.textContent = preferred === "dark" ? "☀" : "☾";

  toggleButton?.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("quiz-theme", next);
    toggleButton.textContent = next === "dark" ? "☀" : "☾";
  });
}
