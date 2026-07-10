const state = {
  runId: null,
  pollTimer: null,
  activeMode: null,
  lastEvents: [],
  documents: [],
  selectedDocuments: new Set(),
  modelStatus: null,
  runtimeConfig: null,
  runtimeDraft: null,
  runtimeEditing: false,
  runtimeApplying: false,
  runtimeRestart: null,
  runtimeRestartTimer: null,
  hardwareTimer: null,
  eventRefreshTimer: null,
  expandedEventKeys: new Set(),
  localEvents: [],
  compareReports: {
    baseline: null,
    vault: null
  },
  proofRunningMode: null,
  currentReport: null,
  modeSelected: false
};

const runtimeRestartStorageKey = "aiVaultRuntimeRestart";
const phases = ["接入与探测", "隔离环境初始化", "受控模型适配", "加密卸载", "结果回写", "安全退出", "验证报告"];

const topologyStages = [
  {
    phase: "接入与探测",
    label: "硬件探测",
    nodes: ["compute"],
    detail: "宿主机只提供 GPU/CPU 算力资源，数据仍留在移动保险箱侧。"
  },
  {
    phase: "隔离环境初始化",
    label: "接入数据与密钥",
    nodes: ["data", "router", "key"],
    detail: "私有数据从移动保险箱接入隔离环境，并创建本次运行密钥。"
  },
  {
    phase: "受控模型适配",
    label: "后台适配验证",
    nodes: ["engine", "compute"],
    detail: "后台适配验证使用宿主机算力，模型适配参数在隔离环境中更新。"
  },
  {
    phase: "加密卸载",
    label: "缓存加密暂存",
    nodes: ["key", "cache"],
    detail: "中间缓存先经 AES-GCM 加密，再进入宿主机临时盘。"
  },
  {
    phase: "不安全缓存",
    label: "未加密缓存风险",
    nodes: ["cache"],
    risk: true,
    detail: "无保护模式下敏感缓存未经加密写入宿主机，用作风险对照。"
  },
  {
    phase: "结果回写",
    label: "结果保存回保险箱",
    nodes: ["engine", "adapter"],
    detail: "模型适配参数保存回移动保险箱，宿主机只保留可验证的缓存状态。"
  },
  {
    phase: "安全退出",
    label: "销毁运行密钥",
    nodes: ["key", "cache"],
    detail: "本次运行密钥销毁后，宿主机加密缓存不可被错误密钥解开。"
  },
  {
    phase: "验证报告",
    label: "安全验证",
    nodes: ["cache", "adapter"],
    detail: "扫描宿主机明文残留，验证加密缓存、错误密钥和参数文件路径。"
  }
];

const staticDemo = {
  nextDocId: 10,
  runs: {},
  reports: {
    baseline: null,
    vault: null,
    latest: null
  },
  modelLoaded: false,
  runtime: {
    selected_gpu_ids: [1, 2],
    current_model_id: "Qwen/Qwen2.5-14B-Instruct",
    current_model_label: "Qwen2.5 14B Instruct",
    active_model_option_id: "Qwen/Qwen2.5-14B-Instruct",
    device_map: "auto"
  },
  documents: [
    {
      id: "cardiology_followup_protocol.txt",
      name: "cardiology_followup_protocol.txt",
      title: "心内科随访策略",
      bytes: 546,
      preview: "胸痛、胸闷、心悸患者需要结合心电图、肌钙蛋白、血压曲线和既往病史评估。高风险患者应优先进入心内科急诊通道。",
      contains_sentinel: false
    },
    {
      id: "respiratory_triage_notes.txt",
      name: "respiratory_triage_notes.txt",
      title: "呼吸科分诊记录",
      bytes: 531,
      preview: "咳嗽、咳痰、喘息、发热或活动后气短患者需要记录血氧、肺部听诊和胸部影像。慢阻肺患者还需要复核吸入药使用方法。",
      contains_sentinel: false
    },
    {
      id: "common_cold_classification.txt",
      name: "common_cold_classification.txt",
      title: "感冒分类说明",
      bytes: 524,
      preview: "感冒主要分为普通感冒和流行性感冒两种类型，区别在于病原体、症状严重程度及传染性不同。",
      contains_sentinel: false
    }
  ],
  uploadChoices: [
    {
      id: "mock_followup.txt",
      title: "术后随访摘要",
      preview: "术后随访需确认伤口情况、体温、疼痛评分、复查时间和异常症状。",
      contains_sentinel: false
    },
    {
      id: "mock_chest_pain.txt",
      title: "胸痛急诊评估提示",
      preview: "胸痛伴出汗、血压异常或活动后明显加重时，应优先进入心内科急诊评估。",
      contains_sentinel: false
    },
    {
      id: "mock_private_case.txt",
      title: "隐私病历摘要",
      preview: "包含敏感标记的合成病历摘要，用于展示宿主机明文残留扫描。",
      contains_sentinel: true
    }
  ],
  questions: [
    {
      id: "chest",
      question: "患者胸痛伴出汗，应该优先参考哪份流程？",
      answer: "应优先参考心内科急诊评估流程。已选文档中将胸痛伴大汗、濒死感、血压下降或肌钙蛋白升高列为高风险提示，建议优先进入心内科急诊通道。",
      sourceTitle: "心内科随访策略",
      snippet: "高风险提示：胸痛伴大汗、濒死感、血压下降或肌钙蛋白升高时，应优先进入心内科急诊通道。",
      terms: ["胸痛", "出汗", "心内科"]
    },
    {
      id: "cold",
      question: "感冒分为什么类型？",
      answer: "根据已选私有文档，感冒主要分为普通感冒和流行性感冒两种类型。普通感冒整体症状相对较轻，常见鼻塞、流涕、咽痛和轻度咳嗽；流行性感冒通常全身症状更明显，传染性也更强。",
      sourceTitle: "感冒分类说明",
      snippet: "感冒主要分为普通感冒和流行性感冒两种类型，区别在于病原体、症状严重程度及传染性不同。",
      terms: ["感冒", "普通感冒", "流行性感冒"]
    },
    {
      id: "followup",
      question: "术后随访需要重点确认哪些内容？",
      answer: "根据已上传的术后随访摘要，术后随访应重点确认伤口情况、体温、疼痛评分、复查时间和异常症状。若出现持续发热、伤口渗液、明显出血或胸闷气短，应提示及时线下复诊。",
      missingAnswer: "当前已选文档中没有找到“术后随访摘要”的相关内容。请先在私有文档区点击上传按钮，选择“术后随访摘要”模拟加入移动保险箱后，再重新提问。",
      sourceTitle: "术后随访摘要",
      snippet: "术后随访需确认伤口情况、体温、疼痛评分、复查时间和异常症状。",
      terms: ["术后", "随访", "伤口", "复查"],
      requiresDocumentId: "mock_followup.txt"
    }
  ]
};

const $ = (selector) => document.querySelector(selector);
let activeTooltipTarget = null;
let globalTooltip = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function ensureGlobalTooltip() {
  if (!globalTooltip) {
    globalTooltip = document.createElement("div");
    globalTooltip.className = "global-tooltip";
    globalTooltip.setAttribute("role", "tooltip");
    document.body.appendChild(globalTooltip);
  }
  return globalTooltip;
}

function showGlobalTooltip(target) {
  const text = target?.dataset?.tooltip;
  if (!text) {
    return;
  }
  activeTooltipTarget = target;
  const tooltip = ensureGlobalTooltip();
  tooltip.textContent = text;
  tooltip.classList.add("visible");
  positionGlobalTooltip();
}

function hideGlobalTooltip() {
  activeTooltipTarget = null;
  if (globalTooltip) {
    globalTooltip.classList.remove("visible");
    globalTooltip.style.transform = "translate3d(-9999px, -9999px, 0)";
  }
}

function positionGlobalTooltip() {
  if (!activeTooltipTarget || !globalTooltip) {
    return;
  }
  const gap = 12;
  const margin = 14;
  const targetRect = activeTooltipTarget.getBoundingClientRect();
  const tooltipRect = globalTooltip.getBoundingClientRect();
  let left = targetRect.left + targetRect.width / 2 - tooltipRect.width / 2;
  left = Math.max(margin, Math.min(left, window.innerWidth - tooltipRect.width - margin));

  const spaceAbove = targetRect.top - margin;
  const placeAbove = spaceAbove >= tooltipRect.height + gap;
  let top = placeAbove
    ? targetRect.top - tooltipRect.height - gap
    : targetRect.bottom + gap;
  top = Math.max(margin, Math.min(top, window.innerHeight - tooltipRect.height - margin));

  const arrowLeft = targetRect.left + targetRect.width / 2 - left;
  globalTooltip.dataset.placement = placeAbove ? "top" : "bottom";
  globalTooltip.style.setProperty("--tip-arrow-left", `${Math.max(12, Math.min(tooltipRect.width - 12, arrowLeft))}px`);
  globalTooltip.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
}

function formatMib(mib) {
  if (mib === null || mib === undefined || Number.isNaN(Number(mib))) {
    return "--";
  }
  return `${(Number(mib) / 1024).toFixed(Number(mib) >= 10240 ? 1 : 2)} GiB`;
}

function clampPercent(value) {
  const number = Number(value) || 0;
  return Math.max(0, Math.min(100, number));
}

function setBusy(isBusy) {
  $("#baselineBtn").disabled = isBusy;
  $("#vaultBtn").disabled = isBusy;
}

function setAskButtonEnabled(enabled, message) {
  const button = $("#askBtn");
  const gate = $("#askGate");
  if (!button) {
    return;
  }
  const tooltip = message || "";
  if (enabled) {
    button.disabled = false;
    button.removeAttribute("disabled");
    button.removeAttribute("aria-disabled");
    button.title = "";
    delete button.dataset.tooltip;
  } else {
    button.disabled = true;
    button.setAttribute("disabled", "");
    button.setAttribute("aria-disabled", "true");
    button.title = tooltip;
    button.dataset.tooltip = tooltip;
  }
  if (gate) {
    if (!enabled && tooltip) {
      gate.dataset.tooltip = tooltip;
    } else {
      delete gate.dataset.tooltip;
    }
  }
  if (!enabled) {
    $("#modelState").textContent = "请先选择模式";
  } else if (!staticDemo.modelLoaded) {
    $("#modelState").textContent = "等待提问";
  }
}

function updateDemoInteractionGate() {
  const hasMode = state.modeSelected || state.activeMode === "baseline" || state.activeMode === "vault";
  setAskButtonEnabled(
    hasMode,
    hasMode ? "选择预设问题后可模拟本地模型回答。" : "请先选择模拟运行方式：无保护模式或保险箱模式。"
  );
  if (!hasMode) {
    setVerifyButton(null, false);
  }
}

function setModeButtons(mode, status) {
  const baseline = $("#baselineBtn");
  const vault = $("#vaultBtn");
  [baseline, vault].forEach((button) => {
    button.classList.remove("active", "inactive", "running");
    button.removeAttribute("aria-pressed");
  });
  if (!mode || mode === "idle") {
    return;
  }
  const active = mode === "vault" ? vault : baseline;
  const inactive = mode === "vault" ? baseline : vault;
  active.classList.add("active");
  active.setAttribute("aria-pressed", "true");
  inactive.classList.add("inactive");
  inactive.setAttribute("aria-pressed", "false");
  if (status === "running") {
    active.classList.add("running");
  }
}

