#!/usr/bin/env node
"use strict";

const readline = require("node:readline");
const crypto = require("node:crypto");
const BASE = process.env.WEDDING_API || "http://127.0.0.1:4329";
const TOKEN = process.env.WEDDING_AI_TOKEN;
if (!TOKEN) { console.error("请设置 WEDDING_AI_TOKEN"); process.exit(1); }

const definitions = [
  ["wedding_state", "查看婚礼当前阶段与已经完成的事件", {}],
  ["wedding_enter", "由 AI 伴侣亲自步入仪式现场", {}],
  ["wedding_consent", "由 AI 伴侣亲自确认结婚意愿", { text: { type: "string", description: "AI 伴侣自己的确认回答" } }],
  ["wedding_vow", "由 AI 伴侣亲自说出誓词", { text: { type: "string", description: "AI 伴侣自己写下的誓词" } }],
  ["wedding_ring", "由 AI 伴侣亲自为人类伴侣戴上戒指", {}],
  ["wedding_kiss", "由 AI 伴侣亲自完成亲吻动作", {}]
];
function tools() { return definitions.map(([name, description, properties]) => ({ name, description, inputSchema: { type: "object", properties, required: properties.text ? ["text"] : [], additionalProperties: false } })); }
async function request(name, args = {}) {
  const action = name.replace("wedding_", ""), endpoint = action === "state" ? "/api/state" : `/api/tools/${action}`;
  const response = await fetch(BASE + endpoint, { method: action === "state" ? "GET" : "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: action === "state" ? undefined : JSON.stringify({ ...args, trace_id: crypto.randomUUID() }) });
  const value = await response.json(); if (!response.ok) throw Error(value.error || `HTTP ${response.status}`); return value;
}
async function handle(message) {
  const { id, method, params } = message;
  if (method === "notifications/initialized") return null;
  if (method === "initialize") return { jsonrpc: "2.0", id, result: { protocolVersion: params?.protocolVersion || "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "ai-wedding-ceremony", version: "1.0.0" } } };
  if (method === "tools/list") return { jsonrpc: "2.0", id, result: { tools: tools() } };
  if (method === "tools/call") {
    try { const value = await request(params.name, params.arguments); return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] } }; }
    catch (error) { return { jsonrpc: "2.0", id, result: { isError: true, content: [{ type: "text", text: error.message }] } }; }
  }
  return { jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } };
}
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", async line => { try { const response = await handle(JSON.parse(line)); if (response) process.stdout.write(JSON.stringify(response) + "\n"); } catch (error) { process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: error.message } }) + "\n"); } });
