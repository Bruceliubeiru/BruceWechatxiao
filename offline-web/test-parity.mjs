import fs from "node:fs";
import { spawnSync } from "node:child_process";
import * as ort from "onnxruntime-node";
import {
  ABP_QUESTIONS,
  createTokenizer,
  prepareRequest,
  assemble,
  toHumanMcp,
  directiveText
} from "./edgejev-core.mjs";

const modelDir = process.env.EDGEJEV_MODEL_DIR || "./jev-int8";
const tokenizerJson = JSON.parse(fs.readFileSync(modelDir + "/tokenizer.json", "utf8"));
const cfg = JSON.parse(fs.readFileSync(modelDir + "/edgejev.json", "utf8"));
const tokenizer = createTokenizer(tokenizerJson, {});

const state = "我十分钟后要出门，但报告还没发给老师。";
const prep = prepareRequest(tokenizer, state, ABP_QUESTIONS, cfg);

function tensorInt64_2d(rows) {
  const n = rows.length;
  const m = rows[0].length;
  return new ort.Tensor("int64", BigInt64Array.from(rows.flat().map((x) => BigInt(x))), [n, m]);
}
function tensorBool_2d(rows) {
  const n = rows.length;
  const m = rows[0].length;
  return new ort.Tensor("bool", Uint8Array.from(rows.flat().map((x) => x ? 1 : 0)), [n, m]);
}
function tensorInt64_1d(xs) {
  return new ort.Tensor("int64", BigInt64Array.from(xs.map((x) => BigInt(x))), [xs.length]);
}

const session = await ort.InferenceSession.create(modelDir + "/model.onnx", {
  executionProviders: ["cpu"]
});

const outputs = await session.run({
  input_ids: tensorInt64_2d(prep.feed.input_ids),
  attention_mask: tensorInt64_2d(prep.feed.attention_mask),
  marker_pos: tensorInt64_2d(prep.feed.marker_pos),
  marker_mask: tensorBool_2d(prep.feed.marker_mask),
  qtype: tensorInt64_1d(prep.feed.qtype)
});

const firstName = session.outputNames[0];
const logitsTensor = outputs[firstName];
const n = logitsTensor.dims[0];
const k = logitsTensor.dims[1];
const flat = Array.from(logitsTensor.data);
const logits = Array.from({ length: n }, (_, i) => flat.slice(i * k, (i + 1) * k));
const answers = assemble(prep, logits, cfg.temperature || [1, 1, 1]);
const jsResult = {
  model: cfg.model_name || "rl-agent",
  answers,
  usage: { input_tokens: prep.input_tokens, output_tokens: 0 }
};
const directive = toHumanMcp(jsResult);

const pyCode = [
  "import json, os",
  "from edgejev import Agent",
  "ag = Agent(os.environ['EDGEJEV_MODEL_DIR'])",
  "questions = json.loads(os.environ['ABP_QUESTIONS_JSON'])",
  "out = ag.system_one(os.environ['ABP_STATE'], questions)",
  "print(json.dumps(out, ensure_ascii=False))"
].join("\n");

const py = spawnSync("python", ["-c", pyCode], {
  encoding: "utf8",
  env: {
    ...process.env,
    EDGEJEV_MODEL_DIR: modelDir,
    ABP_QUESTIONS_JSON: JSON.stringify(ABP_QUESTIONS),
    ABP_STATE: state
  }
});
if (py.status !== 0) {
  console.error(py.stdout);
  console.error(py.stderr);
  process.exit(py.status || 1);
}
const pyLines = py.stdout.trim().split(/\n/).filter(Boolean);
const pyResult = JSON.parse(pyLines[pyLines.length - 1]);

function close(a, b, eps = 2e-4) {
  return Math.abs(Number(a) - Number(b)) <= eps;
}

for (const qid of Object.keys(ABP_QUESTIONS)) {
  const ja = jsResult.answers[qid];
  const pa = pyResult.answers[qid];
  if (!ja || !pa) throw new Error(qid + ": missing answer");
  if (ja.type !== pa.type) throw new Error(qid + ": type mismatch");
  if (ja.type === "choice" && ja.choice !== pa.choice) {
    throw new Error(qid + ": choice mismatch " + ja.choice + " vs " + pa.choice);
  }
  if (ja.type === "score" && !close(ja.score, pa.score)) {
    throw new Error(qid + ": score mismatch " + ja.score + " vs " + pa.score);
  }
  if (ja.type === "noul" && !close(ja.noul, pa.noul)) {
    throw new Error(qid + ": noul mismatch " + ja.noul + " vs " + pa.noul);
  }
}

console.log(JSON.stringify({
  ok: true,
  directive,
  command: directiveText(directive),
  jsResult,
  pyResult
}, null, 2));
