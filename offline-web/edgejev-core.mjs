import { Tokenizer } from "@huggingface/tokenizers";

export const QTYPES = { choice: 0, score: 1, noul: 2 };

export const ABP_QUESTIONS = {
  next_step: {
    type: "choice",
    instructions: "对这条输入，下一步最合适的执行方式是什么？",
    criteria: {
      act_now: "可以立刻执行一个明确、可逆的下一步",
      clarify: "缺少会改变行动的关键事实，需要先问一个最小问题",
      schedule: "不必现在执行，更适合进入待办或安排到稍后",
      no_action: "不需要采取行动"
    }
  },
  work_mode: {
    type: "choice",
    instructions: "这条输入主要属于哪种工作模式？",
    criteria: {
      study: "学习、课程、作业、考试",
      admin: "行政、表单、预约、证件、日程",
      communication: "需要回复、沟通、跟进他人",
      research: "需要查证、比较、研究、形成判断",
      coding: "代码、系统、自动化、部署、调试",
      personal: "个人生活、日常安排、自我管理",
      other: "其他"
    }
  },
  urgency: {
    type: "score",
    instructions: "这条输入需要多快处理？",
    criteria: [
      "可以等待，不影响近期结果",
      "今天或近期处理更好",
      "应优先处理，存在明显时效性",
      "现在就应处理，否则可能错过截止期或造成损失"
    ]
  },
  effort: {
    type: "score",
    instructions: "完成下一步需要多大连续注意力？",
    criteria: [
      "两分钟内可完成",
      "约五到二十分钟",
      "需要一段专注时间",
      "需要多步骤计划或较长执行"
    ]
  },
  external_commitment: {
    type: "noul",
    instructions: "下一步是否涉及发送、提交、支付、购买、删除、公开发布、修改安全设置、金融交易、生产破坏性操作或其他外部绑定行为？"
  }
};

export function createTokenizer(tokenizerJson, tokenizerConfig = {}) {
  return new Tokenizer(tokenizerJson, tokenizerConfig);
}

function ids(tokenizer, text) {
  return tokenizer.encode(String(text), { add_special_tokens: false }).ids;
}

function serializeState(state) {
  return typeof state === "string" ? state : JSON.stringify(state);
}

function toInternal(q) {
  let crit = q.criteria;
  if (q.type === "choice" && Array.isArray(crit)) {
    crit = Object.fromEntries(crit.map((x) => [x, null]));
  }
  return { t: q.type, ins: String(q.instructions), crit };
}

function renderCriterion(v) {
  return typeof v === "string" ? v : JSON.stringify(v);
}

function renderOptions(q) {
  if (q.t === "choice") {
    return Object.entries(q.crit).map(([k, v]) =>
      v == null || v === "" ? k : `${k}: ${renderCriterion(v)}`
    );
  }
  if (q.t === "score") {
    return q.crit.map((c, i) => `level ${i}: ${renderCriterion(c)}`);
  }
  const crit = q.crit || {};
  return [
    `false: ${crit.false == null || crit.false === "" ? "no, the statement does not hold" : renderCriterion(crit.false)}`,
    `true: ${crit.true == null || crit.true === "" ? "yes, the statement holds" : renderCriterion(crit.true)}`
  ];
}

export function prepareLaya(tokenizer, state, questions, cfg = {}) {
  const maxLen = cfg.max_len ?? 1024;
  const headMaxLen = cfg.head_max_len ?? 256;
  const clsId = cfg.cls_id ?? 2;
  const sepId = cfg.sep_id ?? 1;
  const maskId = cfg.mask_id ?? 4;
  const padId = cfg.pad_id ?? 0;
  const maskToken = cfg.mask_token ?? "<mask>";
  const rows = [];

  for (const q0 of questions) {
    const q = toInternal(q0);
    const opts = renderOptions(q);
    const ins = q.ins.replaceAll(maskToken, " ");
    let headIds = ids(tokenizer, `${q.t} question: ${ins}`);
    let optIds = opts.map((o) => [
      maskId,
      ...ids(tokenizer, " " + o.replaceAll(maskToken, " ")).slice(0, 48)
    ]);

    let budget = headMaxLen - optIds.reduce((n, a) => n + a.length, 0);
    if (budget < 16) {
      const per = Math.max(4, Math.floor((headMaxLen - 16) / Math.max(1, optIds.length)));
      optIds = optIds.map((o) => o.slice(0, per));
      budget = headMaxLen - optIds.reduce((n, a) => n + a.length, 0);
    }
    headIds = headIds.slice(0, Math.max(8, budget));

    let seq = [clsId, ...headIds, sepId];
    const markers = [];
    for (const o of optIds) {
      markers.push(seq.length);
      seq.push(...o);
    }
    seq.push(sepId);
    const room = Math.max(0, maxLen - seq.length - 1);
    seq = [
      ...seq,
      ...ids(tokenizer, serializeState(state).replaceAll(maskToken, " ")).slice(0, room),
      sepId
    ].slice(0, maxLen);

    const validMarkers = markers.filter((m) => m < maxLen);
    if (validMarkers.length !== opts.length) {
      throw new Error(`options exceed head_max_len=${headMaxLen}`);
    }
    rows.push({ seq, markers: validMarkers, qtype: QTYPES[q.t], q });
  }

  const n = rows.length;
  const L = Math.max(...rows.map((r) => r.seq.length));
  const K = Math.max(...rows.map((r) => r.markers.length));
  const input_ids = Array.from({ length: n }, () => Array(L).fill(padId));
  const attention_mask = Array.from({ length: n }, () => Array(L).fill(0));
  const marker_pos = Array.from({ length: n }, () => Array(K).fill(0));
  const marker_mask = Array.from({ length: n }, () => Array(K).fill(false));
  const qtype = [];

  for (let i = 0; i < n; i++) {
    const r = rows[i];
    for (let j = 0; j < r.seq.length; j++) {
      input_ids[i][j] = r.seq[j];
      attention_mask[i][j] = 1;
    }
    for (let j = 0; j < r.markers.length; j++) {
      marker_pos[i][j] = r.markers[j];
      marker_mask[i][j] = true;
    }
    qtype.push(r.qtype);
  }

  return {
    feed: { input_ids, attention_mask, marker_pos, marker_mask, qtype },
    k: rows.map((r) => r.markers.length),
    questions: rows.map((r) => r.q),
    input_tokens: attention_mask.flat().reduce((a, b) => a + b, 0)
  };
}

