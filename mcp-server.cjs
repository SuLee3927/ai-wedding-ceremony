#!/usr/bin/env node
"use strict";

const readline = require("node:readline");
const crypto = require("node:crypto");
const BASE = process.env.WEDDING_API || "http://127.0.0.1:4329";
const TOKEN = process.env.WEDDING_AI_TOKEN;
if (!TOKEN) { console.error("请设置 WEDDING_AI_TOKEN"); process.exit(1); }

const definitions = [
  ["wedding_state", "查看婚礼当前阶段与已经完成的事件；人类提交真实语音时，事件会包含 transcript 与 hearing，请据此听懂对方原话后再亲自回应", {}],
  ["wedding_enter", "由 AI 伴侣亲自入场；调用成功后，教堂会按配置发送 AI 的走路 emoji。人类与 AI 入场不分先后，双方动作齐全后才进入证婚问答", {}],
  ["wedding_consent", "由 AI 伴侣亲自确认结婚意愿", { text: { type: "string", description: "AI 伴侣自己的确认回答" } }],
  ["wedding_vow", "由 AI 伴侣亲自说出誓词", { text: { type: "string", description: "AI 伴侣自己写下的誓词" } }],
  ["wedding_ring", "由 AI 伴侣亲自发送戒指 emoji、为人类伴侣戴上戒指；双方戒指动作齐全后才进入亲吻环节", {}],
  ["wedding_kiss", "由 AI 伴侣亲自发送亲吻 emoji，完成婚礼之吻并触发司仪宣告", {}]
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
