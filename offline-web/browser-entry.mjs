import {
  ABP_QUESTIONS,
  createTokenizer,
  prepareRequest,
  assemble,
  toHumanMcp,
  directiveText
} from "./edgejev-core.mjs";

const pending = new Map();
let seq = 0;
let tokenizer = null;
let cfg = null;
let initializing = null;

globalThis.__nativeResult = (id, ok, payload) => {
  const item = pending.get(String(id));
  if (!item) return;
  pending.delete(String(id));
  if (ok) item.resolve(payload);
  else item.reject(new Error(String(payload || "本地推理失败")));
};

function invokeNative(action, data) {
  const native = globalThis.TerminalNative;
  if (!native) return Promise.reject(new Error("Android 本地桥接未加载"));
  return new Promise((resolve, reject) => {
    const id = String(++seq);
    pending.set(id, { resolve, reject });
    try { native.invoke(id, action, JSON.stringify(data || {})); }
    catch (e) { pending.delete(id); reject(e); }
  });
}

async function loadJson(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error("无法读取离线资源: " + path);
  return response.json();
}

export async function init() {
  if (tokenizer && cfg) return true;
  if (initializing) return initializing;
  initializing = (async () => {
    const [tokenizerJson, config] = await Promise.all([
      loadJson("./model/tokenizer.json"),
      loadJson("./model/edgejev.json")
    ]);
    tokenizer = createTokenizer(tokenizerJson, {});
    cfg = config;
    return true;
  })();
  try { return await initializing; }
  finally { initializing = null; }
}

export async function decide(text) {
  const state = String(text || "").trim();
  if (!state) throw new Error("先写下你现在需要推进的事情。");
  if (Array.from(state).length > 600) throw new Error("输入请控制在 600 字以内。");
  await init();

  const prep = prepareRequest(tokenizer, state, ABP_QUESTIONS, cfg);
  const nativeResult = await invokeNative("infer", { feed: prep.feed });
  if (!nativeResult || !Array.isArray(nativeResult.logits)) {
    throw new Error("本地模型没有返回有效 logits。");
  }

  const answers = assemble(prep, nativeResult.logits, cfg.temperature || [1,1,1]);
  const result = {
    model: cfg.model_name || "rl-agent",
    answers,
    usage: { input_tokens: prep.input_tokens, output_tokens: 0 }
  };
  const directive = toHumanMcp(result);
  return {
    protocol: "abp/offline-0.1",
    input: state,
    directive,
    command: directiveText(directive),
    decision: result
  };
}

globalThis.OfflineAgent = { init, decide };
globalThis.dispatchEvent(new Event("offline-agent-loaded"));