function softmax(z) {
  const m = Math.max(...z);
  const e = z.map((x) => Math.exp(x - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((x) => x / s);
}

function entropyConfidence(p) {
  if (p.length < 2) return 1;
  let ent = 0;
  for (const x of p) ent -= x * Math.log(Math.max(1e-12, Math.min(1, x)));
  return Math.max(0, Math.min(1, 1 - ent / Math.log(p.length)));
}

function binaryConfidence(p) {
  return Math.max(p[1], 1 - p[1]);
}

function round4(x) {
  return Math.round(x * 10000) / 10000;
}

export function prepareRequest(tokenizer, state, questionMap, cfg = {}) {
  const qids = Object.keys(questionMap);
  const prep = prepareLaya(tokenizer, state, qids.map((id) => questionMap[id]), cfg);
  prep.questionMap = questionMap;
  prep.qids = qids;
  return prep;
}

export function assemble(prep, logits, temperature = [1, 1, 1]) {
  const answers = {};
  for (let r = 0; r < prep.questions.length; r++) {
    const q = prep.questions[r];
    const k = prep.k[r];
    const qtype = QTYPES[q.t];
    const p = softmax(logits[r].slice(0, k).map((x) => x / Math.max(1e-3, temperature[qtype])));
    const conf = round4(q.t === "noul" ? binaryConfidence(p) : entropyConfidence(p));
    const qid = prep.qids[r];

    if (q.t === "choice") {
      const keys = Object.keys(q.crit);
      let best = 0;
      for (let i = 1; i < p.length; i++) if (p[i] > p[best]) best = i;
      answers[qid] = {
        type: "choice",
        choice: keys[best],
        probabilities: Object.fromEntries(keys.map((x, i) => [x, round4(p[i])])),
        confidence: conf
      };
    } else if (q.t === "score") {
      answers[qid] = {
        type: "score",
        score: round4(p.reduce((s, x, i) => s + i * x, 0)),
        legend: Object.fromEntries(q.crit.map((x, i) => [String(i), x])),
        probabilities: Object.fromEntries(p.map((x, i) => [String(i), round4(x)])),
        confidence: conf
      };
    } else {
      answers[qid] = { type: "noul", noul: round4(p[1]), confidence: conf };
    }
  }
  return answers;
}

export function toHumanMcp(result) {
  const a = result.answers || {};
  const commitment = a.external_commitment?.noul;
  return {
    protocol: "human-mcp/0.1",
    next_step: a.next_step?.choice ?? null,
    work_mode: a.work_mode?.choice ?? null,
    urgency: typeof a.urgency?.score === "number" ? a.urgency.score : null,
    effort: typeof a.effort?.score === "number" ? a.effort.score : null,
    requires_confirmation: typeof commitment === "number" ? commitment >= 0.5 : null,
    external_commitment_probability: typeof commitment === "number" ? commitment : null,
    model: result.model ?? "rl-agent"
  };
}

export function directiveText(directive) {
  const mode = directive.work_mode || "other";
  if (directive.next_step === "clarify") {
    return "停。先补齐一个会改变行动的关键事实，只写一句，然后重新提交。";
  }
  if (directive.next_step === "schedule") {
    return "现在不要切过去做。把这件事安排到一个具体时间，并回到当前任务。";
  }
  if (directive.next_step === "no_action") {
    return "这件事先不处理。关闭它，回到当前正在做的事情。";
  }
  if (directive.requires_confirmation) {
    return "先不要执行外部动作。确认对象、内容和后果无误后，再由你手动确认执行。";
  }

  const urgency = directive.urgency ?? 0;
  const effort = directive.effort ?? 0;
  const lead = urgency >= 2.3 ? "现在处理。" : "开始处理。";
  const focus = effort >= 2.2
    ? "先定义唯一的下一步，并连续做二十分钟；期间不要切换任务。"
    : effort >= 1
      ? "只做一个能在十分钟内推进的动作，做完再回来。"
      : "用两分钟完成最小动作，完成前不要打开新的任务。";
  const modeHint = mode === "communication"
    ? "如果这是要发给别人的内容，先写好草稿，不要直接发送。"
    : mode === "study"
      ? "不要继续整理资料，直接推进可提交的内容。"
      : mode === "research"
        ? "先验证一个最可能改变结论的事实。"
        : mode === "coding"
          ? "先跑出一个可观察结果，再改下一处。"
          : mode === "admin"
            ? "先完成会阻塞后续的那一步。"
            : "";
  return [lead, focus, modeHint].filter(Boolean).join("");
}
