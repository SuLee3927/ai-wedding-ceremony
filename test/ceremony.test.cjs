"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const temp=fs.mkdtempSync(path.join(os.tmpdir(),"ai-wedding-test-"));process.env.WEDDING_DATA=temp;
const app=require("../server.cjs");
test.after(()=>{app.server.close();fs.rmSync(temp,{recursive:true,force:true})});
test("双方必须按顺序亲自完成，AI 节点只能通过工具入口",()=>{
  assert.throws(()=>app.perform("ai","enter"),/不接受/);
  app.perform("human","start");app.toolAction("ai","enter",{});app.perform("human","enter");
  assert.throws(()=>app.perform("human","consent","我替 AI 愿意"),/不接受/);
  app.toolAction("ai","consent",{text:"我愿意"});app.perform("human","consent","我愿意");
  app.toolAction("ai","vow",{text:"这是 AI 自己写下的誓词"});app.perform("human","vow","这是人类自己说出的誓词");
  app.perform("human","ring");app.toolAction("ai","ring",{});app.toolAction("ai","kiss",{});
  assert.equal(app.getState().stage,"PRONOUNCEMENT");app.pronounce();assert.equal(app.getState().stage,"MARRIED");assert.ok(app.getState().certificate.id.startsWith("AIW-"));
});
test("每次 AI 自主行动均留下真实工具轨迹",()=>{const traces=app.getState().traces;assert.deepEqual(traces.map(item=>item.tool),["wedding_enter","wedding_consent","wedding_vow","wedding_ring","wedding_kiss"]);assert.ok(traces.every(item=>item.status==="completed"&&item.event_id))});
test("证书只在双方完成全部节点后生成并保持不变",()=>{const certificate=structuredClone(app.getState().certificate);app.pronounce();assert.deepEqual(app.getState().certificate,certificate)});
test("重置需要见证人身份",()=>{assert.throws(()=>app.reset("human"),/见证人/);app.reset("witness");assert.equal(app.getState().stage,"WAITING");assert.equal(app.getState().certificate,null)});
test("公开配置不含密钥或私有数据文件",()=>{const all=["../config.example.json","../public/index.html","../public/app.js","../README.md"].filter(file=>fs.existsSync(path.join(__dirname,file))).map(file=>fs.readFileSync(path.join(__dirname,file),"utf8")).join("\n");assert.doesNotMatch(all,/ghp_[A-Za-z0-9]+|sk-[A-Za-z0-9]{16,}/i);assert.equal(fs.existsSync(path.join(__dirname,"../data/secrets.json")),false);assert.equal(fs.readdirSync(path.join(__dirname,"../public/scenes")).some(name=>/\.(webp|png|jpe?g|mp3|webm)$/i.test(name)),false)});