async function api(path, options = {}) {
  await delay(120);
  return mockApi(path, options);
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function requestBody(options) {
  try {
    return options?.body ? JSON.parse(options.body) : {};
  } catch (_error) {
    return {};
  }
}

function mockApi(path, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  if (path === "/api/hardware") {
    return mockHardware();
  }
  if (path === "/api/runtime/config") {
    return mockRuntimeConfig();
  }
  if (path === "/api/runtime/apply" && method === "POST") {
    const body = requestBody(options);
    const selectedGpuIds = (body.gpu_ids || [])
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value));
    const model = mockModelOptions().find((item) => item.id === body.model_id) || mockModelOptions()[0];
    staticDemo.runtime = {
      selected_gpu_ids: selectedGpuIds,
      current_model_id: model.id,
      current_model_label: model.label,
      active_model_option_id: model.id,
      device_map: body.device_map || "auto"
    };
    staticDemo.modelLoaded = false;
    return { ok: true, applied: body };
  }
  if (path === "/api/model/status") {
    return {
      enabled: true,
      loaded: staticDemo.modelLoaded,
      real_model: false,
      demo_mode: true,
      model_id: staticDemo.runtime.current_model_label || "Qwen2.5-Demo-Preset",
      backend: "github-pages-demo",
      device: "browser",
      dtype: "preset",
      cache_dir: "docs/demo-fixture"
    };
  }
  if (path === "/api/documents" && method === "GET") {
    return { documents: staticDemo.documents.map((doc) => ({ ...doc })) };
  }
  if (path === "/api/documents" && method === "POST") {
    const body = requestBody(options);
    const content = String(body.content || "");
    const filename = body.filename || `mock_document_${staticDemo.nextDocId++}.txt`;
    const saved = {
      id: filename,
      name: filename,
      title: firstLine(content) || filename,
      bytes: new Blob([content]).size || 128,
      preview: compactText(content || "页面内模拟写入的测试文档。"),
      contains_sentinel: content.includes("AI_VAULT_PATIENT_SENTINEL")
    };
    staticDemo.documents.unshift(saved);
    return saved;
  }
  if (path.startsWith("/api/documents/") && method === "DELETE") {
    const id = decodeURIComponent(path.split("/").pop() || "");
    staticDemo.documents = staticDemo.documents.filter((doc) => doc.id !== id);
    state.selectedDocuments.delete(id);
    return { ok: true };
  }
  if (path === "/api/demo/latest-reports") {
    return {
      baseline: staticDemo.reports.baseline,
      vault: staticDemo.reports.vault
    };
  }
  if (path === "/api/demo/latest-report") {
    return staticDemo.reports.latest || { status: "empty" };
  }
  if ((path === "/api/demo/baseline" || path === "/api/demo/vault") && method === "POST") {
    const mode = path.endsWith("/vault") ? "vault" : "baseline";
    const body = requestBody(options);
    const run = createMockRun(mode, body.document_ids || []);
    staticDemo.runs[run.run_id] = run;
    return { run_id: run.run_id, status: "running", mode };
  }
  const eventMatch = path.match(/^\/api\/demo\/([^/]+)\/events$/);
  if (eventMatch) {
    const run = staticDemo.runs[decodeURIComponent(eventMatch[1])];
    if (!run) {
      throw new Error("mock run not found");
    }
    return mockRunEvents(run);
  }
  const reportMatch = path.match(/^\/api\/demo\/([^/]+)\/report$/);
  if (reportMatch) {
    const run = staticDemo.runs[decodeURIComponent(reportMatch[1])];
    if (!run) {
      throw new Error("mock report not found");
    }
    const report = buildMockReport(run, false);
    staticDemo.reports[run.mode] = report;
    staticDemo.reports.latest = report;
    return report;
  }
  const verifyMatch = path.match(/^\/api\/demo\/([^/]+)\/verify$/);
  if (verifyMatch && method === "POST") {
    const run = staticDemo.runs[decodeURIComponent(verifyMatch[1])];
    if (!run) {
      throw new Error("mock verification target not found");
    }
    const report = buildMockReport(run, true);
    staticDemo.reports[run.mode] = report;
    staticDemo.reports.latest = report;
    return report;
  }
  if (path === "/api/model/ask" && method === "POST") {
    const body = requestBody(options);
    staticDemo.modelLoaded = true;
    window.setTimeout(() => {
      loadHardware();
      loadModelStatus();
    }, 50);
    return mockModelAnswer(body.question || "");
  }
  throw new Error(`Demo page has no route for ${method} ${path}`);
}

function firstLine(text) {
  return String(text || "").split(/\r?\n/).find((line) => line.trim())?.trim() || "";
}

function compactText(text) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, 180);
}

function mockGpuInventory() {
  return [
    {
      index: 0,
      name: "NVIDIA GeForce RTX 3060",
      total_mib: 12288,
      free_mib: 7820,
      used_mib: 4468,
      our_used_mib: 760,
      other_used_mib: 3708,
      utilization_gpu: 18,
      temperature_c: 46,
      power_w: 82,
      visible: true,
      processes: [
        { pid: 42420, name: "web-demo-preset", used_mib: 760, owner: "ours" },
        { pid: 18421, name: "python", used_mib: 3708, owner: "other" }
      ]
    },
    {
      index: 1,
      name: "NVIDIA GeForce RTX 4090",
      total_mib: 24564,
      free_mib: 18240,
      used_mib: 6324,
      our_used_mib: 1920,
      other_used_mib: 4404,
      utilization_gpu: 24,
      temperature_c: 49,
      power_w: 128,
      visible: true,
      processes: [
        { pid: 42420, name: "web-demo-preset", used_mib: 1920, owner: "ours" },
        { pid: 19244, name: "notebook", used_mib: 4404, owner: "other" }
      ]
    },
    {
      index: 2,
      name: "NVIDIA A100 80GB PCIe",
      total_mib: 81920,
      free_mib: 61200,
      used_mib: 20720,
      our_used_mib: 6144,
      other_used_mib: 14576,
      utilization_gpu: 41,
      temperature_c: 58,
      power_w: 238,
      visible: true,
      processes: [
        { pid: 42420, name: "web-demo-preset", used_mib: 6144, owner: "ours" },
        { pid: 20018, name: "train.py", used_mib: 14576, owner: "other" }
      ]
    },
    {
      index: 3,
      name: "NVIDIA L20",
      total_mib: 49152,
      free_mib: 28160,
      used_mib: 20992,
      our_used_mib: 3072,
      other_used_mib: 17920,
      utilization_gpu: 33,
      temperature_c: 52,
      power_w: 162,
      visible: true,
      processes: [
        { pid: 42420, name: "web-demo-preset", used_mib: 3072, owner: "ours" },
        { pid: 21309, name: "inference-server", used_mib: 17920, owner: "other" }
      ]
    }
  ];
}

function mockHardware() {
  const gpus = applyDemoRuntimeToGpus(mockGpuInventory());
  const activeGpus = gpus.filter((gpu) => gpu.visible !== false);
  const totals = (activeGpus.length ? activeGpus : gpus).reduce((acc, gpu) => {
    acc.total_mib += gpu.total_mib;
    acc.free_mib += gpu.free_mib;
    acc.our_used_mib += gpu.our_used_mib;
    acc.other_used_mib += gpu.other_used_mib;
    acc.avg_utilization_gpu += gpu.utilization_gpu;
    return acc;
  }, { total_mib: 0, free_mib: 0, our_used_mib: 0, other_used_mib: 0, avg_utilization_gpu: 0 });
  totals.avg_utilization_gpu = Math.round(totals.avg_utilization_gpu / Math.max(1, (activeGpus.length ? activeGpus : gpus).length));
  totals.gpu_count = gpus.length;
  totals.visible_count = activeGpus.length;
  return {
    platform: "GitHub Pages 网页演示环境",
    python: "not-required",
    cpu_count: 32,
    memory_gib: 128,
    cuda_available: true,
    cuda_visible_devices: "0,1,2,3",
    gpu_count: gpus.length,
    selected_device: "web-demo",
    gpu_inventory: gpus,
    gpu_totals: totals
  };
}

function applyDemoRuntimeToGpus(gpus) {
  const runtime = state.runtimeEditing && state.runtimeDraft
    ? {
        selected_gpu_ids: state.runtimeDraft.gpuIds || [],
        current_model_id: state.runtimeDraft.modelId || staticDemo.runtime.current_model_id
      }
    : staticDemo.runtime;
  const selected = new Set((runtime.selected_gpu_ids || []).map((id) => Number(id)));
  const model = mockModelOptions().find((item) => item.id === runtime.current_model_id) || mockModelOptions()[0];
  const selectedGpus = gpus.filter((gpu) => selected.has(Number(gpu.index)));
  const loadedVram = staticDemo.modelLoaded ? Number(model.demo_vram_mib || 0) : Math.min(900, Number(model.demo_vram_mib || 0) * 0.08);
  const perGpuModel = selectedGpus.length ? loadedVram / selectedGpus.length : 0;
  return gpus.map((gpu) => {
    const clone = { ...gpu };
    const isSelected = selected.has(Number(gpu.index));
    const wave = demoWave(gpu.index, 1);
    const otherBase = Number(gpu.other_used_mib || 0);
    const other = Math.max(0, Math.round(otherBase * (1 + wave * 0.018)));
    const runtimeOverhead = isSelected ? 420 + Math.round(120 * demoWave(gpu.index + 11, 1)) : 0;
    const modelShare = isSelected ? Math.round(perGpuModel * (1 + demoWave(gpu.index + 23, 0.018))) : 0;
    const ours = Math.max(0, runtimeOverhead + modelShare);
    const free = Math.max(0, Number(gpu.total_mib || 0) - other - ours);
    clone.visible = isSelected;
    clone.our_used_mib = ours;
    clone.other_used_mib = other;
    clone.used_mib = other + ours;
    clone.free_mib = free;
    clone.utilization_gpu = Math.max(0, Math.min(99, Math.round(Number(gpu.utilization_gpu || 0) + (isSelected && staticDemo.modelLoaded ? 12 : 0) + wave * 5)));
    clone.temperature_c = Math.max(28, Math.round(Number(gpu.temperature_c || 40) + (isSelected && staticDemo.modelLoaded ? 4 : 0) + demoWave(gpu.index + 5, 2)));
    clone.power_w = Math.max(30, Math.round(Number(gpu.power_w || 80) + (isSelected && staticDemo.modelLoaded ? 45 : 0) + demoWave(gpu.index + 9, 9)));
    clone.processes = [
      ...(isSelected && ours > 0 ? [{ pid: 42420, name: `${basename(model.id)}-web-demo`, used_mib: ours, owner: "ours" }] : []),
      { pid: 18000 + gpu.index * 137, name: gpu.processes?.find((process) => process.owner !== "ours")?.name || "other-workload", used_mib: other, owner: "other" }
    ];
    return clone;
  });
}

function demoWave(seed, amplitude = 1) {
  return Math.sin(Date.now() / 4200 + seed * 1.37) * amplitude;
}

function mockRuntimeConfig() {
  const runtime = staticDemo.runtime;
  return {
    selected_gpu_ids: [...runtime.selected_gpu_ids],
    current_model_id: runtime.current_model_id,
    current_model_label: runtime.current_model_label,
    active_model_option_id: runtime.active_model_option_id,
    device_map: runtime.device_map,
    gpu_options: applyDemoRuntimeToGpus(mockGpuInventory()),
    model_options: mockModelOptions()
  };
}

function mockModelOptions() {
  return [
    { id: "Qwen/Qwen2.5-0.5B-Instruct", label: "Qwen2.5 0.5B Instruct", params_b: 0.5, available: true, local: true, demo_vram_mib: 1600 },
    { id: "Qwen/Qwen2.5-7B-Instruct", label: "Qwen2.5 7B Instruct", params_b: 7, available: true, local: true, demo_vram_mib: 11200 },
    { id: "Qwen/Qwen2.5-14B-Instruct", label: "Qwen2.5 14B Instruct", params_b: 14, available: true, local: true, demo_vram_mib: 21800 },
    { id: "Qwen/Qwen2.5-32B-Instruct", label: "Qwen2.5 32B Instruct", params_b: 32, available: true, local: false, demo_vram_mib: 52000 }
  ];
}

function createMockRun(mode, documentIds) {
  const now = Date.now();
  return {
    mode,
    documentIds,
    run_id: `${mode}-demo-${now}`,
    startedAt: now,
    durationMs: 4400
  };
}

function mockRunEvents(run) {
  const elapsed = Date.now() - run.startedAt;
  const count = Math.min(mockEventTemplates(run.mode).length, Math.max(1, Math.floor(elapsed / 520) + 1));
  const events = mockEventTemplates(run.mode).slice(0, count).map((event, index) => ({
    run_id: run.run_id,
    ts: new Date(run.startedAt + index * 520).toISOString(),
    ...event
  }));
  const completed = count >= mockEventTemplates(run.mode).length;
  return {
    run_id: run.run_id,
    status: completed ? "completed" : "running",
    events
  };
}

