const documents = [
  {
    id: "cardiology",
    title: "心内科随访策略",
    size: "546 B",
    preview: "胸痛、胸闷、心悸患者需要结合心电图、肌钙蛋白、血压曲线和既往病史评估。",
    selected: true
  },
  {
    id: "respiratory",
    title: "呼吸科分诊记录",
    size: "531 B",
    preview: "咳嗽、咳痰、喘息、发热或活动后气短患者需要记录血氧、肺部听诊和胸部影像。",
    selected: true
  },
  {
    id: "cold",
    title: "感冒分类说明",
    size: "524 B",
    preview: "感冒主要分为普通感冒和流行性感冒两种类型，区别在于病原体、症状严重程度及传染性不同。",
    selected: true
  }
];

const uploadChoices = [
  {
    id: "followup",
    title: "术后随访摘要",
    size: "416 B",
    preview: "术后随访需确认伤口情况、体温、疼痛评分、复查时间和异常症状。"
  },
  {
    id: "emergency",
    title: "胸痛急诊评估提示",
    size: "438 B",
    preview: "胸痛伴出汗、血压异常或活动后明显加重时，应优先进入心内科急诊评估。"
  },
  {
    id: "privacy",
    title: "隐私病历摘要",
    size: "569 B",
    preview: "包含敏感标记的合成病历摘要，用于展示宿主机明文残留扫描。"
  }
];

const qaBank = [
  {
    id: "cold",
    question: "感冒分为什么类型？",
    answer: "根据已选私有文档，感冒主要分为普通感冒和流行性感冒两种类型。普通感冒整体症状相对较轻，常见鼻塞、流涕、咽痛和轻度咳嗽；流行性感冒通常全身症状更明显，可能出现高热、肌肉酸痛和乏力，传染性也更强。",
    source: "感冒分类说明：感冒主要分为普通感冒和流行性感冒两种类型，区别在于病原体、症状严重程度及传染性不同。"
  },
  {
    id: "chest",
    question: "胸痛伴出汗应该优先参考哪类流程？",
    answer: "应优先参考心内科急诊评估流程。文档中将胸痛伴大汗、濒死感、血压下降或肌钙蛋白升高列为高风险提示，建议优先进入心内科急诊通道。",
    source: "心内科随访策略：胸痛伴大汗、濒死感、血压下降或肌钙蛋白升高时，应优先进入心内科急诊通道。"
  },
  {
    id: "copd",
    question: "慢阻肺患者随访需要确认什么？",
    answer: "需要复核吸入药名称、使用频次、吸入手法和近期急性加重次数，同时记录血氧饱和度、呼吸频率、肺部听诊和影像变化。",
    source: "呼吸科分诊记录：慢阻肺患者需要复核吸入药名称、使用频次、吸入手法和近期急性加重次数。"
  }
];

const stages = [
  { label: "硬件探测", phase: "接入与探测", nodes: ["compute"], detail: "宿主机只提供算力，私有文档仍归属移动保险箱。" },
  { label: "接入数据", phase: "接入私有数据", nodes: ["data", "router", "key"], detail: "私有文档从移动保险箱进入隔离运行环境，并生成本次运行密钥。" },
  { label: "轻量训练", phase: "安全微调", nodes: ["train", "compute"], detail: "静态版以动画模拟训练阶段，真实版会生成 loss 和参数文件。" },
  { label: "缓存处理", phase: "缓存处理", nodes: ["cache", "key"], detail: "保险箱模式展示加密缓存；无保护模式展示未加密缓存风险。" },
  { label: "结果保存", phase: "结果保存", nodes: ["adapter"], detail: "微调参数文件保存回移动保险箱。" },
  { label: "安全移除", phase: "安全移除准备", nodes: ["key", "cache"], detail: "销毁本次运行密钥，准备移除移动存储设备。" },
  { label: "风险检测", phase: "风险检测", nodes: ["cache", "adapter"], detail: "检查宿主机明文残留、缓存形态和报告完整性。" }
];

const state = {
  mode: "vault",
  selectedQuestion: "cold",
  events: [],
  activeStage: -1,
  timer: null
};

const $ = (selector) => document.querySelector(selector);

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderDocuments() {
  const list = $("#docList");
  list.innerHTML = documents.map((doc) => `
    <article class="doc-item">
      <div class="doc-check">✓</div>
      <div>
        <div class="doc-title">${escapeHtml(doc.title)}</div>
        <div class="doc-preview">${escapeHtml(doc.preview)}</div>
      </div>
    </article>
  `).join("");
  $("#docCount").textContent = `${documents.length} 份示例`;
}

