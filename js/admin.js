import { getSupabase, isSupabaseConfigured } from "./supabase-client.js";
import { DEMO_CATEGORIES, DEMO_QUESTIONS } from "./demo-data.js";
import { downloadTextFile, escapeHtml, formatDate, formatDuration, setupTheme } from "./utils.js";

const TYPE_LABELS = { mcq: "اختيار متعدد", true_false: "صح وخطأ", fill: "إكمال فراغ", text: "كتابة" };
const DIFFICULTY_LABELS = { easy: "سهل", medium: "متوسط", hard: "صعب", trainer: "المدرب", all: "الكل" };

const state = {
  supabase: null,
  localMode: false,
  admin: null,
  categories: [],
  questions: [],
  results: [],
  pendingDelete: null
};

const LOCAL_KEYS = {
  password: "quiz-admin-password",
  categories: "quiz-admin-categories",
  questions: "quiz-admin-questions",
  site: "quiz-site-settings",
  session: "quiz-admin-session"
};

const $ = (selector) => document.querySelector(selector);
const elements = {
  themeToggle: $("#themeToggle"),
  loginView: $("#adminLoginView"), dashboardView: $("#adminDashboardView"), loginForm: $("#adminLoginForm"),
  loginMessage: $("#loginMessage"), logoutBtn: $("#logoutBtn"), adminName: $("#adminName"), refreshAdminBtn: $("#refreshAdminBtn"),
  questionsStat: $("#questionsStat"), resultsStat: $("#resultsStat"), averageStat: $("#averageStat"), todayStat: $("#todayStat"),
  tabs: [...document.querySelectorAll(".admin-tab")], tabPanels: [...document.querySelectorAll(".admin-tab-panel")],
  newQuestionBtn: $("#newQuestionBtn"), questionEditor: $("#questionEditor"), questionEditorTitle: $("#questionEditorTitle"), closeQuestionEditorBtn: $("#closeQuestionEditorBtn"), cancelQuestionBtn: $("#cancelQuestionBtn"),
  questionForm: $("#questionForm"), questionFormMessage: $("#questionFormMessage"), questionId: $("#questionId"), questionCategory: $("#questionCategory"), questionType: $("#questionType"), questionDifficulty: $("#questionDifficulty"), questionActive: $("#questionActive"), questionPromptInput: $("#questionPromptInput"), questionOptions: $("#questionOptions"), questionAnswers: $("#questionAnswers"), questionExplanation: $("#questionExplanation"), optionsField: $("#optionsField"),
  questionSearch: $("#questionSearch"), questionCategoryFilter: $("#questionCategoryFilter"), questionTypeFilter: $("#questionTypeFilter"), questionsTableWrap: $("#questionsTableWrap"),
  exportResultsBtn: $("#exportResultsBtn"), resultSearch: $("#resultSearch"), resultCategoryFilter: $("#resultCategoryFilter"), resultsTableWrap: $("#resultsTableWrap"),
  newCategoryBtn: $("#newCategoryBtn"), categoryEditor: $("#categoryEditor"), categoryEditorTitle: $("#categoryEditorTitle"), closeCategoryEditorBtn: $("#closeCategoryEditorBtn"), cancelCategoryBtn: $("#cancelCategoryBtn"), categoryForm: $("#categoryForm"), categoryFormMessage: $("#categoryFormMessage"), categoryId: $("#categoryId"), categoryName: $("#categoryName"), categorySlug: $("#categorySlug"), categoryIcon: $("#categoryIcon"), categoryOrder: $("#categoryOrder"), categoryDescription: $("#categoryDescription"), categoryActive: $("#categoryActive"), categoriesTableWrap: $("#categoriesTableWrap"),
  detailsDialog: $("#detailsDialog"), resultDetailsContent: $("#resultDetailsContent"), deleteDialog: $("#deleteDialog"), deleteDialogText: $("#deleteDialogText")
};

Object.assign(elements, {
  overviewCards: $("#overviewCards"), adminInsights: $("#adminInsights"),
  exportMembersBtn: $("#exportMembersBtn"), membersTableWrap: $("#membersTableWrap"),
  siteSettingsForm: $("#siteSettingsForm"), siteNameInput: $("#siteNameInput"), ownerNameInput: $("#ownerNameInput"), siteNoticeInput: $("#siteNoticeInput"), siteSettingsMessage: $("#siteSettingsMessage"),
  passwordForm: $("#passwordForm"), currentAdminPassword: $("#currentAdminPassword"), newAdminPassword: $("#newAdminPassword"), confirmAdminPassword: $("#confirmAdminPassword"), passwordMessage: $("#passwordMessage")
});