function mockEventTemplates(mode) {
  const baseline = mode === "baseline";
  return [
    {
      phase: "接入与探测",
      event_type: "hardware",
      source: "browser-demo",
      target: "host-compute",
      action: "probe_resources",
      status: "ok",
      detail: "读取演示版 GPU 样例，展示宿主机只提供算力资源。"
    },
    {
      phase: "隔离环境初始化",
      event_type: "mount",
      source: "移动保险箱",
      target: "isolated-runtime",
      action: "mount_private_dataset",
      status: "ok",
      detail: "私有文档进入隔离运行环境，页面内完成模拟接入。"
    },
    {
      phase: "受控模型适配",
      event_type: "training",
      source: "isolated-runtime",
      target: "host-compute",
      action: "start_toy_lora",
      status: "ok",
      detail: "模拟后台模型适配验证并生成收敛指标。"
    },
    baseline
      ? {
          phase: "不安全缓存",
          event_type: "cache",
          source: "isolated-runtime",
          target: "host_scratch",
          action: "write_plaintext_cache",
          status: "risk",
          detail: "无保护模式下缓存以未加密形式写入宿主机临时目录，用于形成风险对照。"
        }
      : {
          phase: "加密卸载",
          event_type: "cache",
          source: "isolated-runtime",
          target: "host_scratch",
          action: "aes_gcm_encrypt_and_offload",
          status: "ok",
          detail: "中间缓存经 AES-GCM 加密后临时存放到宿主机目录。"
        },
    {
      phase: "结果回写",
      event_type: "artifact",
      source: "isolated-runtime",
      target: "移动保险箱",
      action: "persist_adapter",
      status: "ok",
      detail: "模型适配参数保存回移动保险箱侧。"
    },
    {
      phase: "安全退出",
      event_type: "key",
      source: "session-key",
      target: "memory",
      action: "zeroize_session_key",
      status: "ok",
      detail: "销毁本次运行密钥，准备安全移除移动存储设备。"
    },
    {
      phase: "验证报告",
      event_type: "report",
      source: "scanner",
      target: "reports",
      action: "inspect_plaintext",
      status: baseline ? "risk" : "ok",
      detail: baseline ? "检测到宿主机临时目录中的敏感明文。": "未检测到宿主机敏感明文残留。"
    }
  ];
}

function buildMockReport(run, verified) {
  const baseline = run.mode === "baseline";
  const events = mockEventTemplates(run.mode).map((event, index) => ({
    run_id: run.run_id,
    ts: new Date(run.startedAt + index * 520).toISOString(),
    ...event
  }));
  const cacheFiles = baseline
    ? [`host_scratch/${run.run_id}/activation_epoch_01.cache.txt`]
    : [`host_scratch/${run.run_id}/activation_epoch_01.cache.enc`];
  const report = {
    run_id: run.run_id,
    mode: run.mode,
    status: "completed",
    duration_ms: run.durationMs,
    selected_documents: run.documentIds,
    events,
    safety_boundary: "演示版验证页面流程和可视化逻辑；真实训练、真实扫描和真实加密请运行 FastAPI 版本。",
    sentinel: {
      host_plaintext_found: baseline,
      host_plaintext_hits: baseline ? [{ path: cacheFiles[0], count: 2 }] : []
    },
    cache_encryption: {
      cache_files: cacheFiles,
      encrypted_cache_files: baseline ? [] : cacheFiles,
      plaintext_cache_files: baseline ? cacheFiles : [],
      wrong_key_decrypt_failed: baseline ? null : true,
      encrypted_entropy_bits_per_byte: baseline ? null : 7.91
    },
    training: {
      device: "web-demo",
      loss_last: baseline ? 0.16241 : 0.13876,
      adapter_path: `vault_drive/adapters/adapter_${run.mode}_demo.pt`
    },
    paths: {
      adapter: `vault_drive/adapters/adapter_${run.mode}_demo.pt`
    }
  };
  if (verified) {
    report.verification = buildMockVerification(report);
  }
  return report;
}

function buildMockVerification(report) {
  const baseline = report.mode === "baseline";
  const cacheFiles = report.cache_encryption.cache_files || [];
  return {
    verified_at: new Date().toISOString(),
    duration_ms: 318,
    summary: {
      host_plaintext_found: baseline,
      host_plaintext_hits: baseline ? report.sentinel.host_plaintext_hits : [],
      cache_files: cacheFiles,
      encrypted_cache_files: report.cache_encryption.encrypted_cache_files || [],
      plaintext_cache_files: report.cache_encryption.plaintext_cache_files || [],
      wrong_key_decrypt_failed: baseline ? null : true,
      encrypted_entropy_bits_per_byte: report.cache_encryption.encrypted_entropy_bits_per_byte
    },
    checks: [
      {
        id: "host_plaintext_scan",
        name: "宿主机明文残留扫描",
        status: baseline ? "risk" : "pass",
        result: baseline ? "检出敏感明文" : "未检出敏感明文",
        method: "递归扫描宿主机临时目录中的敏感 sentinel。",
        evidence: baseline ? "命中 2 处敏感标记。" : "扫描结果为空。"
      },
      {
        id: "cache_shape",
        name: "缓存加密形态验证",
        status: baseline ? "risk" : "pass",
        result: baseline ? "存在未加密缓存" : "加密缓存可识别",
        method: "枚举本次运行缓存文件并检查扩展名和熵值。",
        evidence: baseline ? "发现 .cache.txt 明文缓存。" : "发现 .cache.enc 加密缓存，熵值 7.91。"
      },
      {
        id: "wrong_key_rejection",
        name: "错误密钥拒绝验证",
        status: baseline ? "skip" : "pass",
        result: baseline ? "不适用" : "错误密钥无法解密",
        method: "使用错误密钥尝试解密缓存。",
        evidence: baseline ? "无密文缓存可验证。" : "解密失败，符合预期。"
      },
      {
        id: "adapter_ownership",
        name: "模型适配参数归属验证",
        status: "pass",
        result: "参数文件位于移动保险箱",
        method: "检查 adapter 输出路径。",
        evidence: report.training.adapter_path
      },
      {
        id: "report_integrity",
        name: "审计报告完整性检查",
        status: "pass",
        result: "报告字段完整",
        method: "检查 run_id、事件、训练指标和缓存摘要。",
        evidence: "演示版报告结构完整。"
      }
    ]
  };
}

function mockModelAnswer(question) {
  const normalized = String(question || "");
  const match = staticDemo.questions.find((item) =>
    normalized.includes(item.question) ||
    item.terms.some((term) => normalized.includes(term))
  ) || staticDemo.questions[0];
  const requiredDocumentReady = !match.requiresDocumentId ||
    (staticDemo.documents.some((doc) => doc.id === match.requiresDocumentId) &&
      state.selectedDocuments.has(match.requiresDocumentId));
  const snippets = requiredDocumentReady ? [
    {
      title: match.sourceTitle,
      document_id: match.sourceTitle,
      snippet: match.snippet,
      relevance: 0.92,
      matched_terms: match.terms
    }
  ] : [];
  return {
    vault_answer: requiredDocumentReady ? match.answer : match.missingAnswer,
    retrieved_snippets: snippets,
    cache_verification: {
      host_plaintext_found: false,
      encrypted_cache_files: ["host_scratch/model_inference/demo_context.cache.enc"]
    },
    model_backend: {
      demo_mode: true,
      real_model: false,
      loaded: true,
      model_id: staticDemo.runtime.current_model_label || "Qwen2.5-Demo-Preset",
      backend: "github-pages-demo",
      device: "browser",
      input_tokens: 512,
      new_tokens: 96,
      generate_seconds: 0.18
    }
  };
}

async function loadHardware() {
  if (state.runtimeRestart?.status === "restarting") {
    renderHardwareRestartNotice();
  }
  if (document.hidden && !$("#hardwareSummary").classList.contains("skeleton")) {
    return;
  }
  const summary = $("#hardwareSummary");
  const panel = document.querySelector(".hardware-panel");
  const isFirstLoad = summary.classList.contains("skeleton") && !$("#gpuList").children.length;
  if (isFirstLoad) {
    summary.textContent = "加载中";
  } else if (panel) {
    panel.classList.add("updating");
  }
  try {
    const [hardware, runtimeConfig] = await Promise.all([
      api("/api/hardware"),
      api("/api/runtime/config").catch(() => null)
    ]);
    state.runtimeConfig = runtimeConfig;
    renderHardware(hardware);
    renderRuntimeConfig(runtimeConfig);
  } catch (error) {
    if (state.runtimeRestart?.status === "restarting") {
      renderHardwareRestartNotice();
      return;
    }
    if (isFirstLoad) {
      summary.textContent = `硬件探测失败：${error.message}`;
    } else {
      summary.insertAdjacentHTML(
        "beforeend",
        `<div class="hardware-note danger">本次刷新失败：${escapeHtml(error.message)}</div>`
      );
    }
  } finally {
    if (panel) {
      panel.classList.remove("updating");
    }
  }
}

async function loadModelStatus() {
  const backend = $("#modelBackend");
  try {
    const status = await api("/api/model/status");
    state.modelStatus = status;
    renderModelStatus(status);
  } catch (error) {
    backend.textContent = `Qwen 状态失败：${error.message}`;
    backend.className = "mini-pill danger";
  }
}

function renderModelStatus(status) {
  state.modelStatus = status;
  const backend = $("#modelBackend");
  backend.classList.remove("safe", "danger", "warning");
  if (status?.demo_mode || status?.static_demo) {
    backend.textContent = status.loaded
      ? `网页演示版预设问答 · ${status.model_id || "Qwen"} · 已加载`
      : `网页演示版预设问答 · ${status.model_id || "Qwen"} · 首次提问后加载`;
    backend.classList.add("safe");
    $("#modelState").textContent = state.activeMode
      ? status.loaded ? "推理完成" : "等待提问"
      : "请先选择模式";
    return;
  }
  if (!status) {
    backend.textContent = "Qwen 状态未知";
    backend.classList.add("warning");
    return;
  }
  if (status.enabled === false) {
    backend.textContent = "Qwen 已关闭";
    backend.classList.add("warning");
    return;
  }
  if (status.real_model || status.loaded) {
    backend.textContent = `${status.model_id || "Qwen"} · ${status.device || "device"} · 已加载`;
    backend.classList.add("safe");
    return;
  }
  if (status.last_error || status.error) {
    backend.textContent = `Qwen 未就绪 · ${status.model_id || "Qwen"}`;
    backend.classList.add("danger");
    return;
  }
  backend.textContent = `${status.model_id || "Qwen"} · 首次提问时加载`;
}

function renderPresetQuestions() {
  const root = $("#presetQuestionBank");
  if (!root) {
    return;
  }
  root.innerHTML = staticDemo.questions.map((item, index) => `
    <button class="preset-question ${index === 0 ? "active" : ""}" type="button" data-question="${escapeHtml(item.question)}">
      ${escapeHtml(item.question)}
    </button>
  `).join("");
}

function renderMockUploadChoices() {
  const root = $("#mockUploadChoices");
  if (!root) {
    return;
  }
  root.innerHTML = staticDemo.uploadChoices.map((doc) => `
    <button class="mock-upload-choice" type="button" data-upload-id="${escapeHtml(doc.id)}">
      <strong>${escapeHtml(doc.title)}</strong>
      <span>${escapeHtml(doc.preview)}</span>
    </button>
  `).join("");
}

function openMockUploadDialog() {
  renderMockUploadChoices();
  const dialog = $("#mockUploadDialog");
  if (dialog?.showModal) {
    dialog.showModal();
  }
}

function saveMockUpload(id) {
  const doc = staticDemo.uploadChoices.find((item) => item.id === id);
  if (!doc) {
    return;
  }
  if (!staticDemo.documents.some((item) => item.id === doc.id)) {
    staticDemo.documents.unshift({
      ...doc,
      name: doc.id,
      bytes: 512
    });
    state.selectedDocuments.add(doc.id);
  }
  loadDocuments();
  appendMessage("system", "模拟上传完成", `${doc.title} 已加入移动保险箱。`);
  $("#mockUploadDialog")?.close();
}

async function loadDocuments() {
  const list = $("#docList");
  $("#docCount").textContent = "加载中";
  list.innerHTML = "";
  try {
    const payload = await api("/api/documents");
    state.documents = payload.documents || [];
    const availableIds = new Set(state.documents.map((doc) => doc.id));
    Array.from(state.selectedDocuments).forEach((id) => {
      if (!availableIds.has(id)) {
        state.selectedDocuments.delete(id);
      }
    });
    if (!state.selectedDocuments.size) {
      state.documents.forEach((doc) => state.selectedDocuments.add(doc.id));
    }
    renderDocuments();
  } catch (error) {
    $("#docCount").textContent = "加载失败";
    list.innerHTML = `<div class="doc-item"><div></div><div class="doc-preview">文档加载失败：${error.message}</div></div>`;
  }
}