function renderUploadChoices() {
  $("#uploadChoices").innerHTML = uploadChoices.map((doc) => `
    <button class="upload-choice" type="button" data-upload="${doc.id}">
      <strong>${escapeHtml(doc.title)} · ${escapeHtml(doc.size)}</strong>
      <span>${escapeHtml(doc.preview)}</span>
    </button>
  `).join("");
}

function renderQuestions() {
  $("#questionBank").innerHTML = qaBank.map((item) => `
    <button class="question-btn ${item.id === state.selectedQuestion ? "active" : ""}" type="button" data-question="${item.id}">
      <strong>${escapeHtml(item.question)}</strong>
    </button>
  `).join("");
}

function appendMessage(kind, title, content, source) {
  const node = document.createElement("div");
  node.className = `message ${kind}`;
  node.innerHTML = `
    <strong>${escapeHtml(title)}</strong>
    <p>${escapeHtml(content)}</p>
    ${source ? `<details><summary>查看引用依据</summary><p>${escapeHtml(source)}</p></details>` : ""}
  `;
  $("#chatLog").appendChild(node);
  $("#chatLog").scrollTop = $("#chatLog").scrollHeight;
}

function sendQuestion() {
  const item = qaBank.find((entry) => entry.id === state.selectedQuestion) || qaBank[0];
  appendMessage("user", "预设问题", item.question);
  $("#modelState").textContent = "生成中";
  window.setTimeout(() => {
    appendMessage("model", "本地 Qwen + 私有文档上下文（静态模拟）", item.answer, item.source);
    $("#modelState").textContent = "静态预设问答";
  }, 520);
}

function renderStages() {
  $("#stageButtons").innerHTML = stages.map((stage, index) => `
    <button class="stage ${index < state.activeStage ? "done" : index === state.activeStage ? "active" : ""}" type="button" data-stage="${index}">
      ${index + 1}. ${escapeHtml(stage.label)}
    </button>
  `).join("");
}

function renderTopology() {
  document.querySelectorAll("[data-node]").forEach((node) => {
    node.classList.remove("active", "done", "risk");
  });
  stages.forEach((stage, index) => {
    const done = index < state.activeStage;
    const active = index === state.activeStage;
    stage.nodes.forEach((name) => {
      const node = document.querySelector(`[data-node="${name}"]`);
      if (!node) return;
      if (done) node.classList.add("done");
      if (active) node.classList.add("active");
      if (state.mode === "baseline" && name === "cache" && index >= 3 && (done || active)) {
        node.classList.add("risk");
      }
    });
  });
  const stage = stages[state.activeStage];
  $("#currentStep").textContent = stage ? stage.label : "待机";
  $("#focusTitle").textContent = stage ? stage.label : "等待演示运行";
  $("#focusDetail").textContent = stage ? stage.detail : "点击上方模式按钮后，模块会按执行阶段高亮。";
  $("#cacheState").textContent = state.mode === "vault" ? "加密缓存" : "未加密缓存风险";
  $("#keyState").textContent = state.activeStage >= 5 ? "已销毁" : state.activeStage >= 1 ? "运行期保留" : "未生成";
  $("#adapterState").textContent = state.activeStage >= 4 ? "已保存" : "等待保存";
  renderStages();
}

function addEvent(phase, title, status = "ok", detail = "") {
  const now = new Date();
  state.events.unshift({
    time: now.toISOString().slice(0, 19),
    phase,
    title,
    status,
    detail
  });
  renderEvents();
}

function renderEvents() {
  $("#eventCount").textContent = `${state.events.length} 条事件`;
  $("#eventList").innerHTML = state.events.map((event) => `
    <details class="event-row">
      <summary>
        <span class="event-time">${escapeHtml(event.time)}</span>
        <span class="event-phase">${escapeHtml(event.phase)}</span>
        <strong class="event-title">${escapeHtml(event.title)}</strong>
        <span class="event-status ${event.status}">${event.status === "risk" ? "风险" : "通过"}</span>
      </summary>
      <div class="event-detail">${escapeHtml(event.detail)}</div>
    </details>
  `).join("");
}

function renderRiskCards(checked = false) {
  const vault = state.mode === "vault";
  const cards = vault
    ? [
        ["宿主机明文残留扫描", checked ? "未检出敏感明文" : "待检测", "pass"],
        ["缓存加密形态验证", checked ? "加密缓存可识别" : "待检测", "pass"],
        ["错误密钥拒绝验证", checked ? "错误密钥无法解密" : "待检测", "pass"],
        ["微调参数文件归属验证", checked ? "已保存回移动保险箱" : "待检测", "pass"]
      ]
    : [
        ["宿主机明文残留扫描", checked ? "检出敏感明文" : "待检测", "risk"],
        ["缓存形态验证", checked ? "存在未加密缓存" : "待检测", "risk"],
        ["错误密钥拒绝验证", checked ? "不适用" : "待检测", "pending"],
        ["微调参数文件归属验证", checked ? "存在残留风险" : "待检测", "risk"]
      ];
  $("#riskCards").innerHTML = cards.map(([title, value, status]) => `
    <article class="risk-card ${checked ? status : "pending"}">
      <div class="risk-icon">${checked ? (status === "risk" ? "!" : "✓") : "-"}</div>
      <div>
        <strong>${escapeHtml(title)}</strong>
        <p>${escapeHtml(value)}</p>
      </div>
    </article>
  `).join("");
}