async function init() {
  setupTheme(elements.themeToggle);
  bindEvents();

  if (!isSupabaseConfigured()) {
    enableLocalMode();
    if (localStorage.getItem(LOCAL_KEYS.session) === "1") await openLocalDashboard();
    return;
  }

  try {
    state.supabase = await getSupabase();
    const { data: { session } } = await state.supabase.auth.getSession();
    if (session) await verifyAndOpenDashboard(session.user);
  } catch (error) {
    enableLocalMode();
    elements.loginMessage.textContent = `تعذر الاتصال بقاعدة البيانات. تم تفعيل الوضع المحلي.`;
  }
}

function bindEvents() {
  elements.loginForm.addEventListener("submit", login);
  elements.logoutBtn.addEventListener("click", logout);
  elements.refreshAdminBtn.addEventListener("click", loadDashboardData);
  elements.tabs.forEach((tab) => tab.addEventListener("click", () => switchTab(tab.dataset.tab)));

  elements.newQuestionBtn.addEventListener("click", () => openQuestionEditor());
  elements.closeQuestionEditorBtn.addEventListener("click", closeQuestionEditor);
  elements.cancelQuestionBtn.addEventListener("click", closeQuestionEditor);
  elements.questionForm.addEventListener("submit", saveQuestion);
  elements.questionType.addEventListener("change", toggleOptionsField);
  elements.questionSearch.addEventListener("input", renderQuestionsTable);
  elements.questionCategoryFilter.addEventListener("change", renderQuestionsTable);
  elements.questionTypeFilter.addEventListener("change", renderQuestionsTable);

  elements.exportResultsBtn.addEventListener("click", exportResults);
  elements.resultSearch.addEventListener("input", renderResultsTable);
  elements.resultCategoryFilter.addEventListener("change", renderResultsTable);

  elements.newCategoryBtn.addEventListener("click", () => openCategoryEditor());
  elements.closeCategoryEditorBtn.addEventListener("click", closeCategoryEditor);
  elements.cancelCategoryBtn.addEventListener("click", closeCategoryEditor);
  elements.categoryForm.addEventListener("submit", saveCategory);
  elements.exportMembersBtn?.addEventListener("click", exportMembers);
  elements.siteSettingsForm?.addEventListener("submit", saveSiteSettings);
  elements.passwordForm?.addEventListener("submit", changeLocalPassword);

  elements.deleteDialog.addEventListener("close", async () => {
    if (elements.deleteDialog.returnValue === "confirm" && state.pendingDelete) await executeDelete();
    state.pendingDelete = null;
  });
}

async function login(event) {
  event.preventDefault();
  elements.loginMessage.textContent = "جارٍ تسجيل الدخول...";
  const email = $("#adminEmail").value.trim();
  const password = $("#adminPassword").value;
  if (state.localMode) {
    const expected = localStorage.getItem(LOCAL_KEYS.password) || "admin";
    if (email === "admin" && password === expected) {
      localStorage.setItem(LOCAL_KEYS.session, "1");
      await openLocalDashboard();
      return;
    }
    elements.loginMessage.textContent = "بيانات الدخول غير صحيحة. الافتراضي هو admin / admin ما لم تكن غيّرت كلمة المرور.";
    return;
  }
  const { data, error } = await state.supabase.auth.signInWithPassword({ email, password });
  if (error) {
    elements.loginMessage.textContent = "تعذر الدخول. تحقق من البريد وكلمة المرور.";
    return;
  }
  await verifyAndOpenDashboard(data.user);
}

async function verifyAndOpenDashboard(user) {
  const { data, error } = await state.supabase.from("admin_users").select("display_name").eq("user_id", user.id).maybeSingle();
  if (error || !data) {
    await state.supabase.auth.signOut();
    elements.loginMessage.textContent = "الحساب صحيح لكنه غير مسجل كمدير. أضف معرّف المستخدم إلى جدول admin_users كما في التعليمات.";
    return;
  }
  state.admin = { user, displayName: data.display_name || user.email };
  elements.adminName.textContent = state.admin.displayName;
  elements.loginView.classList.add("hidden");
  elements.dashboardView.classList.remove("hidden");
  elements.logoutBtn.classList.remove("hidden");
  await loadDashboardData();
}