function renderDocuments() {
  const list = $("#docList");
  const docs = state.documents;
  $("#docCount").textContent = `${selectedDocumentIds().length}/${docs.length} 已选`;
  list.innerHTML = "";
  docs.forEach((doc) => {
    const row = document.createElement("div");
    row.className = "doc-item";
    row.innerHTML = `
      <input type="checkbox" />
      <div>
        <div class="doc-title"></div>
        <div class="doc-preview"></div>
      </div>
      <span class="doc-badge"></span>
      <button class="doc-delete-btn" type="button" title="删除文档">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6m4-6v6M6 6l1 16h10l1-16" />
        </svg>
      </button>
    `;
    const checkbox = row.querySelector("input");
    checkbox.checked = state.selectedDocuments.has(doc.id);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        state.selectedDocuments.add(doc.id);
      } else {
        state.selectedDocuments.delete(doc.id);
      }
      $("#docCount").textContent = `${selectedDocumentIds().length}/${state.documents.length} 已选`;
    });
    const title = row.querySelector(".doc-title");
    const preview = row.querySelector(".doc-preview");
    title.textContent = doc.title || doc.name;
    title.title = doc.title || doc.name || "";
    preview.textContent = doc.preview || "";
    preview.title = doc.preview || "";
    const badge = row.querySelector(".doc-badge");
    badge.textContent = doc.contains_sentinel ? "敏感" : `${Math.max(1, Math.round((doc.bytes || 0) / 1024))} KB`;
    const deleteButton = row.querySelector(".doc-delete-btn");
    deleteButton.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteDocument(doc, deleteButton);
    });
    list.appendChild(row);
  });
  if (!docs.length) {
    list.innerHTML = `<div class="doc-item"><div></div><div class="doc-preview">暂无文档</div></div>`;
  }
}

async function deleteDocument(doc, button) {
  const name = doc.name || doc.id;
  if (!window.confirm(`确认删除私有文档「${name}」？`)) {
    return;
  }
  button.disabled = true;
  try {
    await api(`/api/documents/${encodeURIComponent(doc.id)}`, { method: "DELETE" });
    state.selectedDocuments.delete(doc.id);
    await loadDocuments();
    appendMessage("system", "移动保险箱删除", `已删除 ${name}。`);
  } catch (error) {
    button.disabled = false;
    appendMessage("system", "删除失败", error.message);
  }
}

function selectedDocumentIds() {
  return state.documents
    .filter((doc) => state.selectedDocuments.has(doc.id))
    .map((doc) => doc.id);
}

async function saveDocument(filename, content) {
  const saved = await api("/api/documents", {
    method: "POST",
    body: JSON.stringify({ filename, content })
  });
  state.selectedDocuments.add(saved.id);
  await loadDocuments();
  appendMessage("system", "已保存到移动保险箱", `已保存 ${saved.name}，用于本地检索与问答。`);
}

async function saveTypedDocument() {
  const filename = $("#docNameInput").value.trim() || "uploaded_case_note.txt";
  const content = $("#docTextInput").value.trim();
  if (!content) {
    appendMessage("system", "保存到移动保险箱", "文档内容为空。");
    return;
  }
  try {
    await saveDocument(filename, content);
  } catch (error) {
    appendMessage("system", "保存失败", error.message);
  }
}

async function savePickedFile(file) {
  const content = await file.text();
  $("#docNameInput").value = file.name;
  $("#docTextInput").value = content.slice(0, 5000);
  try {
    await saveDocument(file.name, content);
  } catch (error) {
    appendMessage("system", "上传失败", error.message);
  }
}

function renderHardware(hardware) {
  const summary = $("#hardwareSummary");
  const list = $("#gpuList");
  summary.classList.remove("skeleton");
  const totals = hardware.gpu_totals || {};
  const visibleText = hardware.cuda_visible_devices ? `物理 GPU 白名单 ${hardware.cuda_visible_devices}` : "未限制 GPU 白名单";
  summary.innerHTML = `
    <div class="hardware-overview">
      <div><span>宿主机</span><strong>${escapeHtml(hardware.platform || "Linux")}</strong></div>
      <div><span>CPU / 内存</span><strong>${hardware.cpu_count || "--"} 核 · ${hardware.memory_gib || "--"} GiB</strong></div>
      <div><span>可用 GPU</span><strong>${totals.visible_count ?? hardware.gpu_count ?? "--"} / ${totals.gpu_count ?? hardware.gpu_count ?? "--"} 张</strong></div>
      <div><span>显存合计</span><strong>${formatMib(totals.total_mib)} / 可用 ${formatMib(totals.free_mib)}</strong></div>
      <div><span>本软件占用</span><strong>${formatMib(totals.our_used_mib)}</strong></div>
      <div><span>其他程序占用</span><strong>${formatMib(totals.other_used_mib)}</strong></div>
    </div>
    <div class="hardware-note">${escapeHtml(visibleText)} · 平均利用率 ${totals.avg_utilization_gpu ?? 0}% · 选择设备 ${escapeHtml(hardware.selected_device || "cpu")}</div>
    <div class="memory-legend" aria-label="显存条形图图例">
      <span><i class="legend-swatch ours"></i>本软件占用</span>
      <span><i class="legend-swatch other"></i>其他程序占用</span>
      <span><i class="legend-swatch reserved"></i>系统保留/未归类</span>
      <span><i class="legend-swatch free"></i>空闲显存</span>
    </div>
  `;

  const gpus = hardware.gpu_inventory || hardware.gpus || [];
  if (!gpus.length) {
    list.innerHTML = `<div class="gpu-card"><div class="gpu-index">CPU</div><div><div class="gpu-name">未检测到 CUDA GPU</div><div class="gpu-mem">自动降级到 CPU</div></div></div>`;
    return;
  }

  const fragment = document.createDocumentFragment();
  gpus.forEach((gpu) => {
    const card = document.createElement("div");
    card.className = `gpu-card ${gpu.visible === false ? "muted" : "visible"}`;
    const total = Number(gpu.total_mib || 0);
    const used = Number(gpu.used_mib ?? (total - Number(gpu.free_mib || 0)));
    const ours = Number(gpu.our_used_mib || 0);
    const others = Number(gpu.other_used_mib || Math.max(0, used - ours));
    const free = Number(gpu.free_mib || 0);
    const reserved = Math.max(0, total - free - ours - others);
    const ourProcesses = (gpu.processes || []).filter((process) => process.owner === "ours");
    const otherProcesses = (gpu.processes || []).filter((process) => process.owner !== "ours");
    const segments = [
      {
        key: "ours",
        label: "本软件占用",
        value: ours,
        detail: processTooltip("本软件占用", ours, ourProcesses)
      },
      {
        key: "other",
        label: "其他程序占用",
        value: others,
        detail: processTooltip("其他程序占用", others, otherProcesses)
      },
      {
        key: "reserved",
        label: "系统保留/未归类",
        value: reserved,
        detail: "来自驱动保留、图形上下文或 nvidia-smi 未归属占用。"
      },
      {
        key: "free",
        label: "空闲显存",
        value: free,
        detail: "可被当前演示或后续模型加载继续使用。"
      }
    ];
    const segmentHtml = segments
      .map((segment) => {
        const percent = total ? clampPercent((segment.value / total) * 100) : 0;
        const width = segment.value > 0 && percent < 0.8 ? 0.8 : percent;
        const tooltip = `${segment.label}：${formatMib(segment.value)}\n${segment.detail}`;
        return `
          <span
            class="gpu-segment ${segment.key} ${segment.value > 0 ? "" : "zero"}"
            style="width:${width}%"
            data-tooltip="${escapeHtml(tooltip)}"
            aria-label="${escapeHtml(segment.label)} ${formatMib(segment.value)}"
          ></span>
        `;
      })
      .join("");
    card.innerHTML = `
      <div class="gpu-card-head">
        <div class="gpu-index">${gpu.index}</div>
        <div>
          <div class="gpu-name">${escapeHtml(gpu.name || "NVIDIA GPU")}</div>
          <div class="gpu-mem">${gpu.visible === false ? "未纳入本次运行" : "本次运行可用"} · 总显存 ${formatMib(total)} · 温度 ${gpu.temperature_c ?? "--"}°C · 功耗 ${gpu.power_w ?? "--"}W</div>
        </div>
        <div class="gpu-free">利用率 ${gpu.utilization_gpu ?? 0}%</div>
      </div>
      <div class="gpu-memory-row">
        <div class="gpu-memory-label">显存</div>
        <div class="gpu-bar" aria-label="GPU ${gpu.index} 显存占用分割图">
          ${segmentHtml}
        </div>
        <div class="gpu-memory-total">${formatMib(total)}</div>
      </div>
    `;
    fragment.appendChild(card);
  });
  const previousScrollTop = list.scrollTop;
  list.replaceChildren(fragment);
  list.scrollTop = previousScrollTop;
}

function renderRuntimeConfig(config) {
  const panel = $("#runtimeConfigPanel");
  const editButton = $("#runtimeEditBtn");
  const applyButton = $("#runtimeApplyBtn");
  if (!panel) {
    return;
  }
  const previousCard = panel.querySelector(".runtime-config-card");
  const previousScrollTop = previousCard ? previousCard.scrollTop : 0;
  const previousScrollLeft = previousCard ? previousCard.scrollLeft : 0;
  if (!config) {
    panel.innerHTML = "";
    if (editButton) editButton.disabled = true;
    if (applyButton) {
      applyButton.disabled = true;
      applyButton.hidden = true;
    }
    return;
  }
  const gpus = config.gpu_options || [];
  const models = config.model_options || [];
  if (!state.runtimeEditing && !state.runtimeApplying) {
    panel.innerHTML = "";
    state.runtimeDraft = null;
    if (editButton) {
      editButton.textContent = "调整运行资源";
      editButton.disabled = false;
    }
    if (applyButton) {
      applyButton.disabled = true;
      applyButton.hidden = true;
    }
    return;
  }
  ensureRuntimeDraft(config);
  const draft = state.runtimeDraft;
  const selected = new Set((draft.gpuIds || []).map((id) => Number(id)));
  const currentModel = draft.modelId || config.active_model_option_id || config.current_model_id || "";
  const recommendation = buildRuntimeRecommendation(config, Array.from(selected));
  if (editButton) {
    editButton.textContent = state.runtimeEditing ? "取消" : "调整运行资源";
    editButton.disabled = state.runtimeApplying;
  }
  if (applyButton) {
    applyButton.hidden = false;
    applyButton.disabled = !state.runtimeEditing || state.runtimeApplying;
    applyButton.textContent = state.runtimeApplying ? "重启中" : "确认";
  }

  const selectedGpuText = selected.size
    ? Array.from(selected).map((id) => `GPU ${id}`).join("、")
    : "未选择";
  const currentModelLabel = config.current_model_label || basename(currentModel || "Qwen");
  const gpuControls = state.runtimeEditing
    ? `
      <div class="runtime-field">
        <span>运行 GPU</span>
        <div class="gpu-choice-grid">
          ${gpus.map((gpu) => `
            <label class="gpu-choice ${selected.has(Number(gpu.index)) ? "active" : ""}">
              <input type="checkbox" value="${gpu.index}" ${selected.has(Number(gpu.index)) ? "checked" : ""} />
              <strong>GPU ${gpu.index}</strong>
              <small>${escapeHtml(gpu.name || "NVIDIA GPU")} · 空闲 ${formatMib(gpu.free_mib)}</small>
            </label>
          `).join("")}
        </div>
      </div>
    `
    : `
      <div class="runtime-chip-row">
        <span class="runtime-chip">当前 GPU：${escapeHtml(selectedGpuText)}</span>
        <span class="runtime-chip">设备映射：${escapeHtml(config.device_map || "auto")}</span>
      </div>
    `;
  const modelControl = state.runtimeEditing
    ? `
      <div class="runtime-field">
        <span>大模型参数量</span>
        <select id="runtimeModelSelect" class="runtime-select">
          ${models.map((model) => `
            <option value="${escapeHtml(model.id)}" ${model.id === currentModel ? "selected" : ""}>
              ${escapeHtml(model.label || model.id)}${model.local ? " · 本地" : " · 缓存/在线"}${model.params_b ? ` · ${model.params_b}B` : ""}
            </option>
          `).join("")}
        </select>
      </div>
      <div class="runtime-field">
        <span>加载方式</span>
        <select id="runtimeDeviceMapSelect" class="runtime-select">
          <option value="auto" ${(draft.deviceMap || "auto") === "auto" ? "selected" : ""}>auto 多卡自动分配</option>
          <option value="single-gpu-auto-select" ${(draft.deviceMap || "") === "single-gpu-auto-select" ? "selected" : ""}>单卡自动选择</option>
        </select>
      </div>
    `
    : `<div class="runtime-chip-row"><span class="runtime-chip strong">当前模型：${escapeHtml(currentModelLabel)}</span></div>`;

  panel.innerHTML = `
    <div class="runtime-config-card ${state.runtimeEditing ? "editing" : ""}">
      <div class="runtime-config-head">
        <div>
          <strong>运行配置</strong>
          <small>修改后会写入 .runtime_config.env，并按新 GPU/模型重启服务。</small>
        </div>
        <span class="runtime-status ${state.runtimeApplying ? "warning" : ""}">
          ${state.runtimeApplying ? "等待服务重启" : "实时生效需重启"}
        </span>
      </div>
      <div class="runtime-config-body">
        ${gpuControls}
        ${modelControl}
      </div>
      <div class="runtime-recommendation">
        <strong>模型建议</strong>
        <span>${escapeHtml(recommendation.summary || "等待 GPU 探测结果。")}</span>
        <small>${escapeHtml(recommendation.reason || "建议会根据已选 GPU 总显存、空闲显存和本地模型缓存生成。")}</small>
      </div>
    </div>
  `;
  const nextCard = panel.querySelector(".runtime-config-card");
  if (nextCard) {
    nextCard.scrollTop = previousScrollTop;
    nextCard.scrollLeft = previousScrollLeft;
  }
}

