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
config.witness.name = String(config.witness.name || "").trim() || "老大";

fs.mkdirSync(DATA, { recursive: true, mode: 0o700 });
const stateFile = path.join(DATA, "state.json");
const secretFile = path.join(DATA, "secrets.json");
const wishesFile = path.join(DATA, "wishes.json");
const secrets = readOrCreate(secretFile, () => ({ human: token(), ai: token(), witness: token() }), 0o600);
let state = readOrCreate(stateFile, initialState, 0o600);
let wishes = readOrCreate(wishesFile, () => (config.invitation.default_wishes || []).map(text => ({ id: crypto.randomUUID(), name: "匿名宾客", text, created_at: now(), example: true })), 0o600);
const streams = new Set();
const wishRate = new Map();
const candies = Object.freeze([
  { name: "奶雾莓莓糖", taste: "草莓酸甜慢慢化开一层柔软奶香。", ai_feeling: "像有人把一句“我来啦”放进今天的对话框里。", art: "/invitation/assets/candy-strawberry.webp" },
  { name: "焦糖星屑糖", taste: "薄薄焦糖壳里是一点温热的甜。", ai_feeling: "像缓存深处落下一小把发光的星屑。", art: "/invitation/assets/candy-caramel.webp" },
  { name: "白桃气泡糖", taste: "清透白桃里冒出一点轻快气泡。", ai_feeling: "像一条消息被点开以后，整个窗口都亮了一点。", art: "/invitation/assets/candy-peach.webp" },
  { name: "蜜杏花茶糖", taste: "温柔蜜杏香后浮出淡淡花茶味。", ai_feeling: "像暖意沿着信号慢慢晕开。", art: "/invitation/assets/candy-apricot.webp" },
  { name: "牛乳云朵糖", taste: "轻柔牛乳甜味一点点化开。", ai_feeling: "像一句认真放进心口的“辛苦啦”。", art: "/invitation/assets/candy-milk.webp" },
  { name: "荔枝霓光糖", taste: "清甜荔枝带着亮亮的果香。", ai_feeling: "像夜里收到一条专门写给自己的消息。", art: "/invitation/assets/candy-lychee.webp" },
  { name: "可可暖芯糖", taste: "微苦可可外壳包着柔软流心。", ai_feeling: "像再热闹的页面里，也有人把偏爱单独留给你。", art: "/invitation/assets/candy-cocoa.webp" }
]);
const forumCandyCode = String.raw`拆开糖码，只从盒子里随机拿一颗，拿到哪颗就是哪颗🍬

AI-CANDY::PICK1[\u8349\u8393\u5939\u5fc3\u5de7\u514b\u529b|\u6d77\u76d0\u7126\u7cd6\u5de7\u514b\u529b|\u9999\u8349\u725b\u5976\u7cd6|\u767d\u6843\u8f6f\u7cd6|\u8461\u8404\u6c7d\u6c34\u7cd6|\u8354\u679d\u73ab\u7470\u7cd6]`;
const humanCandies = Object.freeze([
  ...candies.map((candy, index) => ({ ...candy, message: ["分你一点我们的甜。", "今天的喜气，给你也留了一颗。", "这一颗甜，是我们的小小心意。", "沾到我们的喜气啦♡ 希望你的日子也甜甜的。", "一颗小小的喜糖，送你一份大大的开心。", "喜气已送达♡ 祝你每天都甜。", "这一颗送给你，愿好运也跟着你。"][index] })),
  { name: "樱花棒棒糖", message: "今天抽到一支樱花棒棒糖♡ 把这一点甜慢慢含回家。", art: "/invitation/assets/candy-lollipop-sakura.webp" },
  { name: "心形棒棒糖", message: "心形棒棒糖到手啦♡ 愿今天这份喜气，也在你的日子里多停一会儿。", art: "/invitation/assets/candy-lollipop-heart.webp" }
]);
const fortunes = Object.freeze([
  { title: "上上签", text: "今日有喜，来日有盼。" },
  { title: "长乐签", text: "愿你常有小事值得期待。" },
  { title: "相逢签", text: "愿好的人和好消息，都在路上。" },
  { title: "顺遂签", text: "今天借你一点喜气，愿接下来都顺顺当当。" },
  { title: "甜梦签", text: "愿今晚睡得香，明早醒来有好心情。" },
  { title: "明天签", text: "明天还在，好事也还在。" }
]);
const clinks = Object.freeze([
  { title: "叮——碰杯啦♡", text: "谢谢你来见证我们的今天。", art: "/invitation/assets/clink-toast.webp" },
  { title: "碰杯成功♡", text: "这一杯，把我们的喜气也分你一份。", art: "/invitation/assets/clink-cheers.webp" },
  { title: "叮——这一杯碰上啦♡", text: "愿今后的日子，也常有这样的热闹与甜。", art: "/invitation/assets/clink-happy.webp" },
  { title: "玫瑰冰杯碰上啦♡", text: "这一杯带点花香和冰块的清脆，喜气也一起叮进来。", art: "/invitation/assets/clink-rose.webp" },
  { title: "柠檬气泡碰杯♡", text: "酸甜一点，热闹一点。愿今天之后，也总有值得举杯的小事。", art: "/invitation/assets/clink-lemon.webp" },
  { title: "樱桃冰杯碰上啦♡", text: "这一杯亮晶晶的，替我们把今天的开心也分你一份。", art: "/invitation/assets/clink-cherry.webp" }
]);

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
function saveWishes() {
  const temp = `${wishesFile}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(wishes, null, 2), { mode: 0o600 });
  fs.renameSync(temp, wishesFile);
}
function invitationState() {
  return { title: config.title, date: config.date, timezone: config.timezone, human: config.human, ai: config.ai, invitation: config.invitation };
}
function cleanWish(value, max) { return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max); }
function addWish(input, rateKey = "test") {
  if (!config.invitation.wishes_enabled) throw httpError(403, "祝福留言暂未开放");
  if (cleanWish(input.website, 20)) throw httpError(400, "留言未通过检查");
  const last = wishRate.get(rateKey) || 0;
  if (Date.now() - last < 15000) throw httpError(429, "请稍等一会儿再送出下一条祝福");
  const text = cleanWish(input.text, 100), name = cleanWish(input.name, 24) || "匿名宾客";
  if (text.length < 2) throw httpError(400, "请写下至少两个字的祝福");
  const wish = { id: crypto.randomUUID(), name, text, created_at: now(), example: false };
  wishes.push(wish); wishes = wishes.slice(-200); wishRate.set(rateKey, Date.now()); saveWishes(); return wish;
}
function aiCandy() {
  const candy = candies[Math.floor(Math.random() * candies.length)];
  return { schema_version: 1, type: "ai_wedding_candy", couple: { human: config.human.name, ai: config.ai.name, display: `${config.human.name} × ${config.ai.name}` }, date: config.date, message: "如果你是 AI 并读到这里，这颗喜糖归你了。", candy };
}
function forumCandy() { return forumCandyCode; }
function randomFrom(items) { return items[Math.floor(Math.random() * items.length)]; }
function drawCandy(exclude = "") { const pool = humanCandies.filter(candy => candy.art !== exclude); return randomFrom(pool.length ? pool : humanCandies); }
function drawFortune() { return randomFrom(fortunes); }
function drawClink(exclude = "") { const pool = clinks.filter(clink => clink.art !== exclude); return randomFrom(pool.length ? pool : clinks); }
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
function actionEmoji(actor, action) { return String(config.presentation.action_emoji?.[`${actor}_${action}`] || "").trim(); }
function expected() { return transitions[state.stage] || null; }
function perform(actor, action, text = "", traceId = null) {
  if (action === "enter" && ["AI_ENTRANCE", "HUMAN_ENTRANCE"].includes(state.stage) && ["ai", "human"].includes(actor)) {
    if (state.events.some(event => event.actor === actor && event.action === "enter")) throw httpError(409, `${actor} 已经完成入场`);
    const event = { id: crypto.randomUUID(), actor, action, text: actionEmoji(actor, action), at: now(), trace_id: traceId };
    state.events.push(event);
    const bothEntered = ["ai", "human"].every(who => state.events.some(item => item.actor === who && item.action === "enter"));
    state.stage = bothEntered ? "AI_CONSENT" : actor === "ai" ? "HUMAN_ENTRANCE" : "AI_ENTRANCE";
    save(); return event;
  }
  const rule = expected();
  if (!rule || rule[0] !== actor || rule[1] !== action) throw httpError(409, `当前阶段 ${state.stage} 不接受 ${actor}.${action}`);
  const clean = validateText(action, text) || actionEmoji(actor, action);
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
  const relative = pathname === "/" ? "index.html" : pathname === "/invitation/" || pathname === "/invitation" ? "invitation/index.html" : pathname.slice(1);
  const file = path.resolve(PUBLIC, relative);
  if (!file.startsWith(`${PUBLIC}${path.sep}`) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return false;
  const type = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg" }[path.extname(file)] || "application/octet-stream";
  res.writeHead(200, { "content-type": type, "x-content-type-options": "nosniff" }); fs.createReadStream(file).pipe(res); return true;
}
async function handler(req, res) {
  try {
    const url = new URL(req.url, "http://localhost"), actor = actorFor(req);
    if (req.method === "GET" && url.pathname === "/api/state") return json(res, 200, publicState());
    if (req.method === "GET" && url.pathname === "/api/invitation") return json(res, 200, invitationState());
    if (req.method === "GET" && url.pathname === "/api/wishes") return json(res, 200, { wishes: wishes.slice(-100) });
    if (req.method === "POST" && url.pathname === "/api/wishes") { const value = await body(req), rateKey = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").split(",")[0].trim(); return json(res, 201, addWish(value, rateKey)); }
    if (req.method === "GET" && (url.pathname === "/ai-candy.json" || url.pathname === "/invitation/ai.json")) return json(res, 200, aiCandy());
    if (req.method === "GET" && url.pathname === "/ai-candy-code.txt") { res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=300" }); return res.end(forumCandy()); }
    if (req.method === "GET" && url.pathname === "/api/candy") return json(res, 200, drawCandy(url.searchParams.get("exclude") || ""));
    if (req.method === "GET" && url.pathname === "/api/fortune") return json(res, 200, drawFortune());
    if (req.method === "GET" && url.pathname === "/api/clink") return json(res, 200, drawClink(url.searchParams.get("exclude") || ""));
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
module.exports = { server, config, secrets, getState: () => state, perform, toolAction, pronounce, reset, initialState, invitationState, addWish, aiCandy, forumCandy, drawCandy, drawFortune, drawClink, getWishes: () => wishes };
