import { APP_CONFIG } from "./config.js";
import { DEMO_CATEGORIES, DEMO_QUESTIONS } from "./demo-data.js";
import { getSupabase, isSupabaseConfigured } from "./supabase-client.js";
import { escapeHtml, formatDuration, isAnswerCorrect, setupTheme, shuffle } from "./utils.js";

const TYPE_LABELS = {
  mixed: "مختلط",
  mcq: "اختيار متعدد",
  true_false: "صح وخطأ",
  fill: "إكمال فراغ",
  text: "كتابة"
};
const DIFFICULTY_LABELS = { easy: "سهل", medium: "متوسط", hard: "صعب", trainer: "المدرب", all: "جميع المستويات" };

const state = {
  supabase: null,
  categories: [],
  availableQuestions: [],
  quizQuestions: [],
  answers: {},
  currentIndex: 0,
  participant: null,
  settings: null,
  startedAt: null,
  elapsedSeconds: 0,
  timerId: null,
  result: null
};

const elements = {
  views: [...document.querySelectorAll(".view")],
  themeToggle: document.querySelector("#themeToggle"),
  connectionStatus: document.querySelector("#connectionStatus"),
  openSetupBtn: document.querySelector("#openSetupBtn"),
  showPersonalBestBtn: document.querySelector("#showPersonalBestBtn"),
  personalBestDialog: document.querySelector("#personalBestDialog"),
  personalBestContent: document.querySelector("#personalBestContent"),
  setupForm: document.querySelector("#setupForm"),
  categoryGrid: document.querySelector("#categoryGrid"),
  setupMessage: document.querySelector("#setupMessage"),
  quizSectionLabel: document.querySelector("#quizSectionLabel"),
  quizSectionTitle: document.querySelector("#quizSectionTitle"),
  timerText: document.querySelector("#timerText"),
  questionCounter: document.querySelector("#questionCounter"),
  progressBar: document.querySelector("#progressBar"),
  questionTypeBadge: document.querySelector("#questionTypeBadge"),
  questionDifficultyBadge: document.querySelector("#questionDifficultyBadge"),
  questionPrompt: document.querySelector("#questionPrompt"),
  answerArea: document.querySelector("#answerArea"),
  answerMessage: document.querySelector("#answerMessage"),
  previousQuestionBtn: document.querySelector("#previousQuestionBtn"),
  nextQuestionBtn: document.querySelector("#nextQuestionBtn"),
  finishQuizBtn: document.querySelector("#finishQuizBtn"),
  confirmDialog: document.querySelector("#confirmDialog"),
  scoreRing: document.querySelector("#scoreRing"),
  scoreValue: document.querySelector("#scoreValue"),
  resultMessage: document.querySelector("#resultMessage"),
  resultDetails: document.querySelector("#resultDetails"),
  correctCount: document.querySelector("#correctCount"),
  wrongCount: document.querySelector("#wrongCount"),
  durationText: document.querySelector("#durationText"),
  retryBtn: document.querySelector("#retryBtn"),
  reviewToggleBtn: document.querySelector("#reviewToggleBtn"),
  printResultBtn: document.querySelector("#printResultBtn"),
  reviewSection: document.querySelector("#reviewSection"),
  reviewList: document.querySelector("#reviewList")
};

async function init() {
  setupTheme(elements.themeToggle);
  bindEvents();
  await loadData();
  renderCategories();
  restoreParticipantName();
  registerServiceWorker();
}