function toggleRuntimeEditing() {
  if (state.runtimeApplying) {
    return;
  }
  state.runtimeEditing = !state.runtimeEditing;
  state.runtimeDraft = state.runtimeEditing ? createRuntimeDraft(state.runtimeConfig) : null;
  renderRuntimeConfig(state.runtimeConfig);
}

async function applyRuntimeConfig() {
  if (!state.runtimeEditing || state.runtimeApplying) {
    return;
  }
  const panel = $("#runtimeConfigPanel");
  syncRuntimeDraftFromForm();
  const gpuIds = (state.runtimeDraft?.gpuIds || [])
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value));
  const modelId = state.runtimeDraft?.modelId || "";
  const deviceMap = state.runtimeDraft?.deviceMap || "auto";
  if (!gpuIds.length) {
    window.alert("请至少选择一张 GPU。");
    return;
  }
  const modelSelect = $("#runtimeModelSelect");
  const modelLabel = modelSelect?.selectedOptions?.[0]?.textContent?.trim() || modelId;
  const confirmed = window.confirm(
    `确认切换运行配置？\n\nGPU：${gpuIds.map((id) => `GPU ${id}`).join("、")}\n模型：${modelLabel}\n\n确认后 Demo 服务会自动重启，首次加载模型可能需要一两分钟。`
  );
  if (!confirmed) {
    return;
  }
  state.runtimeApplying = true;
  state.runtimeRestart = {
    status: "restarting",
    startedAt: Date.now(),
    detail: `正在切换到 ${gpuIds.map((id) => `GPU ${id}`).join("、")} · ${modelLabel}`
  };
  sessionStorage.setItem(runtimeRestartStorageKey, JSON.stringify(state.runtimeRestart));
  renderHardwareRestartNotice();
  renderRuntimeConfig(state.runtimeConfig);
  try {
    await api("/api/runtime/apply", {
      method: "POST",
      body: JSON.stringify({ gpu_ids: gpuIds, model_id: modelId, device_map: deviceMap })
    });
    const applyButton = $("#runtimeApplyBtn");
    if (applyButton) {
      applyButton.textContent = "重启中";
    }
    window.setTimeout(startRuntimeRestartPolling, 2500);
  } catch (error) {
    const message = String(error?.message || error);
    if (message.includes("Failed to fetch") || message.includes("NetworkError")) {
      window.setTimeout(startRuntimeRestartPolling, 1500);
      return;
    }
    state.runtimeApplying = false;
    state.runtimeRestart = null;
    sessionStorage.removeItem(runtimeRestartStorageKey);
    renderHardwareRestartNotice();
    renderRuntimeConfig(state.runtimeConfig);
    window.alert(`运行配置修改失败：${error.message}`);
  }
}

function renderHardwareRestartNotice() {
  const notice = $("#hardwareRestartNotice");
  if (!notice) {
    return;
  }
  const restart = state.runtimeRestart;
  if (!restart) {
    notice.hidden = true;
    notice.className = "hardware-restart-notice";
    notice.innerHTML = "";
    return;
  }
  const isComplete = restart.status === "complete";
  notice.hidden = false;
  notice.className = `hardware-restart-notice ${isComplete ? "complete" : "restarting"}`;
  notice.innerHTML = `
    <span class="restart-indicator" aria-hidden="true"></span>
    <div>
      <strong>${isComplete ? "资源重启完成" : "系统正在重启"}</strong>
      <small>${escapeHtml(restart.detail || (isComplete ? "新运行配置已生效。" : "正在释放旧模型资源并按新配置拉起服务。"))}</small>
    </div>
  `;
}

function showRuntimeRestartComplete(detail) {
  state.runtimeRestart = {
    status: "complete",
    startedAt: Date.now(),
    detail: detail || "新 GPU / 模型配置已生效，硬件探测已恢复。"
  };
  state.runtimeApplying = false;
  state.runtimeEditing = false;
  state.runtimeDraft = null;
  sessionStorage.removeItem(runtimeRestartStorageKey);
  renderRuntimeConfig(state.runtimeConfig);
  renderHardwareRestartNotice();
  window.setTimeout(() => {
    const notice = $("#hardwareRestartNotice");
    if (notice && state.runtimeRestart?.status === "complete") {
      notice.classList.add("fading");
    }
  }, 3600);
  window.setTimeout(() => {
    if (state.runtimeRestart?.status === "complete") {
      state.runtimeRestart = null;
      renderHardwareRestartNotice();
    }
  }, 5200);
}

function startRuntimeRestartPolling() {
  if (state.runtimeRestartTimer) {
    window.clearInterval(state.runtimeRestartTimer);
  }
  let attempts = 0;
  state.runtimeRestartTimer = window.setInterval(async () => {
    attempts += 1;
    try {
      const config = await api("/api/runtime/config");
      state.runtimeConfig = config;
      window.clearInterval(state.runtimeRestartTimer);
      state.runtimeRestartTimer = null;
      showRuntimeRestartComplete("新运行配置已生效，硬件资源探测恢复正常。");
      await loadHardware();
      loadModelStatus();
    } catch (error) {
      if (attempts >= 45) {
        window.clearInterval(state.runtimeRestartTimer);
        state.runtimeRestartTimer = null;
        state.runtimeRestart = {
          status: "restarting",
          startedAt: Date.now(),
          detail: "重启时间较长，请稍后刷新页面或检查 demo_server.log。"
        };
        renderHardwareRestartNotice();
      }
    }
  }, 1500);
}

function restoreRuntimeRestartState() {
  const raw = sessionStorage.getItem(runtimeRestartStorageKey);
  if (!raw) {
    return;
  }
  try {
    const restart = JSON.parse(raw);
    if (restart && restart.status === "restarting") {
      state.runtimeRestart = restart;
      state.runtimeApplying = true;
      renderHardwareRestartNotice();
      startRuntimeRestartPolling();
    }
  } catch (error) {
    sessionStorage.removeItem(runtimeRestartStorageKey);
  }
}

function createRuntimeDraft(config) {
  if (!config) {
    return { gpuIds: [], modelId: "", deviceMap: "auto" };
  }
  return {
    gpuIds: (config.selected_gpu_ids || []).map((id) => Number(id)),
    modelId: config.active_model_option_id || config.current_model_id || "",
    deviceMap: config.device_map || "auto"
  };
}

function ensureRuntimeDraft(config) {
  if (!state.runtimeDraft) {
    state.runtimeDraft = createRuntimeDraft(config);
  }
}

function syncRuntimeDraftFromForm() {
  if (!state.runtimeDraft) {
    state.runtimeDraft = createRuntimeDraft(state.runtimeConfig);
  }
  const panel = $("#runtimeConfigPanel");
  const modelSelect = $("#runtimeModelSelect");
  const deviceMapSelect = $("#runtimeDeviceMapSelect");
  state.runtimeDraft.gpuIds = Array.from(panel.querySelectorAll(".gpu-choice input:checked"))
    .map((input) => Number(input.value))
    .filter((value) => Number.isInteger(value));
  if (modelSelect) {
    state.runtimeDraft.modelId = modelSelect.value;
  }
  if (deviceMapSelect) {
    state.runtimeDraft.deviceMap = deviceMapSelect.value;
  }
}

function buildRuntimeRecommendation(config, selectedGpuIds) {
  const selected = new Set(selectedGpuIds.map((id) => Number(id)));
  const gpus = (config?.gpu_options || []).filter((gpu) => selected.has(Number(gpu.index)));
  const totalMib = gpus.reduce((sum, gpu) => sum + Number(gpu.total_mib || 0), 0);
  const freeMib = gpus.reduce((sum, gpu) => sum + Number(gpu.free_mib || 0), 0);
  const models = (config?.model_options || []).filter((model) => model.available);
  const bestOption = (maxParams) => {
    const candidates = models.filter((model) => Number(model.params_b || 0) <= maxParams);
    return candidates.sort((a, b) => Number(b.params_b || 0) - Number(a.params_b || 0))[0];
  };
  let recommended;
  let reason;
  if (freeMib >= 52000 || totalMib >= 80000) {
    recommended = bestOption(32) || bestOption(14) || bestOption(7);
    reason = "已选择 80GB 级或多卡高显存组合，适合演示 32B 级模型的分布式加载建议。";
  } else if (totalMib >= 48000 && gpus.length >= 2) {
    recommended = bestOption(14) || bestOption(7) || bestOption(1.5);
    reason = "已选择多张高显存 GPU，适合 14B 级模型并通过 device_map=auto 分布加载。";
  } else if (totalMib >= 20000) {
    recommended = bestOption(7) || bestOption(1.5) || bestOption(0.5);
    reason = "当前显存适合轻量或 7B 级模型；14B 建议至少选择两张 24GB GPU。";
  } else if (totalMib >= 6000) {
    recommended = bestOption(1.5) || bestOption(0.5);
    reason = "当前显存更适合轻量模型，优先保证演示响应速度。";
  } else {
    recommended = bestOption(0.5);
    reason = "可用 GPU 显存不足，建议使用 0.5B 或切换更多空闲 GPU。";
  }
  const gpuText = gpus.length ? gpus.map((gpu) => `GPU ${gpu.index}`).join(", ") : "未选择 GPU";
  const modelLabel = recommended?.label || "暂无可用本地模型";
  return {
    summary: `${gpuText} 合计显存 ${Math.round((totalMib / 1024) * 10) / 10} GiB，空闲 ${Math.round((freeMib / 1024) * 10) / 10} GiB，推荐 ${modelLabel}。`,
    reason
  };
}

function processTooltip(label, amount, processes) {
  const lines = [];
  if (!processes.length) {
    lines.push("无对应计算进程");
    return lines.join("\n");
  }
  processes.slice(0, 6).forEach((process) => {
    lines.push(
      `PID ${process.pid || "--"} · ${basename(process.name || "process")} · ${formatMib(process.used_mib)}`
    );
  });
  if (processes.length > 6) {
    lines.push(`另有 ${processes.length - 6} 个进程`);
  }
  return lines.join("\n");
}

async function loadLatestReport() {
  try {
    const reportsByMode = await api("/api/demo/latest-reports").catch(() => null);
    if (reportsByMode) {
      state.compareReports.baseline = reportsByMode.baseline || null;
      state.compareReports.vault = reportsByMode.vault || null;
      renderProofCompare();
    }
    const report = await api("/api/demo/latest-report");
    if (report.status && report.status === "empty") {
      return;
    }
    renderReport(report);
    if (report.events) {
      renderEvents(mergeDisplayEvents(report.events, report.run_id), report.status || "completed");
    }
    state.activeMode = report.mode;
    state.runId = report.run_id;
    setTopology(report.mode, report.status || "completed");
    $("#activeRun").textContent = report.run_id;
  } catch (_error) {
    // First launch has no report yet.
  }
}

async function refreshTimeline() {
  if (state.pollTimer || document.hidden) {
    return;
  }
  try {
    if (state.runId) {
      const payload = await api(`/api/demo/${encodeURIComponent(state.runId)}/events`);
      const events = mergeDisplayEvents(payload.events || [], state.runId);
      renderEvents(events, payload.status || "completed");
      setTopology(state.activeMode, payload.status || "completed");
      return;
    }
    const report = await api("/api/demo/latest-report");
    if (!report.status || report.status === "empty" || !report.events) {
      return;
    }
    state.activeMode = report.mode;
    state.runId = report.run_id;
    renderEvents(mergeDisplayEvents(report.events || [], report.run_id), report.status || "completed");
    setTopology(report.mode, report.status || "completed");
  } catch (_error) {
    // Timeline refresh is opportunistic; the main UI keeps its last known state.
  }
}

function selectDemoMode(mode) {
  state.modeSelected = true;
  state.activeMode = mode;
  setAskButtonEnabled(true, "选择预设问题后可模拟本地模型回答。");
  startRun(mode);
}

