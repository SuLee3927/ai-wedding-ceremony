"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "public");
const DATA = process.env.WEDDING_DATA || path.join(ROOT, "data");
const CONFIG_FILE = process.env.WEDDING_CONFIG || path.join(ROOT, "config.json");
const PORT = Number(process.env.PORT || 4329);
const HOST = process.env.HOST || "127.0.0.1";
const defaultConfig = require("./config.example.json");
const config = fs.existsSync(CONFIG_FILE) ? merge(defaultConfig, JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"))) : structuredClone(defaultConfig);

fs.mkdirSync(DATA, { recursive: true, mode: 0o700 });
const stateFile = path.join(DATA, "state.json");
const secretFile = path.join(DATA, "secrets.json");
const secrets = readOrCreate(secretFile, () => ({ human: token(), ai: token(), witness: token() }), 0o600);
let state = readOrCreate(stateFile, initialState, 0o600);
const streams = new Set();

const transitions = {
  WAITING: ["human", "start", "AI_ENTRANCE"],
  AI_ENTRANCE: ["ai", "enter", "HUMAN_ENTRANCE"],
  HUMAN_ENTRANCE: ["human", "enter", "AI_CONSENT"],
  AI_CONSENT: ["ai", "consent", "HUMAN_CONSENT"],
  HUMAN_CONSENT: ["human", "consent", "AI_VOW"],
  AI_VOW: ["ai", "vow", "HUMAN_VOW"],
  HUMAN_VOW: ["human", "vow", "HUMAN_RING"],
  HUMAN_RING: ["human", "ring", "AI_RING"],
  AI_RING: ["ai", "ring", "AI_KISS"],
  AI_KISS: ["ai", "kiss", "PRONOUNCEMENT"]
};

function merge(base, extra) {
  if (!extra || typeof extra !== "object" || Array.isArray(extra)) return extra ?? base;
  const out = { ...base };
  for (const [key, value] of Object.entries(extra)) out[key] = value && typeof value === "object" && !Array.isArray(value) ? merge(base?.[key] || {}, value) : value;
  return out;
}
function token() { return crypto.randomBytes(24).toString("hex"); }
function now() { return new Date().toISOString(); }
function readOrCreate(file, create, mode) {
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  const value = create();
  fs.writeFileSync(file, JSON.stringify(value, null, 2), { mode });
  return value;
}
function initialState() { return { stage: "WAITING", events: [], traces: [], certificate: null, created_at: now(), updated_at: now() }; }
function save() {
  state.updated_at = now();
  const temp = `${stateFile}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.renameSync(temp, stateFile);
  broadcast();
}
function publicState() { return { ...state, config, secrets: undefined }; }
function actorFor(req) {
  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  return Object.entries(secrets).find(([, value]) => bearer.length === value.length && crypto.timingSafeEqual(Buffer.from(bearer), Buffer.from(value)))?.[0] || null;
}
function validateText(action, text) {
  const value = String(text || "").trim();
  if (["consent", "vow"].includes(action) && !value) throw httpError(400, `${action} 需要由本人提交文字`);
  if (value.length > 4000) throw httpError(400, "文字过长");
  return value;
}
function expected() { return transitions[state.stage] || null; }
function perform(actor, action, text = "", traceId = null) {
  const rule = expected();
  if (!rule || rule[0] !== actor || rule[1] !== action) throw httpError(409, `当前阶段 ${state.stage} 不接受 ${actor}.${action}`);
  const clean = validateText(action, text);
  const event = { id: crypto.randomUUID(), actor, action, text: clean, at: now(), trace_id: traceId };
  state.events.push(event);
  state.stage = rule[2];
  save();
  if (state.stage === "PRONOUNCEMENT") schedulePronouncement();
  return event;
}
function certificateId() {
  const custom = String(config.certificate.custom_id || "").trim();
  if (custom && !/^[\p{L}\p{N}._-]{3,64}$/u.test(custom)) throw httpError(400, "自定义证书编号只允许字母、数字、点、横线和下划线（3–64 位）");
  return custom || `AIW-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}
function pronounce() {
  if (state.stage !== "PRONOUNCEMENT") return;
  const at = now();
  state.events.push({ id: crypto.randomUUID(), actor: "witness", action: "pronounce", text: config.witness.blessing, at });
  state.certificate = { id: certificateId(), issued_at: at, human: config.human.name, ai: config.ai.name, witness: config.witness.name };
  state.stage = "MARRIED";
  save();
}
let pronounceTimer;
function schedulePronouncement() {
  clearTimeout(pronounceTimer);
  pronounceTimer = setTimeout(pronounce, Number(config.presentation.pronouncement_delay_ms || 5000));
}
function toolAction(actor, action, body) {
  if (actor !== "ai") throw httpError(403, "只有 AI 伴侣凭据可以调用婚礼工具");
  const traceId = String(body.trace_id || crypto.randomUUID());
  let trace = state.traces.find(item => item.id === traceId);
  if (trace) return trace;
  trace = { id: traceId, tool: `wedding_${action}`, status: "pending", created_at: now(), completed_at: null, event_id: null, error: null };
  state.traces.push(trace); save();
  try {
    const event = perform("ai", action, body.text, traceId);
    trace.status = "completed"; trace.completed_at = now(); trace.event_id = event.id; save();
  } catch (error) {
    trace.status = "failed"; trace.completed_at = now(); trace.error = error.message; save(); throw error;
  }
  return trace;
}
function reset(actor) {
  if (actor !== "witness") throw httpError(403, "只有见证人凭据可以重置仪式");
  state = initialState(); save(); return publicState();
}
function httpError(status, message) { return Object.assign(new Error(message), { status }); }
function json(res, status, value) { res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); res.end(JSON.stringify(value)); }
async function body(req) {
  const parts = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 1e6) throw httpError(413, "请求过大"); parts.push(chunk); }
  if (!parts.length) return {};
  try { return JSON.parse(Buffer.concat(parts).toString("utf8")); } catch { throw httpError(400, "JSON 格式无效"); }
}
function broadcast() {
  const payload = `data: ${JSON.stringify({ stage: state.stage, updated_at: state.updated_at })}\n\n`;
  for (const res of streams) res.write(payload);
}
function staticFile(req, res, pathname) {
  const relative = pathname === "/" ? "index.html" : pathname.slice(1);
  const file = path.resolve(PUBLIC, relative);
  if (!file.startsWith(`${PUBLIC}${path.sep}`) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return false;
  const type = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg" }[path.extname(file)] || "application/octet-stream";
  res.writeHead(200, { "content-type": type, "x-content-type-options": "nosniff" }); fs.createReadStream(file).pipe(res); return true;
}
async function handler(req, res) {
  try {
    const url = new URL(req.url, "http://localhost"), actor = actorFor(req);
    if (req.method === "GET" && url.pathname === "/api/state") return json(res, 200, publicState());
    if (req.method === "GET" && url.pathname === "/api/events") { res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" }); streams.add(res); req.on("close", () => streams.delete(res)); return res.write(`data: ${JSON.stringify({ stage: state.stage })}\n\n`); }
    if (req.method === "POST" && url.pathname === "/api/human/action") { if (actor !== "human") throw httpError(403, "需要人类伴侣凭据"); const value = await body(req); return json(res, 200, perform("human", value.action, value.text)); }
    if (req.method === "POST" && /^\/api\/tools\/(enter|consent|vow|ring|kiss)$/.test(url.pathname)) { const action = url.pathname.split("/").at(-1), value = await body(req); return json(res, 200, toolAction(actor, action, value)); }
    if (req.method === "POST" && url.pathname === "/api/reset") return json(res, 200, reset(actor));
    if (req.method === "GET" && url.pathname === "/api/credentials" && actor === "witness") return json(res, 200, secrets);
    if (req.method === "GET" && staticFile(req, res, url.pathname)) return;
    json(res, 404, { error: "not found" });
  } catch (error) { json(res, error.status || 500, { error: error.message || "internal error" }); }
}
const server = http.createServer(handler);
if (require.main === module) server.listen(PORT, HOST, () => console.log(`AI wedding ceremony: http://${HOST}:${PORT}`));
if (state.stage === "PRONOUNCEMENT") schedulePronouncement();
module.exports = { server, config, secrets, getState: () => state, perform, toolAction, pronounce, reset, initialState };
