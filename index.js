const path = require("path");
const http = require("http");
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const { init: initDB, Counter } = require("./db");
const { DEFAULT_QUESTIONS } = require("./edgejev-defaults");
const { ABP_QUESTIONS, toHumanMcp } = require("./abp-defaults");

const logger = morgan("tiny");
const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json({ limit: "1mb" }));
app.use(cors());
app.use(logger);

const EDGEJEV_PORT = Number(process.env.EDGEJEV_PORT || 8009);
let dbReady = false;

function edgejevRequest(method, pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request({
      hostname: "127.0.0.1",
      port: EDGEJEV_PORT,
      path: pathname,
      method,
      headers: payload ? {
        "content-type": "application/json",
        "content-length": payload.length,
      } : {},
      timeout: 5000,
    }, (resp) => {
      let raw = "";
      resp.setEncoding("utf8");
      resp.on("data", (chunk) => raw += chunk);
      resp.on("end", () => {
        let data;
        try { data = JSON.parse(raw || "{}"); }
        catch { data = { raw }; }
        resolve({ status: resp.statusCode || 500, data });
      });
    });
    req.on("timeout", () => req.destroy(new Error("EdgeJev timeout")));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

app.get("/", async (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/edgejev-demo", async (req, res) => {
  res.sendFile(path.join(__dirname, "edgejev-demo.html"));
});

app.get("/api/edgejev/health", async (req, res) => {
  try {
    const r = await edgejevRequest("GET", "/health");
    res.status(r.status).send(r.data);
  } catch (e) {
    res.status(503).send({ ok: false, error: String(e.message || e) });
  }
});

async function runDecision(text, questions) {
  return edgejevRequest("POST", "/v1/systemone", {
    state: text,
    questions,
  });
}

app.post("/api/edgejev/decide", async (req, res) => {
  const text = typeof req.body.text === "string" ? req.body.text.trim() : "";
  if (!text) return res.status(400).send({ error: "text is required" });

  const questions = req.body.questions && typeof req.body.questions === "object"
    ? req.body.questions
    : DEFAULT_QUESTIONS;

  try {
    const r = await runDecision(text, questions);
    res.status(r.status).send(r.data);
  } catch (e) {
    res.status(503).send({
      error: "EdgeJev inference service unavailable",
      detail: String(e.message || e),
    });
  }
});

// ABP is a policy layer over EdgeJev. It produces a typed Human-MCP directive;
// it does not pretend the classifier can generate natural-language plans.
app.post("/api/abp/decide", async (req, res) => {
  const text = typeof req.body.text === "string" ? req.body.text.trim() : "";
  if (!text) return res.status(400).send({ error: "text is required" });

  try {
    const r = await runDecision(text, ABP_QUESTIONS);
    if (r.status < 200 || r.status >= 300) {
      return res.status(r.status).send(r.data);
    }
    res.send({
      protocol: "abp/0.1",
      input: text,
      directive: toHumanMcp(r.data),
      decision: r.data,
    });
  } catch (e) {
    res.status(503).send({
      error: "ABP decision service unavailable",
      detail: String(e.message || e),
    });
  }
});

// Existing template APIs remain available when MySQL is configured.
function requireDB(res) {
  if (dbReady) return true;
  res.status(503).send({
    code: 503,
    error: "database unavailable",
    detail: "Set MYSQL_ADDRESS / MYSQL_USERNAME / MYSQL_PASSWORD to enable counter APIs.",
  });
  return false;
}

app.post("/api/count", async (req, res) => {
  if (!requireDB(res)) return;
  const { action } = req.body;
  if (action === "inc") {
    await Counter.create();
  } else if (action === "clear") {
    await Counter.destroy({ truncate: true });
  }
  res.send({ code: 0, data: await Counter.count() });
});

app.get("/api/count", async (req, res) => {
  if (!requireDB(res)) return;
  res.send({ code: 0, data: await Counter.count() });
});

app.get("/api/wx_openid", async (req, res) => {
  if (req.headers["x-wx-source"]) {
    res.send(req.headers["x-wx-openid"]);
  } else {
    res.status(400).send("missing x-wx-source");
  }
});

const port = process.env.PORT || 80;

async function bootstrap() {
  if (process.env.MYSQL_ADDRESS) {
    try {
      await initDB();
      dbReady = true;
      console.log("[db] ready");
    } catch (e) {
      console.error("[db] init failed; non-DB endpoints will remain available", e);
    }
  } else {
    console.log("[db] MYSQL_ADDRESS not set; starting without counter database");
  }

  app.listen(port, () => {
    console.log("启动成功", port);
  });
}

bootstrap();