function bindEvents() {
  elements.openSetupBtn.addEventListener("click", () => showView("setupView"));
  document.querySelectorAll("[data-go-home]").forEach((button) => button.addEventListener("click", () => showView("homeView")));
  elements.setupForm.addEventListener("submit", startQuiz);
  elements.previousQuestionBtn.addEventListener("click", () => navigateQuestion(-1));
  elements.nextQuestionBtn.addEventListener("click", () => navigateQuestion(1));
  elements.finishQuizBtn.addEventListener("click", () => elements.confirmDialog.showModal());
  elements.confirmDialog.addEventListener("close", () => {
    if (elements.confirmDialog.returnValue === "confirm") finishQuiz();
  });
  elements.retryBtn.addEventListener("click", resetToSetup);
  elements.reviewToggleBtn.addEventListener("click", () => {
    elements.reviewSection.classList.toggle("hidden");
    elements.reviewToggleBtn.textContent = elements.reviewSection.classList.contains("hidden") ? "مراجعة الإجابات" : "إخفاء المراجعة";
  });
  elements.printResultBtn.addEventListener("click", () => window.print());
  elements.showPersonalBestBtn.addEventListener("click", showPersonalBest);
  window.addEventListener("beforeunload", (event) => {
    if (state.quizQuestions.length && !state.result) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
}

async function loadData() {
  try {
    state.supabase = await getSupabase();
    if (!state.supabase) throw new Error("demo");

    const [{ data: categories, error: categoriesError }, { data: questions, error: questionsError }] = await Promise.all([
      state.supabase.from("categories").select("*").eq("active", true).order("sort_order", { ascending: true }),
      state.supabase.from("questions").select("*, category:categories(*)").eq("active", true)
    ]);
    if (categoriesError) throw categoriesError;
    if (questionsError) throw questionsError;

    state.categories = categories || [];
    state.availableQuestions = questions || [];
    elements.connectionStatus.textContent = "● متصل بقاعدة البيانات — النتائج تُحفظ لدى المدير.";
    elements.connectionStatus.className = "status-line online";
  } catch (error) {
    state.supabase = null;
    state.categories = JSON.parse(localStorage.getItem("quiz-admin-categories") || "null") || DEMO_CATEGORIES;
    state.availableQuestions = JSON.parse(localStorage.getItem("quiz-admin-questions") || "null") || DEMO_QUESTIONS;
    elements.connectionStatus.textContent = isSupabaseConfigured()
      ? "تم تحميل بنك الأسئلة الأساسي. تحقق من إعدادات الاتصال عند الحاجة."
      : "بنك الأسئلة جاهز للاستخدام.";
    elements.connectionStatus.className = "status-line demo";
  }
}

function renderCategories() {
  const allCategory = {
    slug: "all",
    name: "اختبار شامل",
    description: "أسئلة عشوائية من جميع الأقسام المتاحة.",
    icon: "🎲"
  };
  const categories = [allCategory, ...state.categories.filter((category) => category.active !== false)];
  elements.categoryGrid.innerHTML = categories.map((category, index) => `
    <label class="category-choice">
      <input type="radio" name="category" value="${escapeHtml(category.slug)}" ${index === 0 ? "checked" : ""}>
      <span>
        <b class="category-icon">${escapeHtml(category.icon || "📚")}</b>
        <b class="category-copy"><strong>${escapeHtml(category.name)}</strong><small>${escapeHtml(category.description || "")}</small></b>
      </span>
    </label>
  `).join("");
}

function restoreParticipantName() {
  const savedName = localStorage.getItem("quiz-participant-name");
  if (savedName) document.querySelector("#participantName").value = savedName;
}

function showView(id) {
  elements.views.forEach((view) => view.classList.toggle("active", view.id === id));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function startQuiz(event) {
  event.preventDefault();
  elements.setupMessage.textContent = "";
  const formData = new FormData(elements.setupForm);
  const participantName = String(formData.get("participantName") || "").trim();
  const categorySlug = String(formData.get("category") || "all");
  const questionType = String(formData.get("questionType") || "mixed");
  const difficulty = String(formData.get("difficulty") || "all");
  const countSetting = String(formData.get("questionCount") || "20");

  if (participantName.length < 2) {
    elements.setupMessage.textContent = "اكتب الاسم الكامل قبل بدء الاختبار.";
    document.querySelector("#participantName").focus();
    return;
  }
  if (formData.get("privacyConsent") !== "on") {
    elements.setupMessage.textContent = "يجب الموافقة على حفظ الاسم والنتيجة قبل بدء الاختبار.";
    return;
  }

  let pool = state.availableQuestions.filter((question) => question.active !== false);
  if (categorySlug !== "all") pool = pool.filter((question) => question.category?.slug === categorySlug || categoryIdToSlug(question.category_id) === categorySlug);
  if (questionType !== "mixed") pool = pool.filter((question) => question.type === questionType);
  if (difficulty !== "all") pool = pool.filter((question) => question.difficulty === difficulty);

  if (!pool.length) {
    elements.setupMessage.textContent = "لا توجد أسئلة مطابقة لهذه الإعدادات. اختر قسمًا أو نوعًا آخر، أو أضف أسئلة من لوحة المدير.";
    return;
  }

  const requestedCount = countSetting === "all" ? pool.length : Number(countSetting);
  const selectedQuestions = shuffle(pool).slice(0, Math.min(requestedCount, pool.length)).map((question) => ({
    ...question,
    options: question.type === "mcq" ? shuffle(question.options || []) : (question.options || [])
  }));

  state.participant = {
    name: participantName,
    rank: String(formData.get("participantRank") || "").trim(),
    unit: String(formData.get("participantUnit") || "").trim()
  };
  state.settings = { categorySlug, questionType, difficulty, requestedCount };
  state.quizQuestions = selectedQuestions;
  state.answers = {};
  state.currentIndex = 0;
  state.startedAt = Date.now();
  state.elapsedSeconds = 0;
  state.result = null;
  localStorage.setItem("quiz-participant-name", participantName);

  startTimer();
  renderQuestion();
  showView("quizView");
}

function categoryIdToSlug(categoryId) {
  return state.categories.find((category) => category.id === categoryId)?.slug;
}

function startTimer() {
  clearInterval(state.timerId);
  elements.timerText.textContent = "00:00";
  state.timerId = window.setInterval(() => {
    state.elapsedSeconds = Math.floor((Date.now() - state.startedAt) / 1000);
    elements.timerText.textContent = formatDuration(state.elapsedSeconds);
  }, 1000);
}

function renderQuestion() {
  const question = state.quizQuestions[state.currentIndex];
  if (!question) return;
  const categoryName = question.category?.name || state.categories.find((item) => item.id === question.category_id)?.name || "القسم";

  elements.quizSectionLabel.textContent = state.settings.categorySlug === "all" ? "اختبار شامل" : categoryName;
  elements.quizSectionTitle.textContent = `اختبار ${state.participant.name}`;
  elements.questionCounter.textContent = `${state.currentIndex + 1} / ${state.quizQuestions.length}`;
  elements.progressBar.style.width = `${((state.currentIndex + 1) / state.quizQuestions.length) * 100}%`;
  elements.questionTypeBadge.textContent = TYPE_LABELS[question.type] || question.type;
  elements.questionDifficultyBadge.textContent = DIFFICULTY_LABELS[question.difficulty] || question.difficulty;
  elements.questionPrompt.textContent = question.prompt;
  elements.answerMessage.textContent = "";
  renderAnswerInput(question);

  elements.previousQuestionBtn.disabled = state.currentIndex === 0;
  const isLast = state.currentIndex === state.quizQuestions.length - 1;
  elements.nextQuestionBtn.classList.toggle("hidden", isLast);
  elements.finishQuizBtn.classList.toggle("hidden", !isLast);
}

function renderAnswerInput(question) {
  const savedAnswer = state.answers[question.id] ?? "";

  if (question.type === "mcq" || question.type === "true_false") {
    const options = question.type === "true_false" ? ["صح", "خطأ"] : (question.options || []);
    elements.answerArea.innerHTML = options.map((option) => `
      <label class="answer-option">
        <input type="radio" name="currentAnswer" value="${escapeHtml(option)}" ${savedAnswer === option ? "checked" : ""}>
        <span>${escapeHtml(option)}</span>
      </label>
    `).join("");
    elements.answerArea.querySelectorAll("input").forEach((input) => input.addEventListener("change", () => saveCurrentAnswer(input.value)));
    return;
  }

  const isLong = question.type === "text";
  elements.answerArea.innerHTML = `
    ${isLong
      ? `<textarea id="writtenAnswer" class="answer-text" rows="5" placeholder="اكتب إجابتك هنا...">${escapeHtml(savedAnswer)}</textarea>`
      : `<input id="writtenAnswer" type="text" value="${escapeHtml(savedAnswer)}" placeholder="اكتب الإجابة...">`}
    <p class="answer-hint">يتم التصحيح آليًا بمقارنة إجابتك مع الصيغ المقبولة التي أدخلها المدير.</p>
  `;
  const input = elements.answerArea.querySelector("#writtenAnswer");
  input.addEventListener("input", () => saveCurrentAnswer(input.value));
  setTimeout(() => input.focus(), 50);
}

function saveCurrentAnswer(value) {
  const question = state.quizQuestions[state.currentIndex];
  state.answers[question.id] = value;
}

function navigateQuestion(direction) {
  const nextIndex = state.currentIndex + direction;
  if (nextIndex < 0 || nextIndex >= state.quizQuestions.length) return;
  state.currentIndex = nextIndex;
  renderQuestion();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function finishQuiz() {
  clearInterval(state.timerId);
  state.elapsedSeconds = Math.floor((Date.now() - state.startedAt) / 1000);

  const review = state.quizQuestions.map((question) => {
    const answer = state.answers[question.id] ?? "";
    const correct = isAnswerCorrect(answer, question.accepted_answers || []);
    return {
      question_id: question.id,
      prompt: question.prompt,
      category: question.category?.name || state.categories.find((item) => item.id === question.category_id)?.name || "—",
      type: question.type,
      answer,
      accepted_answers: question.accepted_answers || [],
      explanation: question.explanation || "",
      correct
    };
  });

  const correctCount = review.filter((item) => item.correct).length;
  const wrongCount = review.length - correctCount;
  const score = Math.round((correctCount / review.length) * 100);
  state.result = { review, correctCount, wrongCount, score };

  renderResults();
  savePersonalBest();
  await saveResult();
  showView("resultsView");
}

function renderResults() {
  const { score, correctCount, wrongCount, review } = state.result;
  elements.scoreValue.textContent = score;
  elements.correctCount.textContent = correctCount;
  elements.wrongCount.textContent = wrongCount;
  elements.durationText.textContent = formatDuration(state.elapsedSeconds);
  elements.scoreRing.style.borderColor = score >= 80 ? "var(--success)" : score >= 60 ? "var(--warning)" : "var(--danger)";

  const message = score >= 90 ? "ممتاز جدًا" : score >= 80 ? "أداء قوي" : score >= 60 ? "جيد، واصل المراجعة" : "تحتاج إلى مراجعة إضافية";
  elements.resultMessage.textContent = message;
  elements.resultDetails.textContent = `${state.participant.name}، أجبت بصورة صحيحة عن ${correctCount} من أصل ${review.length} سؤالًا.`;

  elements.reviewList.innerHTML = review.map((item, index) => `
    <article class="review-item ${item.correct ? "correct" : "wrong"}">
      <h3>${index + 1}. ${escapeHtml(item.prompt)}</h3>
      <div class="review-row"><span>الحالة</span><strong>${item.correct ? "✓ صحيحة" : "✕ خاطئة"}</strong></div>
      <div class="review-row"><span>إجابتك</span><strong>${escapeHtml(item.answer || "لم تتم الإجابة")}</strong></div>
      <div class="review-row"><span>الإجابة المقبولة</span><strong>${escapeHtml(item.accepted_answers.join(" — ") || "غير محددة")}</strong></div>
      ${item.explanation ? `<div class="review-explanation">${escapeHtml(item.explanation)}</div>` : ""}
    </article>
  `).join("");
  elements.reviewSection.classList.add("hidden");
  elements.reviewToggleBtn.textContent = "مراجعة الإجابات";
}

async function saveResult() {
  const payload = {
    participant_name: state.participant.name,
    participant_rank: state.participant.rank || null,
    participant_unit: state.participant.unit || null,
    category_slug: state.settings.categorySlug,
    question_type: state.settings.questionType,
    difficulty: state.settings.difficulty,
    question_count: state.quizQuestions.length,
    correct_count: state.result.correctCount,
    wrong_count: state.result.wrongCount,
    score: state.result.score,
    duration_seconds: state.elapsedSeconds,
    answers: state.result.review,
    user_agent: navigator.userAgent.slice(0, 500)
  };

  if (state.supabase) {
    const { error } = await state.supabase.from("results").insert(payload);
    if (error) console.error("تعذر حفظ النتيجة:", error.message);
    return;
  }

  const localResults = JSON.parse(localStorage.getItem("quiz-local-results") || "[]");
  localResults.unshift({ id: `result-${Date.now()}-${Math.random().toString(16).slice(2)}`, ...payload, created_at: new Date().toISOString() });
  localStorage.setItem("quiz-local-results", JSON.stringify(localResults.slice(0, 30)));
}

function savePersonalBest() {
  const current = {
    score: state.result.score,
    name: state.participant.name,
    category: state.settings.categorySlug,
    date: new Date().toISOString(),
    questionCount: state.quizQuestions.length,
    duration: state.elapsedSeconds
  };
  const best = JSON.parse(localStorage.getItem("quiz-personal-best") || "null");
  if (!best || current.score > best.score || (current.score === best.score && current.duration < best.duration)) {
    localStorage.setItem("quiz-personal-best", JSON.stringify(current));
  }
}

function showPersonalBest() {
  const best = JSON.parse(localStorage.getItem("quiz-personal-best") || "null");
  elements.personalBestContent.innerHTML = best
    ? `<div class="result-stats"><div><span>الدرجة</span><strong>${best.score}%</strong></div><div><span>الأسئلة</span><strong>${best.questionCount}</strong></div><div><span>الوقت</span><strong>${formatDuration(best.duration)}</strong></div></div><p style="margin-top:16px;color:var(--muted)">الاسم: ${escapeHtml(best.name)}<br>التاريخ: ${new Intl.DateTimeFormat("ar", { dateStyle: "medium", timeStyle: "short" }).format(new Date(best.date))}</p>`
    : `<p>لا توجد نتيجة محفوظة على هذا الجهاز حتى الآن.</p>`;
  elements.personalBestDialog.showModal();
}

function resetToSetup() {
  clearInterval(state.timerId);
  state.quizQuestions = [];
  state.answers = {};
  state.result = null;
  showView("setupView");
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  }
}

init();