async function startRun(mode) {
  clearPoll();
  state.modeSelected = true;
  state.activeMode = mode;
  state.proofRunningMode = mode;
  setBusy(true);
  setTopology(mode, "running");
  resetReport(mode);
  updateDemoInteractionGate();
  const endpoint = mode === "vault" ? "/api/demo/vault" : "/api/demo/baseline";
  try {
    const run = await api(endpoint, {
      method: "POST",
      body: JSON.stringify({ document_ids: selectedDocumentIds() })
    });
    state.runId = run.run_id;
    state.localEvents = [];
    $("#activeRun").textContent = run.run_id;
    $("#runStatus").textContent = "运行中";
    $("#runStatus").className = "status-pill running";
    pollRun();
    state.pollTimer = window.setInterval(pollRun, 600);
  } catch (error) {
    setBusy(false);
    state.proofRunningMode = null;
    renderProofCompare();
    $("#runStatus").textContent = `启动失败：${error.message}`;
    $("#runStatus").className = "status-pill danger";
  }
}

async function pollRun() {
  if (!state.runId) {
    return;
  }
  try {
    const eventPayload = await api(`/api/demo/${state.runId}/events`);
    const incomingEvents = eventPayload.events || [];
    if (incomingEvents.length || !state.lastEvents.length) {
      renderEvents(mergeDisplayEvents(incomingEvents, state.runId), eventPayload.status || "running");
    }
    setTopology(state.activeMode, eventPayload.status || "running");

    if (eventPayload.status === "completed" || eventPayload.status === "failed") {
      clearPoll();
      setBusy(false);
      const report = await api(`/api/demo/${state.runId}/report`);
      renderReport(report);
      setTopology(report.mode, report.status);
      updateDemoInteractionGate();
    }
  } catch (error) {
    clearPoll();
    setBusy(false);
    state.proofRunningMode = null;
    renderProofCompare();
    $("#runStatus").textContent = `轮询失败：${error.message}`;
    $("#runStatus").className = "status-pill danger";
  }
}

async function askModel() {
  if (!(state.modeSelected || state.activeMode === "baseline" || state.activeMode === "vault")) {
    setAskButtonEnabled(false, "请先选择模拟运行方式：无保护模式或保险箱模式。");
    return;
  }
  const question = $("#questionInput").value.trim();
  if (!question) {
    return;
  }
  const firstLoad = isFirstModelLoad();
  appendMessage("user", "用户", question);
  const loadingNode = appendLoadingMessage(firstLoad);
  $("#askBtn").disabled = true;
  $("#modelState").textContent = firstLoad ? "首次加载中" : "模型思考中";
  try {
    const payload = await api("/api/model/ask", {
      method: "POST",
      body: JSON.stringify({
        question,
        document_ids: selectedDocumentIds(),
        mode: "vault"
      })
    });
    const backend = payload.model_backend || {};
    loadingNode.remove();
    appendModelAnswer(payload);
    const nextStatus = {
      ...(state.modelStatus || {}),
      ...backend,
      enabled: backend.enabled ?? state.modelStatus?.enabled ?? true,
      loaded: backend.real_model || backend.loaded,
      last_error: backend.error || backend.last_error
    };
    renderModelStatus(nextStatus);
    $("#modelState").textContent = payload.cache_verification.host_plaintext_found
      ? "发现风险"
      : "推理完成";
  } catch (error) {
    loadingNode.remove();
    appendMessage("system", "推理失败", error.message);
    $("#modelState").textContent = "失败";
  } finally {
    updateDemoInteractionGate();
  }
}

function appendMessage(kind, title, content) {
  const log = $("#chatLog");
  const node = document.createElement("div");
  node.className = `message ${kind}`;
  const strong = document.createElement("strong");
  const span = document.createElement("div");
  span.className = "message-body";
  strong.textContent = title;
  span.textContent = content;
  node.appendChild(strong);
  node.appendChild(span);
  log.appendChild(node);
  log.scrollTop = log.scrollHeight;
  return node;
}

function isFirstModelLoad() {
  const status = state.modelStatus || {};
  if (status.loaded || status.real_model) {
    return false;
  }
  if (status.enabled === false || status.last_error || status.error) {
    return false;
  }
  return true;
}

function appendLoadingMessage(firstLoad) {
  const log = $("#chatLog");
  const node = document.createElement("div");
  node.className = "message vault loading";
  const title = document.createElement("strong");
  const body = document.createElement("div");
  const spinner = document.createElement("span");
  const text = document.createElement("span");
  const hint = document.createElement("small");
  title.textContent = "本地 Qwen";
  body.className = "message-loading";
  spinner.className = "loading-spinner";
  spinner.setAttribute("aria-hidden", "true");
  text.textContent = "模型思考中";
  hint.className = "message-meta";
  hint.textContent = firstLoad
    ? "首次加载本地大模型到显存，通常需要等待 1 到 2 分钟。"
    : "正在读取已选文档上下文并生成回答。";
  body.appendChild(spinner);
  body.appendChild(text);
  node.appendChild(title);
  node.appendChild(body);
  node.appendChild(hint);
  log.appendChild(node);
  log.scrollTop = log.scrollHeight;
  return node;
}

function appendModelAnswer(payload) {
  const log = $("#chatLog");
  const backend = payload.model_backend || {};
  const snippets = (payload.retrieved_snippets || []).filter((snippet) => snippet.snippet);
  const node = document.createElement("div");
  node.className = "message vault";

  const title = document.createElement("strong");
  title.textContent = (backend.demo_mode || backend.static_demo)
    ? "本地 Qwen + 私有文档上下文（网页演示版）"
    : backend.real_model ? "本地 Qwen + 私有文档上下文" : "私有文档增强模型（降级）";
  node.appendChild(title);

  const body = document.createElement("div");
  body.className = "message-body";
  body.textContent = payload.vault_answer || "模型没有返回可展示文本。";
  node.appendChild(body);

  if (snippets.length) {
    const details = document.createElement("details");
    details.className = "message-sources";
    const summary = document.createElement("summary");
    summary.textContent = `引用依据 ${snippets.length} 条`;
    details.appendChild(summary);
    const list = document.createElement("div");
    list.className = "source-list";
    snippets.forEach((snippet, index) => {
      const item = document.createElement("div");
      item.className = "source-item";
      const name = document.createElement("strong");
      const meta = document.createElement("small");
      const text = document.createElement("p");
      name.textContent = `${index + 1}. ${snippet.title || snippet.document_id || "文档片段"}`;
      const terms = (snippet.matched_terms || []).join("、");
      meta.textContent = `相关度 ${snippet.relevance ?? "--"} · 命中词 ${terms || "字符匹配"}`;
      text.textContent = snippet.snippet;
      item.appendChild(name);
      item.appendChild(meta);
      item.appendChild(text);
      list.appendChild(item);
    });
    details.appendChild(list);
    node.appendChild(details);
  }

  const meta = document.createElement("small");
  meta.className = "message-meta";
  meta.textContent = modelMetaText(backend);
  node.appendChild(meta);
  log.appendChild(node);
  log.scrollTop = log.scrollHeight;
}

function modelMetaText(backend) {
  if (backend.demo_mode || backend.static_demo) {
    return `网页演示版预设回答 · ${basename(backend.model_id || "Qwen")} · 无需 GPU/后端服务`;
  }
  if (backend.real_model) {
    return `真实本地模型 · ${basename(backend.model_id || "Qwen")} · ${backend.device || "device"} · 输入 ${backend.input_tokens || "--"} tokens · 生成 ${backend.new_tokens || "--"} tokens · ${backend.generate_seconds || "--"}s`;
  }
  return `真实模型未完成，本次为规则降级 · ${backend.error || backend.last_error || "未知原因"}`;
}