async function logout() {
  if (state.localMode) {
    localStorage.removeItem(LOCAL_KEYS.session);
    location.reload();
    return;
  }
  await state.supabase.auth.signOut();
  location.reload();
}

async function loadDashboardData() {
  elements.refreshAdminBtn.disabled = true;
  elements.refreshAdminBtn.textContent = "جارٍ التحديث...";
  try {
    if (state.localMode) {
      loadLocalData();
      populateCategorySelects();
      renderQuestionsTable();
      renderResultsTable();
      renderCategoriesTable();
      renderMembersTable();
      renderStats();
      renderOverview();
      loadSiteSettings();
      return;
    }
    const [categoriesResponse, questionsResponse, resultsResponse] = await Promise.all([
      state.supabase.from("categories").select("*").order("sort_order", { ascending: true }),
      state.supabase.from("questions").select("*, category:categories(*)").order("created_at", { ascending: false }),
      state.supabase.from("results").select("*").order("created_at", { ascending: false }).limit(1000)
    ]);
    if (categoriesResponse.error) throw categoriesResponse.error;
    if (questionsResponse.error) throw questionsResponse.error;
    if (resultsResponse.error) throw resultsResponse.error;

    state.categories = categoriesResponse.data || [];
    state.questions = questionsResponse.data || [];
    state.results = resultsResponse.data || [];
    populateCategorySelects();
    renderQuestionsTable();
    renderResultsTable();
    renderCategoriesTable();
    renderMembersTable();
    renderStats();
    renderOverview();
    loadSiteSettings();
  } catch (error) {
    alert(`تعذر تحميل بيانات لوحة الإدارة: ${error.message}`);
  } finally {
    elements.refreshAdminBtn.disabled = false;
    elements.refreshAdminBtn.textContent = "تحديث البيانات";
  }
}

function switchTab(tabName) {
  elements.tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === tabName));
  elements.tabPanels.forEach((panel) => panel.classList.toggle("active", panel.id === `${tabName}Tab`));
}

function renderStats() {
  elements.questionsStat.textContent = state.questions.length;
  elements.resultsStat.textContent = state.results.length;
  const average = state.results.length ? Math.round(state.results.reduce((sum, result) => sum + Number(result.score || 0), 0) / state.results.length) : 0;
  elements.averageStat.textContent = `${average}%`;
  const today = new Date();
  const todayCount = state.results.filter((result) => {
    const date = new Date(result.created_at);
    return date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate();
  }).length;
  elements.todayStat.textContent = todayCount;
}

function enableLocalMode() {
  state.localMode = true;
  state.supabase = null;
  elements.loginMessage.textContent = "الوضع المحلي مفعل. ادخل باسم المستخدم admin وكلمة المرور admin.";
  $("#adminEmail").value = "admin";
}

async function openLocalDashboard() {
  state.admin = { user: { email: "admin" }, displayName: "admin" };
  elements.adminName.textContent = "admin";
  elements.loginView.classList.add("hidden");
  elements.dashboardView.classList.remove("hidden");
  elements.logoutBtn.classList.remove("hidden");
  await loadDashboardData();
}

function loadLocalData() {
  state.categories = JSON.parse(localStorage.getItem(LOCAL_KEYS.categories) || "null") || DEMO_CATEGORIES;
  state.questions = JSON.parse(localStorage.getItem(LOCAL_KEYS.questions) || "null") || DEMO_QUESTIONS;
  state.results = JSON.parse(localStorage.getItem("quiz-local-results") || "[]");
}

function saveLocalData() {
  localStorage.setItem(LOCAL_KEYS.categories, JSON.stringify(state.categories));
  localStorage.setItem(LOCAL_KEYS.questions, JSON.stringify(state.questions));
}