function renderCompare() {
  $("#compareGrid").innerHTML = `
    <section class="compare-section">
      <h3>无保护模式</h3>
      <p>用于展示敏感数据直接进入宿主机临时目录时的风险。</p>
      <ul>
        <li>训练缓存以未加密形式暂存</li>
        <li>风险检测可命中敏感 sentinel</li>
        <li>退出后宿主机仍可能保留明文痕迹</li>
      </ul>
    </section>
    <section class="compare-section">
      <h3>保险箱模式</h3>
      <p>用于展示移动保险箱持有数据，宿主机只提供算力。</p>
      <ul>
        <li>中间缓存加密后进入宿主机临时目录</li>
        <li>错误密钥无法解开加密缓存</li>
        <li>微调参数文件保存回移动保险箱</li>
      </ul>
    </section>
  `;
}

function runDemo(mode) {
  state.mode = mode;
  state.activeStage = -1;
  state.events = [];
  if (state.timer) window.clearInterval(state.timer);
  $("#baselineBtn").classList.toggle("active", mode === "baseline");
  $("#vaultBtn").classList.toggle("active", mode === "vault");
  $("#runStatus").textContent = mode === "vault" ? "保险箱运行中" : "无保护运行中";
  $("#riskMode").textContent = mode === "vault" ? "保险箱模式" : "无保护模式";
  renderRiskCards(false);
  renderTopology();
  renderEvents();

  state.timer = window.setInterval(() => {
    state.activeStage += 1;
    const stage = stages[state.activeStage];
    if (!stage) {
      window.clearInterval(state.timer);
      state.timer = null;
      $("#runStatus").textContent = mode === "vault" ? "保险箱验证通过" : "无保护发现风险";
      $("#runStatus").className = mode === "vault" ? "pill safe" : "pill";
      addEvent("完成", mode === "vault" ? "保险箱流程演示完成" : "无保护风险对照完成", mode === "vault" ? "ok" : "risk", "静态版已完成预设流程动画。");
      return;
    }
    const risk = mode === "baseline" && stage.label === "缓存处理";
    addEvent(stage.phase, stage.label, risk ? "risk" : "ok", stage.detail);
    renderTopology();
  }, 650);
}

function runCheck() {
  renderRiskCards(true);
  addEvent("风险检测", state.mode === "vault" ? "风险检测通过" : "检出无保护风险", state.mode === "vault" ? "ok" : "risk", state.mode === "vault"
    ? "未检出宿主机明文残留，缓存以加密形式存在。"
    : "检出宿主机临时目录中的敏感明文和未加密缓存。");
}

function bindEvents() {
  $("#baselineBtn").addEventListener("click", () => runDemo("baseline"));
  $("#vaultBtn").addEventListener("click", () => runDemo("vault"));
  $("#sendQuestionBtn").addEventListener("click", sendQuestion);
  $("#checkBtn").addEventListener("click", runCheck);
  $("#openUploadBtn").addEventListener("click", () => $("#uploadDialog").showModal());
  $("#questionBank").addEventListener("click", (event) => {
    const button = event.target.closest("[data-question]");
    if (!button) return;
    state.selectedQuestion = button.dataset.question;
    renderQuestions();
  });
  $("#uploadChoices").addEventListener("click", (event) => {
    const button = event.target.closest("[data-upload]");
    if (!button) return;
    const doc = uploadChoices.find((item) => item.id === button.dataset.upload);
    if (doc && !documents.some((item) => item.id === doc.id)) {
      documents.unshift({ ...doc, selected: true });
      renderDocuments();
      appendMessage("system", "模拟上传完成", `${doc.title} 已加入移动保险箱。`);
      addEvent("文档接入", "模拟上传微调文档", "ok", `${doc.title} 加入移动保险箱示例区。`);
    }
    $("#uploadDialog").close();
  });
  $("#stageButtons").addEventListener("click", (event) => {
    const button = event.target.closest("[data-stage]");
    if (!button) return;
    state.activeStage = Number(button.dataset.stage);
    renderTopology();
  });
}

function init() {
  renderDocuments();
  renderUploadChoices();
  renderQuestions();
  renderStages();
  renderTopology();
  renderRiskCards(false);
  renderCompare();
  renderEvents();
  bindEvents();
}

init();