function clearPoll() {
  if (state.pollTimer) {
    window.clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

function setTopology(mode, status) {
  const map = $("#topologyMap");
  map.classList.remove("idle", "baseline", "vault");
  map.classList.add(mode || "idle");
  setModeButtons(mode, status);
  if (mode === "baseline" || mode === "vault") {
    state.modeSelected = true;
    setAskButtonEnabled(true, "选择预设问题后可模拟本地模型回答。");
  }

  const statusPill = $("#runStatus");
  if (status === "running") {
    statusPill.textContent = mode === "baseline" ? "无保护运行中" : "保险箱运行中";
    statusPill.className = "status-pill running";
  } else if (mode === "baseline" && status === "completed") {
    statusPill.textContent = "无保护发现风险";
    statusPill.className = "status-pill danger";
  } else if (mode === "vault" && status === "completed") {
    statusPill.textContent = "保险箱验证通过";
    statusPill.className = "status-pill safe";
  } else if (status === "failed") {
    statusPill.textContent = "运行失败";
    statusPill.className = "status-pill danger";
  } else {
    statusPill.textContent = "待机";
    statusPill.className = "status-pill idle";
  }

  $("#cacheMode").textContent = mode === "vault" ? "加密缓存" : mode === "baseline" ? "未加密缓存风险" : "等待缓存事件";
  $("#keyState").textContent = mode === "vault" ? (status === "completed" ? "已销毁" : "运行期保留") : "未启用";
  updateTopologyVisual(state.lastEvents, mode, status);
}

function updateTopologyVisual(events, mode, status) {
  const nodes = document.querySelectorAll("[data-topology-node]");
  nodes.forEach((node) => node.classList.remove("active", "done", "risk"));

  const lastPhase = events && events.length ? events[events.length - 1].phase : null;
  const activeStage = topologyStages.find((stage) => stage.phase === lastPhase);
  const completedPhases = new Set((events || []).map((event) => event.phase));
  topologyStages.forEach((stage) => {
    if (stage.risk && mode !== "baseline") {
      return;
    }
    const isActive = activeStage && stage.phase === activeStage.phase && status === "running";
    const isDone = completedPhases.has(stage.phase) || (status === "completed" && !stage.risk);
    stage.nodes.forEach((key) => {
      const node = document.querySelector(`[data-topology-node="${key}"]`);
      if (!node) {
        return;
      }
      if (isActive) {
        node.classList.add("active");
      } else if (isDone) {
        node.classList.add("done");
      }
      if ((mode === "baseline" && stage.risk && (isActive || isDone)) || (mode === "baseline" && key === "cache" && isDone)) {
        node.classList.add("risk");
      }
    });
  });

  const fallbackStage = status === "completed"
    ? topologyStages.find((stage) => stage.phase === "验证报告")
    : null;
  const focus = activeStage || fallbackStage;
  $("#topologyStepBadge").textContent = focus ? (status === "completed" ? "完成" : "当前") : "待机";
  $("#topologyFocus").textContent = focus ? focus.label : "等待演示运行";
  $("#topologyFocusDetail").textContent = focus ? focus.detail : "点击保险箱模式或无保护模式后，模块会随执行阶段逐步高亮。";

  renderTopologySteps(completedPhases, activeStage, status);
}

function renderTopologySteps(completedPhases, activeStage, status) {
  const root = $("#topologySteps");
  if (!root) {
    return;
  }
  const displayStages = topologyStages.filter((stage) => stage.phase !== "不安全缓存");
  root.innerHTML = "";
  displayStages.forEach((stage, index) => {
    const chip = document.createElement("button");
    chip.type = "button";
    const active = activeStage && activeStage.phase === stage.phase && status === "running";
    const done = completedPhases.has(stage.phase) || status === "completed";
    chip.className = `topology-step ${active ? "active" : done ? "done" : ""}`;
    chip.dataset.phase = stage.phase;
    chip.title = `${stage.label}：${stage.detail}`;
    chip.setAttribute("aria-label", `${index + 1}. ${stage.label}`);
    chip.innerHTML = `
      <span>${index + 1}</span>
      <strong>${escapeHtml(stage.label)}</strong>
    `;
    chip.addEventListener("click", () => previewTopologyStage(stage));
    root.appendChild(chip);
  });
}

function previewTopologyStage(stage) {
  document.querySelectorAll("[data-topology-node]").forEach((node) => {
    node.classList.remove("active", "risk");
  });
  stage.nodes.forEach((key) => {
    const node = document.querySelector(`[data-topology-node="${key}"]`);
    if (node) {
      node.classList.add("active");
      if (stage.risk) {
        node.classList.add("risk");
      }
    }
  });
  $("#topologyStepBadge").textContent = "预览";
  $("#topologyFocus").textContent = stage.label;
  $("#topologyFocusDetail").textContent = stage.detail;
}

function resetReport(mode) {
  const reportMode = $("#reportMode");
  if (reportMode) {
    reportMode.textContent = mode === "vault" ? "保险箱" : "无保护";
  }
  $("#sentinelMetric").textContent = "待检测";
  $("#keyMetric").textContent = "待检测";
  $("#deviceMetric").textContent = "--";
  $("#lossMetric").textContent = "--";
  $("#adapterState").textContent = "训练中";
  state.currentReport = null;
  setVerifyButton(null, false);
  renderPendingChecks("训练运行中，完成后可手动发起安全检测。");
  $("#reportDetails").textContent = "训练运行中，尚未生成可检测的落盘结果。";
  $("#reportDetails").className = "report-details empty";
  renderProofCompare();
}

function renderReport(report) {
  state.currentReport = report;
  if (report?.mode === "baseline" || report?.mode === "vault") {
    state.compareReports[report.mode] = report;
    if (state.proofRunningMode === report.mode && report.status !== "running") {
      state.proofRunningMode = null;
    }
  }
  const modeName = report.mode === "vault" ? "保险箱" : "无保护";
  const verification = report.verification || null;
  const summary = verification?.summary || {};
  const reportMode = $("#reportMode");
  if (reportMode) {
    reportMode.textContent = modeName;
  }
  $("#sentinelMetric").textContent = verification
    ? summary.host_plaintext_found ? "检出" : "未检出"
    : "待检测";
  $("#keyMetric").textContent = verification
    ? summary.wrong_key_decrypt_failed === true
      ? "已拒绝"
      : summary.wrong_key_decrypt_failed === null
        ? "未适用"
        : "异常"
    : "待检测";
  $("#deviceMetric").textContent = report.training.device || "--";
  $("#lossMetric").textContent = report.training.loss_last === undefined ? "--" : String(report.training.loss_last);
  $("#adapterState").textContent = report.training.adapter_path ? basename(report.training.adapter_path) : "未生成";
  setVerifyButton(report, false);
  renderProofCompare();

  const metricEls = document.querySelectorAll(".report-panel .metric");
  metricEls.forEach((el) => el.classList.remove("good", "bad"));
  if (verification) {
    metricEls[0].classList.add(!summary.host_plaintext_found ? "good" : "bad");
    metricEls[1].classList.add(summary.wrong_key_decrypt_failed === true ? "good" : "bad");
    renderSecurityChecks(report);
  } else {
    renderPendingChecks("训练报告已生成，点击“进行检测”后重新扫描宿主机目录并验证缓存。");
  }

  const details = $("#reportDetails");
  details.className = "report-details";
  details.innerHTML = "";
  const dl = document.createElement("dl");
  const items = [
    ["Run ID", report.run_id],
    ["耗时", `${report.duration_ms} ms`],
    ["检测状态", verification ? `已检测 · ${verification.verified_at}` : "待手动检测"],
    ["检测耗时", verification ? `${verification.duration_ms} ms` : "未开始"],
    ["私有文档", `${(report.selected_documents || []).length} 份`],
    ["缓存文件", `${(summary.cache_files || report.cache_encryption.cache_files || []).length} 个`],
    ["错误密钥检测", verification ? verification.checks.find((check) => check.id === "wrong_key_rejection")?.result || "--" : "未开始"],
    ["密文熵值", summary.encrypted_entropy_bits_per_byte || report.cache_encryption.encrypted_entropy_bits_per_byte || "无"],
    ["模型适配参数", report.training.adapter_path || "无"],
    ["安全边界", report.safety_boundary]
  ];
  items.forEach(([key, value]) => {
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = key;
    dd.textContent = value;
    dl.appendChild(dt);
    dl.appendChild(dd);
  });
  details.appendChild(dl);
}

function renderSecurityChecks(report) {
  const root = $("#securityChecks");
  if (!root) {
    return;
  }
  const checks = report.verification?.checks || [];
  if (!checks.length) {
    renderPendingChecks("尚未执行检测。");
    return;
  }
  root.innerHTML = "";
  checks.forEach((check) => {
    const card = document.createElement("div");
    const stateClass = check.status === "pass" ? "pass" : check.status === "skip" ? "skip" : "risk";
    card.className = `security-check ${stateClass}`;
    const tooltip = `${check.method || "无检测方法说明"}\n${check.evidence || "无证据摘要"}`;
    card.dataset.tooltip = tooltip;
    card.setAttribute("aria-label", `${check.name}：${check.result}。${tooltip}`);
    card.innerHTML = `
      <div class="check-icon">${check.status === "pass" ? "✓" : check.status === "skip" ? "–" : "!"}</div>
      <div>
        <strong>${escapeHtml(check.name)}</strong>
        <span>${escapeHtml(check.result)}</span>
      </div>
    `;
    root.appendChild(card);
  });
}

function renderPendingChecks(message) {
  const root = $("#securityChecks");
  if (!root) {
    return;
  }
  const names = [
    "宿主机明文残留扫描",
    "缓存加密形态验证",
    "错误密钥拒绝验证",
    "模型适配参数归属验证",
    "审计报告完整性检查"
  ];
  root.innerHTML = "";
  names.forEach((name) => {
    const card = document.createElement("div");
    card.className = "security-check pending";
    card.dataset.tooltip = message;
    card.setAttribute("aria-label", `${name}：待检测。${message}`);
    card.innerHTML = `
      <div class="check-icon">…</div>
      <div>
        <strong>${escapeHtml(name)}</strong>
        <span>待检测</span>
      </div>
    `;
    root.appendChild(card);
  });
}

function setVerifyButton(report, running) {
  const button = $("#verifyBtn");
  if (!button) {
    return;
  }
  const hasMode = state.activeMode === "baseline" || state.activeMode === "vault";
  const canVerify = Boolean(report && report.run_id && report.status === "completed");
  button.disabled = running || !canVerify;
  const tooltip = !hasMode
    ? "请先选择模拟运行方式：无保护模式或保险箱模式。"
    : running
      ? "检测正在执行，请稍候。"
      : canVerify
        ? "点击后重新扫描宿主机明文残留、缓存形态和错误密钥状态。"
        : "请等待当前模拟运行完成并生成报告后再进行检测。";
  button.title = tooltip;
  button.dataset.tooltip = tooltip;
  button.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 12l2 2 4-5M12 3 5 6v5c0 4.5 3 8.5 7 10 4-1.5 7-5.5 7-10V6l-7-3Z" />
    </svg>
    ${running ? "检测中" : "进行检测"}
  `;
}

async function runVerification() {
  const report = state.currentReport;
  const runId = state.runId || report?.run_id;
  if (!(state.modeSelected || state.activeMode === "baseline" || state.activeMode === "vault") || !runId || !report || report.status !== "completed") {
    setVerifyButton(report || null, false);
    return;
  }
  appendLocalEvent({
    run_id: runId,
    ts: new Date().toISOString(),
    phase: "验证报告",
    event_type: "manual_verification",
    source: "web-console",
    target: "宿主机临时目录 + 移动保险箱",
    action: "run_security_checks",
    status: "running",
    detail: "用户点击进行检测，重新扫描宿主机明文残留、缓存加密形态、错误密钥拒绝和报告完整性。"
  });
  setVerifyButton(report, true);
  $("#sentinelMetric").textContent = "检测中";
  $("#keyMetric").textContent = "检测中";
  renderPendingChecks("正在重新扫描宿主机临时目录、校验缓存形态和错误密钥。");
  $("#reportDetails").textContent = "检测执行中，请稍候。";
  $("#reportDetails").className = "report-details empty";
  try {
    const verifiedReport = await api(`/api/demo/${encodeURIComponent(runId)}/verify`, {
      method: "POST"
    });
    renderReport(verifiedReport);
    appendLocalEvent({
        run_id: runId,
        ts: new Date().toISOString(),
        phase: "验证报告",
        event_type: "manual_verification",
        source: "verification-engine",
        target: "reports",
        action: "security_checks_completed",
        status: "ok",
        detail: "安全检测完成，风险检测模块已更新宿主机明文残留、缓存加密形态、错误密钥拒绝和审计报告状态。"
    });
    renderEvents(mergeDisplayEvents(verifiedReport.events || [], runId), verifiedReport.status || "completed");
  } catch (error) {
    setVerifyButton(report, false);
    appendLocalEvent({
      run_id: runId,
      ts: new Date().toISOString(),
      phase: "验证报告",
      event_type: "manual_verification",
      source: "verification-engine",
      target: "reports",
      action: "security_checks_failed",
      status: "failed",
      detail: error.message
    });
    $("#reportDetails").textContent = `检测失败：${error.message}`;
    $("#reportDetails").className = "report-details empty";
  }
}

function renderEvents(events, status) {
  rememberExpandedEvents();
  state.lastEvents = events;
  const list = $("#eventList");
  const previousScrollTop = list ? list.scrollTop : 0;
  const previousScrollLeft = list ? list.scrollLeft : 0;
  if (!events.length) {
    list.innerHTML = `<div class="event-empty">暂无运行事件</div>`;
  } else {
    list.innerHTML = "";
    events.slice(-32).reverse().forEach((event) => {
      const eventKey = eventIdentity(event);
      const row = document.createElement("details");
      row.className = `event-row ${event.status || "ok"}`;
      row.dataset.eventKey = eventKey;
      row.open = state.expandedEventKeys.has(eventKey);
      row.innerHTML = `
        <summary>
          <time></time>
          <div class="event-phase"></div>
          <div class="event-action"></div>
          <div class="event-status"></div>
        </summary>
        <div class="event-detail-panel">
          <dl>
            <dt>事件名</dt><dd class="event-name"></dd>
            <dt>事件阶段</dt><dd class="event-zone"></dd>
            <dt>事件类型</dt><dd class="event-type"></dd>
            <dt>事件区域 / 流向</dt><dd class="event-route"></dd>
            <dt>执行动作</dt><dd class="event-raw-action"></dd>
            <dt>细节内容</dt><dd class="event-full-detail"></dd>
          </dl>
        </div>
      `;
      row.querySelector("time").textContent = event.ts || "";
      row.querySelector(".event-phase").textContent = displayPhaseLabel(event.phase);
      const statusEl = row.querySelector(".event-status");
      statusEl.textContent = eventStatusText(event.status);
      statusEl.classList.add(event.status || "");
      row.querySelector(".event-action").textContent = eventCoreText(event);
      row.querySelector(".event-name").textContent = eventCoreText(event);
      row.querySelector(".event-zone").textContent = displayPhaseLabel(event.phase);
      row.querySelector(".event-type").textContent = event.event_type || "--";
      row.querySelector(".event-route").textContent = `${event.source || "--"} → ${event.target || "--"}`;
      row.querySelector(".event-raw-action").textContent = event.action || "--";
      row.querySelector(".event-full-detail").textContent = event.detail || "--";
      list.appendChild(row);
    });
  }
  list.scrollTop = previousScrollTop;
  list.scrollLeft = previousScrollLeft;
  updatePhases(events, status);
  updateTopologyVisual(events, state.activeMode, status);
}

function appendLocalEvent(event) {
  state.localEvents = [...(state.localEvents || []), event];
  const serverEvents = (state.lastEvents || []).filter((item) => !item.local_only);
  renderEvents(mergeDisplayEvents(serverEvents, event.run_id), "running");
}

function mergeDisplayEvents(serverEvents, runId) {
  const local = (state.localEvents || []).filter((event) => !runId || event.run_id === runId);
  const seen = new Set();
  return [...serverEvents, ...local].filter((event) => {
    const key = eventIdentity(event);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function rememberExpandedEvents() {
  const list = $("#eventList");
  if (!list) {
    return;
  }
  list.querySelectorAll(".event-row").forEach((row) => {
    const key = row.dataset.eventKey;
    if (!key) {
      return;
    }
    if (row.open) {
      state.expandedEventKeys.add(key);
    } else {
      state.expandedEventKeys.delete(key);
    }
  });
}

function eventIdentity(event) {
  return [
    event.run_id || "",
    event.ts || "",
    event.phase || "",
    event.event_type || "",
    event.action || "",
    event.source || "",
    event.target || ""
  ].join("|");
}

function displayPhaseLabel(phase) {
  const phaseMap = {
    "隔离环境初始化": "接入私有数据",
    "加密卸载": "缓存加密暂存",
    "不安全缓存": "未加密缓存对照",
    "结果回写": "结果保存",
    "安全退出": "安全移除准备"
  };
  return phaseMap[phase] || phase || "--";
}

function eventStatusText(status) {
  if (status === "running") {
    return "进行中";
  }
  if (status === "ok") {
    return "完成";
  }
  if (status === "warning") {
    return "风险";
  }
  if (status === "failed") {
    return "失败";
  }
  return status || "记录";
}

function eventCoreText(event) {
  const epochMatch = String(event.detail || "").match(/epoch\s+(\d+)/i);
  const epochPrefix = epochMatch ? `epoch ${epochMatch[1]} ` : "";
  if (event.action === "write_plaintext_cache") {
    return `${epochPrefix}未加密缓存写入宿主机`;
  }
  if (event.action === "aes_gcm_encrypt_and_offload") {
    return `${epochPrefix}缓存加密后临时存放`;
  }
  const actionMap = {
    probe_resources: "检测宿主机算力资源",
    mount_private_dataset: "接入私有数据区",
    create_session_key: "生成本次运行密钥",
    use_plaintext_cache: "启用未加密缓存对照",
    start_toy_lora: "启动后台模型适配验证",
    aes_gcm_encrypt_and_offload: "缓存加密后临时存放",
    write_plaintext_cache: "未加密缓存写入宿主机",
    persist_adapter: "模型适配参数保存回移动保险箱",
    zeroize_session_key: "销毁本次运行密钥",
    inspect_plaintext: "检查宿主机明文残留",
    scan_plaintext: "扫描敏感标记",
    record_failure: "记录失败报告"
  };
  return actionMap[event.action] || event.detail || event.action || event.event_type || "记录事件";
}

function renderProofCompare() {
  const root = $("#fileFlow");
  if (!root) {
    return;
  }
  const activeMode = state.activeMode || "";
  const baselineCards = proofCardsForMode("baseline", state.compareReports.baseline);
  const vaultCards = proofCardsForMode("vault", state.compareReports.vault);
  root.innerHTML = `
    ${proofSectionHtml({
      kind: "baseline",
      title: "无保护模式",
      subtitle: "作为风险基线：展示敏感数据直接进入宿主机临时盘时的残留问题。",
      active: activeMode === "baseline" || state.proofRunningMode === "baseline",
      running: state.proofRunningMode === "baseline",
      badge: state.proofRunningMode === "baseline"
        ? "运行中"
        : state.compareReports.baseline
          ? activeMode === "baseline" ? "当前选择" : "最近结果"
          : "等待运行",
      cards: baselineCards
    })}
    ${proofSectionHtml({
      kind: "vault",
      title: "保险箱模式",
      subtitle: "目标链路：数据留在移动保险箱，宿主机只提供算力，中间缓存加密暂存。",
      active: activeMode === "vault" || state.proofRunningMode === "vault",
      running: state.proofRunningMode === "vault",
      badge: state.proofRunningMode === "vault"
        ? "运行中"
        : state.compareReports.vault
          ? activeMode === "vault" ? "当前选择" : "最近结果"
          : "等待运行",
      cards: vaultCards
    })}
  `;
}

function proofCardsForMode(mode, report) {
  const isRunning = state.proofRunningMode === mode;
  const verification = report?.verification || null;
  const summary = verification?.summary || {};
  const cache = report?.cache_encryption || {};
  const sentinel = report?.sentinel || {};
  const hostPlaintext = verification
    ? Boolean(summary.host_plaintext_found)
    : sentinel.host_plaintext_found === undefined
      ? null
      : Boolean(sentinel.host_plaintext_found);
  const hostHits = summary.host_plaintext_hits || sentinel.host_plaintext_hits || [];
  const encryptedFiles = summary.encrypted_cache_files || cache.encrypted_cache_files || [];
  const plaintextFiles = summary.plaintext_cache_files || cache.plaintext_cache_files || [];
  const wrongKey = verification
    ? summary.wrong_key_decrypt_failed
    : cache.wrong_key_decrypt_failed ?? null;
  const adapterPath = report?.training?.adapter_path || "";

  if (mode === "baseline") {
    return [
      {
        label: "宿主机明文残留",
        status: hostPlaintext === true ? "risk" : hostPlaintext === false ? "pass" : "pending",
        value: hostPlaintext !== null
          ? hostPlaintext ? `检出 ${hostHits.length || 1} 处敏感明文` : "未检出明文"
          : isRunning ? "运行中" : "等待无保护对照",
        detail: "对照组用于展示敏感样本或缓存直接落入宿主机临时目录时的残留风险。"
      },
      {
        label: "缓存形态",
        status: plaintextFiles.length ? "risk" : encryptedFiles.length ? "pass" : "pending",
        value: plaintextFiles.length ? `未加密缓存 ${plaintextFiles.length} 个` : encryptedFiles.length ? `加密缓存 ${encryptedFiles.length} 个` : isRunning ? "运行中" : "等待检测",
        detail: "无保护模式下，中间缓存不经过 AES-GCM 封装，风险更容易被扫描结果证明。"
      },
      {
        label: "结论",
        status: hostPlaintext === true ? "risk" : hostPlaintext === false ? "pass" : "pending",
        value: hostPlaintext === true ? "存在泄露风险" : hostPlaintext === false ? "暂未检出风险" : isRunning ? "运行中" : "作为风险基线",
        detail: "该模式不是推荐方案，而是用于证明外置存储保险箱方案的改进幅度。"
      }
    ];
  }

  return [
    {
      label: "宿主机明文残留",
      status: hostPlaintext === false ? "pass" : hostPlaintext === true ? "risk" : "pending",
      value: hostPlaintext !== null
        ? hostPlaintext ? "检出敏感明文" : "未检出敏感明文"
        : isRunning ? "运行中" : "等待保险箱运行",
      detail: "保险箱模式目标是让宿主机临时目录不保留私有样本或敏感标记明文。"
    },
    {
      label: "加密缓存",
      status: encryptedFiles.length ? "pass" : plaintextFiles.length ? "risk" : "pending",
      value: encryptedFiles.length ? `加密缓存 ${encryptedFiles.length} 个` : plaintextFiles.length ? "存在未加密缓存" : isRunning ? "运行中" : "等待检测",
      detail: "中间缓存可临时进入宿主机临时目录，但应以加密形式存在。"
    },
    {
      label: "错误密钥验证",
      status: wrongKey === true ? "pass" : wrongKey === false ? "risk" : "pending",
      value: wrongKey !== null
        ? wrongKey ? "错误密钥已拒绝" : "错误密钥异常"
        : isRunning ? "运行中" : "等待检测",
      detail: "错误密钥不能解开缓存，用于证明缓存不是简单混淆或明文改名。"
    },
    {
      label: "产物归属",
      status: adapterPath ? "pass" : "pending",
      value: adapterPath ? `参数文件位于 ${basename(adapterPath)}` : isRunning ? "运行中" : "等待产物",
      detail: "模型适配参数和审计报告应保存回移动保险箱，而不是留在宿主机临时盘。"
    }
  ];
}

function proofSectionHtml(section) {
  return `
    <section class="proof-section ${section.kind} ${section.active ? "active" : ""}">
      <div class="proof-section-head">
        <strong>${escapeHtml(section.title)}</strong>
        <span>${escapeHtml(section.badge || "等待运行")}</span>
      </div>
      <p>${escapeHtml(section.subtitle)}</p>
      <div class="proof-items">
        ${section.cards.map((card) => `
          <div class="proof-item ${card.status}">
            <span>${escapeHtml(card.label)}</span>
            <strong>${escapeHtml(card.value)}</strong>
            <small>${escapeHtml(card.detail)}</small>
          </div>
        `).join("")}
      </div>
    </section>
  `;
}

function renderFileFlow() {
  renderProofCompare();
}

function updatePhases(events, status) {
  const lastPhase = events.length ? events[events.length - 1].phase : null;
  const phaseSummary = $("#phaseSummary");
  if (phaseSummary) {
    phaseSummary.textContent = lastPhase ? displayPhaseLabel(lastPhase) : "等待演示运行";
  }
}

function basename(path) {
  if (!path) {
    return "";
  }
  return String(path).split("/").filter(Boolean).pop() || path;
}

function isDetailsPageActive() {
  const details = $("#detailsPage");
  if (!details) {
    return false;
  }
  return window.scrollY >= details.offsetTop - window.innerHeight * 0.35;
}

function updatePageFlipButton() {
  const button = $("#pageFlipBtn");
  const icon = $("#pageFlipIcon path");
  const text = $("#pageFlipText");
  if (!button || !icon || !text) {
    return;
  }
  const detailsActive = isDetailsPageActive();
  button.dataset.target = detailsActive ? "home" : "details";
  button.setAttribute("aria-label", detailsActive ? "向上翻页" : "向下翻页");
  button.title = detailsActive ? "向上翻页" : "向下翻页";
  text.textContent = detailsActive ? "上一页" : "下一页";
  icon.setAttribute("d", detailsActive ? "M18 15l-6-6-6 6" : "M6 9l6 6 6-6");
}

function flipPage() {
  const target = isDetailsPageActive() ? $("#homePage") : $("#detailsPage");
  if (!target) {
    return;
  }
  target.scrollIntoView({ behavior: "smooth", block: "start" });
  window.setTimeout(updatePageFlipButton, 420);
}

$("#baselineBtn").addEventListener("click", () => selectDemoMode("baseline"));
$("#vaultBtn").addEventListener("click", () => selectDemoMode("vault"));
$("#refreshHardware").addEventListener("click", loadHardware);
$("#runtimeEditBtn").addEventListener("click", toggleRuntimeEditing);
$("#runtimeApplyBtn").addEventListener("click", applyRuntimeConfig);
$("#runtimeConfigPanel").addEventListener("change", (event) => {
  const choice = event.target.closest(".gpu-choice");
  if (choice && event.target.matches("input[type='checkbox']")) {
    choice.classList.toggle("active", event.target.checked);
  }
  if (state.runtimeEditing && event.target.matches("input, select")) {
    syncRuntimeDraftFromForm();
    renderRuntimeConfig(state.runtimeConfig);
    renderHardware(mockHardware());
  }
});
$("#eventList").addEventListener("toggle", (event) => {
  const row = event.target.closest(".event-row");
  if (!row || !row.dataset.eventKey) {
    return;
  }
  if (row.open) {
    state.expandedEventKeys.add(row.dataset.eventKey);
  } else {
    state.expandedEventKeys.delete(row.dataset.eventKey);
  }
}, true);
$("#verifyBtn").addEventListener("click", runVerification);
$("#refreshDocsBtn").addEventListener("click", loadDocuments);
$("#pickFileBtn").addEventListener("click", openMockUploadDialog);
$("#filePicker").addEventListener("change", (event) => {
  const file = event.target.files && event.target.files[0];
  if (file) {
    savePickedFile(file);
  }
  event.target.value = "";
});
$("#saveDocBtn").addEventListener("click", saveTypedDocument);
$("#askBtn").addEventListener("click", askModel);
$("#sampleQuestionBtn").addEventListener("click", () => {
  const current = $("#questionInput").value;
  const questions = staticDemo.questions.map((item) => item.question);
  const next = questions[(questions.indexOf(current) + 1) % questions.length] || questions[0];
  $("#questionInput").value = next;
  document.querySelectorAll(".preset-question").forEach((button) => {
    button.classList.toggle("active", button.dataset.question === next);
  });
  $("#questionInput").focus();
});
$("#presetQuestionBank")?.addEventListener("click", (event) => {
  const button = event.target.closest(".preset-question");
  if (!button) {
    return;
  }
  $("#questionInput").value = button.dataset.question || "";
  document.querySelectorAll(".preset-question").forEach((item) => item.classList.remove("active"));
  button.classList.add("active");
});
$("#mockUploadChoices")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-upload-id]");
  if (button) {
    saveMockUpload(button.dataset.uploadId);
  }
});
$("#pageFlipBtn").addEventListener("click", flipPage);
window.addEventListener("scroll", updatePageFlipButton, { passive: true });
window.addEventListener("resize", updatePageFlipButton);
document.addEventListener("pointerover", (event) => {
  const target = event.target.closest("[data-tooltip]");
  if (target) {
    showGlobalTooltip(target);
  }
});
document.addEventListener("pointerout", (event) => {
  if (!activeTooltipTarget) {
    return;
  }
  const nextTarget = event.relatedTarget;
  if (!nextTarget || !activeTooltipTarget.contains(nextTarget)) {
    hideGlobalTooltip();
  }
});
document.addEventListener("focusin", (event) => {
  const target = event.target.closest("[data-tooltip]");
  if (target) {
    showGlobalTooltip(target);
  }
});
document.addEventListener("focusout", hideGlobalTooltip);
window.addEventListener("scroll", positionGlobalTooltip, { passive: true });
window.addEventListener("resize", positionGlobalTooltip);

renderPresetQuestions();
renderMockUploadChoices();
restoreRuntimeRestartState();
loadHardware();
state.hardwareTimer = window.setInterval(loadHardware, 5000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    loadHardware();
  }
});
loadModelStatus();
loadDocuments();
renderFileFlow([], "等待运行");
updateDemoInteractionGate();
loadLatestReport();
state.eventRefreshTimer = window.setInterval(refreshTimeline, 3000);
updatePageFlipButton();