function makeLocalId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function renderOverview() {
  if (!elements.overviewCards) return;
  const activeQuestions = state.questions.filter((q) => q.active !== false).length;
  const members = buildMembers();
  const bestScore = state.results.length ? Math.max(...state.results.map((r) => Number(r.score || 0))) : 0;
  elements.overviewCards.innerHTML = [
    ["الأسئلة النشطة", activeQuestions],
    ["الأعضاء", members.length],
    ["أفضل نتيجة", `${Math.round(bestScore)}%`],
    ["نمط التشغيل", state.localMode ? "محلي" : "Supabase"]
  ].map(([label, value]) => `<article class="panel"><span>${label}</span><strong>${value}</strong></article>`).join("");
  const categoryLoad = state.categories.map((category) => {
    const count = state.questions.filter((q) => q.category_id === category.id || q.category?.slug === category.slug).length;
    return `<article><strong>${escapeHtml(category.name)}</strong><p class="muted-cell">${count} سؤال</p></article>`;
  }).join("");
  elements.adminInsights.innerHTML = categoryLoad || `<p class="muted-cell">لا توجد مؤشرات بعد.</p>`;
}

function populateCategorySelects() {
  const options = state.categories.map((category) => `<option value="${category.id}">${escapeHtml(category.name)}</option>`).join("");
  elements.questionCategory.innerHTML = options;
  const filterOptions = state.categories.map((category) => `<option value="${category.slug}">${escapeHtml(category.name)}</option>`).join("");
  elements.questionCategoryFilter.innerHTML = `<option value="all">كل الأقسام</option>${filterOptions}`;
  elements.resultCategoryFilter.innerHTML = `<option value="all">كل الأقسام</option><option value="all-exam">اختبار شامل</option>${filterOptions}`;
}

function toggleOptionsField() {
  const visible = elements.questionType.value === "mcq";
  elements.optionsField.classList.toggle("hidden", !visible);
  if (elements.questionType.value === "true_false") elements.questionAnswers.placeholder = "صح أو خطأ";
  else elements.questionAnswers.placeholder = "الإجابة الصحيحة";
}

function openQuestionEditor(question = null) {
  elements.questionForm.reset();
  elements.questionFormMessage.textContent = "";
  elements.questionFormMessage.classList.remove("success");
  elements.questionActive.checked = true;
  elements.questionId.value = question?.id || "";
  elements.questionEditorTitle.textContent = question ? "تعديل السؤال" : "سؤال جديد";
  if (question) {
    elements.questionCategory.value = question.category_id;
    elements.questionType.value = question.type;
    elements.questionDifficulty.value = question.difficulty;
    elements.questionActive.checked = question.active;
    elements.questionPromptInput.value = question.prompt || "";
    elements.questionOptions.value = (question.options || []).join("\n");
    elements.questionAnswers.value = (question.accepted_answers || []).join("\n");
    elements.questionExplanation.value = question.explanation || "";
  }
  toggleOptionsField();
  elements.questionEditor.classList.remove("hidden");
  elements.questionEditor.scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeQuestionEditor() { elements.questionEditor.classList.add("hidden"); }

async function saveQuestion(event) {
  event.preventDefault();
  elements.questionFormMessage.textContent = "جارٍ الحفظ...";
  const type = elements.questionType.value;
  const options = elements.questionOptions.value.split("\n").map((value) => value.trim()).filter(Boolean);
  const acceptedAnswers = elements.questionAnswers.value.split("\n").map((value) => value.trim()).filter(Boolean);

  if (!acceptedAnswers.length) {
    elements.questionFormMessage.textContent = "أدخل إجابة صحيحة واحدة على الأقل.";
    return;
  }
  if (type === "mcq" && options.length < 2) {
    elements.questionFormMessage.textContent = "سؤال الاختيار المتعدد يحتاج إلى خيارين على الأقل.";
    return;
  }
  if (type === "mcq" && !acceptedAnswers.some((answer) => options.includes(answer))) {
    elements.questionFormMessage.textContent = "يجب أن تكون الإجابة الصحيحة مطابقة لأحد الخيارات حرفيًا.";
    return;
  }
  if (type === "true_false" && !["صح", "خطأ"].includes(acceptedAnswers[0])) {
    elements.questionFormMessage.textContent = "إجابة الصح والخطأ يجب أن تكون: صح أو خطأ.";
    return;
  }

  const payload = {
    category_id: elements.questionCategory.value,
    type,
    difficulty: elements.questionDifficulty.value,
    active: elements.questionActive.checked,
    prompt: elements.questionPromptInput.value.trim(),
    options: type === "mcq" ? options : (type === "true_false" ? ["صح", "خطأ"] : []),
    accepted_answers: acceptedAnswers,
    explanation: elements.questionExplanation.value.trim() || null,
    updated_at: new Date().toISOString()
  };
  const id = elements.questionId.value;
  if (state.localMode) {
    if (id) state.questions = state.questions.map((question) => question.id === id ? { ...question, ...payload, category: state.categories.find((c) => c.id === payload.category_id) } : question);
    else state.questions.unshift({ id: makeLocalId("question"), created_at: new Date().toISOString(), ...payload, category: state.categories.find((c) => c.id === payload.category_id) });
    saveLocalData();
    elements.questionFormMessage.classList.add("success");
    elements.questionFormMessage.textContent = "تم حفظ السؤال محلياً.";
    await loadDashboardData();
    setTimeout(closeQuestionEditor, 500);
    return;
  }

  const response = id
    ? await state.supabase.from("questions").update(payload).eq("id", id)
    : await state.supabase.from("questions").insert(payload);

  if (response.error) {
    elements.questionFormMessage.textContent = `تعذر الحفظ: ${response.error.message}`;
    return;
  }
  elements.questionFormMessage.classList.add("success");
  elements.questionFormMessage.textContent = "تم حفظ السؤال بنجاح.";
  await loadDashboardData();
  setTimeout(closeQuestionEditor, 500);
}

function filteredQuestions() {
  const search = elements.questionSearch.value.trim().toLowerCase();
  const category = elements.questionCategoryFilter.value;
  const type = elements.questionTypeFilter.value;
  return state.questions.filter((question) => {
    const matchesSearch = !search || question.prompt.toLowerCase().includes(search);
    const matchesCategory = category === "all" || question.category?.slug === category;
    const matchesType = type === "all" || question.type === type;
    return matchesSearch && matchesCategory && matchesType;
  });
}

function renderQuestionsTable() {
  const rows = filteredQuestions();
  if (!rows.length) {
    elements.questionsTableWrap.innerHTML = `<div class="empty-state"><div class="empty-icon">؟</div><h2>لا توجد أسئلة</h2><p>أضف سؤالًا جديدًا أو غيّر عوامل البحث.</p></div>`;
    return;
  }
  elements.questionsTableWrap.innerHTML = `<table><thead><tr><th>السؤال</th><th>القسم</th><th>النوع</th><th>الصعوبة</th><th>الحالة</th><th>الإجراءات</th></tr></thead><tbody>${rows.map((question) => `
    <tr>
      <td>${escapeHtml(question.prompt.slice(0, 150))}${question.prompt.length > 150 ? "…" : ""}</td>
      <td>${escapeHtml(question.category?.name || "—")}</td>
      <td>${TYPE_LABELS[question.type] || question.type}</td>
      <td>${DIFFICULTY_LABELS[question.difficulty] || question.difficulty}</td>
      <td><span class="status-dot ${question.active ? "active" : ""}">${question.active ? "نشط" : "متوقف"}</span></td>
      <td><div class="table-actions"><button class="button button-secondary button-small" data-edit-question="${question.id}">تعديل</button><button class="button button-danger button-small" data-delete-question="${question.id}">حذف</button></div></td>
    </tr>`).join("")}</tbody></table>`;
  elements.questionsTableWrap.querySelectorAll("[data-edit-question]").forEach((button) => button.addEventListener("click", () => openQuestionEditor(state.questions.find((question) => question.id === button.dataset.editQuestion))));
  elements.questionsTableWrap.querySelectorAll("[data-delete-question]").forEach((button) => button.addEventListener("click", () => confirmDelete("question", button.dataset.deleteQuestion, "سيُحذف السؤال نهائيًا.")));
}

function filteredResults() {
  const search = elements.resultSearch.value.trim().toLowerCase();
  const category = elements.resultCategoryFilter.value;
  return state.results.filter((result) => {
    const haystack = `${result.participant_name || ""} ${result.participant_rank || ""} ${result.participant_unit || ""} ${result.category_slug || ""}`.toLowerCase();
    const matchesSearch = !search || haystack.includes(search);
    const matchesCategory = category === "all" || (category === "all-exam" ? result.category_slug === "all" : result.category_slug === category);
    return matchesSearch && matchesCategory;
  });
}

function renderResultsTable() {
  const rows = filteredResults();
  if (!rows.length) {
    elements.resultsTableWrap.innerHTML = `<div class="empty-state"><div class="empty-icon">0</div><h2>لا توجد نتائج</h2><p>ستظهر هنا نتائج المستخدمين بعد إنهاء الاختبارات.</p></div>`;
    return;
  }
  elements.resultsTableWrap.innerHTML = `<table><thead><tr><th>المتدرب</th><th>القسم</th><th>الدرجة</th><th>الصحيح</th><th>الوقت</th><th>التاريخ</th><th>الإجراءات</th></tr></thead><tbody>${rows.map((result) => `
    <tr>
      <td><strong>${escapeHtml(result.participant_name)}</strong><br><span class="muted-cell">${escapeHtml([result.participant_rank, result.participant_unit].filter(Boolean).join(" — ") || "بدون تفاصيل")}</span></td>
      <td>${escapeHtml(categoryNameFromSlug(result.category_slug))}</td>
      <td><strong>${Math.round(Number(result.score))}%</strong></td>
      <td>${result.correct_count} / ${result.question_count}</td>
      <td>${formatDuration(result.duration_seconds)}</td>
      <td>${formatDate(result.created_at)}</td>
      <td><div class="table-actions"><button class="button button-secondary button-small" data-view-result="${result.id}">تفاصيل</button><button class="button button-danger button-small" data-delete-result="${result.id}">حذف</button></div></td>
    </tr>`).join("")}</tbody></table>`;
  elements.resultsTableWrap.querySelectorAll("[data-view-result]").forEach((button) => button.addEventListener("click", () => showResultDetails(state.results.find((result) => result.id === button.dataset.viewResult))));
  elements.resultsTableWrap.querySelectorAll("[data-delete-result]").forEach((button) => button.addEventListener("click", () => confirmDelete("result", button.dataset.deleteResult, "سيتم حذف نتيجة المتدرب نهائيًا.")));
}

function categoryNameFromSlug(slug) {
  if (slug === "all") return "اختبار شامل";
  return state.categories.find((category) => category.slug === slug)?.name || slug || "—";
}

function showResultDetails(result) {
  const answers = Array.isArray(result.answers) ? result.answers : [];
  elements.resultDetailsContent.innerHTML = `
    <div class="result-stats"><div><span>الاسم</span><strong>${escapeHtml(result.participant_name)}</strong></div><div><span>الدرجة</span><strong>${Math.round(Number(result.score))}%</strong></div><div><span>الوقت</span><strong>${formatDuration(result.duration_seconds)}</strong></div></div>
    <p style="color:var(--muted);margin-top:16px">القسم: ${escapeHtml(categoryNameFromSlug(result.category_slug))} — التاريخ: ${formatDate(result.created_at)}</p>
    <div class="result-answer-list">${answers.map((answer, index) => `<article class="result-answer-item"><p><strong>${index + 1}. ${escapeHtml(answer.prompt || "السؤال")}</strong></p><p>الإجابة: ${escapeHtml(answer.answer || "لم يجب")}</p><p>الحالة: ${answer.correct ? "✓ صحيحة" : "✕ خاطئة"}</p></article>`).join("") || "<p>لا توجد تفاصيل محفوظة.</p>"}</div>`;
  elements.detailsDialog.showModal();
}

function exportResults() {
  const rows = filteredResults();
  const headers = ["الاسم", "الرتبة", "الوحدة", "القسم", "الدرجة", "الصحيح", "الخاطئ", "عدد الأسئلة", "المدة بالثواني", "التاريخ"];
  const csvRows = rows.map((result) => [
    result.participant_name, result.participant_rank || "", result.participant_unit || "", categoryNameFromSlug(result.category_slug),
    result.score, result.correct_count, result.wrong_count, result.question_count, result.duration_seconds, result.created_at
  ]);
  const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const csv = "\ufeff" + [headers, ...csvRows].map((row) => row.map(quote).join(",")).join("\n");
  downloadTextFile(`نتائج-الاختبارات-${new Date().toISOString().slice(0, 10)}.csv`, csv, "text/csv;charset=utf-8");
}

function openCategoryEditor(category = null) {
  elements.categoryForm.reset();
  elements.categoryFormMessage.textContent = "";
  elements.categoryFormMessage.classList.remove("success");
  elements.categoryActive.checked = true;
  elements.categoryOrder.value = 0;
  elements.categoryId.value = category?.id || "";
  elements.categoryEditorTitle.textContent = category ? "تعديل القسم" : "قسم جديد";
  if (category) {
    elements.categoryName.value = category.name || "";
    elements.categorySlug.value = category.slug || "";
    elements.categoryIcon.value = category.icon || "";
    elements.categoryOrder.value = category.sort_order ?? 0;
    elements.categoryDescription.value = category.description || "";
    elements.categoryActive.checked = category.active;
  }
  elements.categoryEditor.classList.remove("hidden");
  elements.categoryEditor.scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeCategoryEditor() { elements.categoryEditor.classList.add("hidden"); }

async function saveCategory(event) {
  event.preventDefault();
  elements.categoryFormMessage.textContent = "جارٍ الحفظ...";
  const slug = elements.categorySlug.value.trim().toLowerCase();
  if (!/^[a-z0-9-]+$/.test(slug)) {
    elements.categoryFormMessage.textContent = "المعرّف الإنجليزي يقبل حروفًا إنجليزية صغيرة وأرقامًا وشرطة فقط.";
    return;
  }
  const payload = {
    name: elements.categoryName.value.trim(), slug, icon: elements.categoryIcon.value.trim() || "📚",
    sort_order: Number(elements.categoryOrder.value || 0), description: elements.categoryDescription.value.trim() || null,
    active: elements.categoryActive.checked, updated_at: new Date().toISOString()
  };
  const id = elements.categoryId.value;
  if (state.localMode) {
    if (id) state.categories = state.categories.map((category) => category.id === id ? { ...category, ...payload } : category);
    else state.categories.push({ id: makeLocalId("category"), created_at: new Date().toISOString(), ...payload });
    saveLocalData();
    elements.categoryFormMessage.classList.add("success");
    elements.categoryFormMessage.textContent = "تم حفظ القسم محلياً.";
    await loadDashboardData();
    setTimeout(closeCategoryEditor, 500);
    return;
  }
  const response = id ? await state.supabase.from("categories").update(payload).eq("id", id) : await state.supabase.from("categories").insert(payload);
  if (response.error) {
    elements.categoryFormMessage.textContent = `تعذر الحفظ: ${response.error.message}`;
    return;
  }
  elements.categoryFormMessage.classList.add("success");
  elements.categoryFormMessage.textContent = "تم حفظ القسم.";
  await loadDashboardData();
  setTimeout(closeCategoryEditor, 500);
}

function renderCategoriesTable() {
  if (!state.categories.length) {
    elements.categoriesTableWrap.innerHTML = `<div class="empty-state"><h2>لا توجد أقسام</h2></div>`;
    return;
  }
  elements.categoriesTableWrap.innerHTML = `<table><thead><tr><th>القسم</th><th>المعرّف</th><th>الترتيب</th><th>الحالة</th><th>الإجراءات</th></tr></thead><tbody>${state.categories.map((category) => `
    <tr><td>${escapeHtml(category.icon || "📚")} <strong>${escapeHtml(category.name)}</strong><br><span class="muted-cell">${escapeHtml(category.description || "")}</span></td><td>${escapeHtml(category.slug)}</td><td>${category.sort_order}</td><td><span class="status-dot ${category.active ? "active" : ""}">${category.active ? "نشط" : "متوقف"}</span></td><td><div class="table-actions"><button class="button button-secondary button-small" data-edit-category="${category.id}">تعديل</button><button class="button button-danger button-small" data-delete-category="${category.id}">حذف</button></div></td></tr>`).join("")}</tbody></table>`;
  elements.categoriesTableWrap.querySelectorAll("[data-edit-category]").forEach((button) => button.addEventListener("click", () => openCategoryEditor(state.categories.find((category) => category.id === button.dataset.editCategory))));
  elements.categoriesTableWrap.querySelectorAll("[data-delete-category]").forEach((button) => button.addEventListener("click", () => confirmDelete("category", button.dataset.deleteCategory, "سيُحذف القسم. يجب حذف أو نقل أسئلته أولًا إذا كان يحتوي على أسئلة.")));
}

function confirmDelete(type, id, message) {
  state.pendingDelete = { type, id };
  elements.deleteDialogText.textContent = message;
  elements.deleteDialog.showModal();
}

async function executeDelete() {
  if (state.localMode) {
    const { type, id } = state.pendingDelete;
    if (type === "question") state.questions = state.questions.filter((item) => item.id !== id);
    if (type === "category") state.categories = state.categories.filter((item) => item.id !== id);
    if (type === "result") {
      state.results = state.results.filter((item) => item.id !== id);
      localStorage.setItem("quiz-local-results", JSON.stringify(state.results));
    }
    saveLocalData();
    await loadDashboardData();
    return;
  }
  const table = state.pendingDelete.type === "question" ? "questions" : state.pendingDelete.type === "result" ? "results" : "categories";
  const { error } = await state.supabase.from(table).delete().eq("id", state.pendingDelete.id);
  if (error) {
    alert(`تعذر الحذف: ${error.message}`);
    return;
  }
  await loadDashboardData();
}

function buildMembers() {
  const map = new Map();
  state.results.forEach((result) => {
    const name = result.participant_name || "بدون اسم";
    const item = map.get(name) || { name, rank: result.participant_rank || "", unit: result.participant_unit || "", attempts: 0, best: 0, last: result.created_at };
    item.attempts += 1;
    item.best = Math.max(item.best, Number(result.score || 0));
    if (new Date(result.created_at) > new Date(item.last)) item.last = result.created_at;
    map.set(name, item);
  });
  return [...map.values()].sort((a, b) => b.best - a.best);
}

function renderMembersTable() {
  if (!elements.membersTableWrap) return;
  const members = buildMembers();
  if (!members.length) {
    elements.membersTableWrap.innerHTML = `<div class="empty-state"><h2>لا توجد بيانات أعضاء بعد</h2><p>تظهر الأسماء هنا بعد إنهاء الاختبارات.</p></div>`;
    return;
  }
  elements.membersTableWrap.innerHTML = `<table><thead><tr><th>العضو</th><th>الرتبة / الوحدة</th><th>عدد المحاولات</th><th>أفضل نتيجة</th><th>آخر نشاط</th></tr></thead><tbody>${members.map((member) => `<tr><td><strong>${escapeHtml(member.name)}</strong></td><td>${escapeHtml([member.rank, member.unit].filter(Boolean).join(" — ") || "بدون تفاصيل")}</td><td>${member.attempts}</td><td><strong>${Math.round(member.best)}%</strong></td><td>${formatDate(member.last)}</td></tr>`).join("")}</tbody></table>`;
}

function exportMembers() {
  const headers = ["الاسم", "الرتبة", "الوحدة", "عدد المحاولات", "أفضل نتيجة", "آخر نشاط"];
  const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const csv = "\ufeff" + [headers, ...buildMembers().map((m) => [m.name, m.rank, m.unit, m.attempts, m.best, m.last])].map((row) => row.map(quote).join(",")).join("\n");
  downloadTextFile(`الأعضاء-${new Date().toISOString().slice(0, 10)}.csv`, csv, "text/csv;charset=utf-8");
}

function loadSiteSettings() {
  const settings = JSON.parse(localStorage.getItem(LOCAL_KEYS.site) || "null") || { siteName: "اختبر معلوماتك العسكرية", ownerName: "محمود عبد المعطي الأحمد", notice: "" };
  if (elements.siteNameInput) elements.siteNameInput.value = settings.siteName;
  if (elements.ownerNameInput) elements.ownerNameInput.value = settings.ownerName;
  if (elements.siteNoticeInput) elements.siteNoticeInput.value = settings.notice || "";
}

function saveSiteSettings(event) {
  event.preventDefault();
  localStorage.setItem(LOCAL_KEYS.site, JSON.stringify({ siteName: elements.siteNameInput.value.trim(), ownerName: elements.ownerNameInput.value.trim(), notice: elements.siteNoticeInput.value.trim() }));
  elements.siteSettingsMessage.classList.add("success");
  elements.siteSettingsMessage.textContent = "تم حفظ إعدادات الموقع محلياً.";
}

function changeLocalPassword(event) {
  event.preventDefault();
  const expected = localStorage.getItem(LOCAL_KEYS.password) || "admin";
  if (elements.currentAdminPassword.value !== expected) {
    elements.passwordMessage.textContent = "كلمة المرور الحالية غير صحيحة.";
    return;
  }
  if (elements.newAdminPassword.value !== elements.confirmAdminPassword.value) {
    elements.passwordMessage.textContent = "تأكيد كلمة المرور غير مطابق.";
    return;
  }
  localStorage.setItem(LOCAL_KEYS.password, elements.newAdminPassword.value);
  elements.passwordForm.reset();
  elements.passwordMessage.classList.add("success");
  elements.passwordMessage.textContent = "تم تغيير كلمة المرور بنجاح.";
}

init();
