#!/usr/bin/env node
"use strict";

// Replace this example with your local Whisper, SenseVoice, or another speech
// recognizer. The adapter receives the audio path as its final argument and
// must print one JSON object to stdout. Never print credentials or logs there.
const file = process.argv.at(-1);
if (!file) process.exit(2);
process.stdout.write(JSON.stringify({
  status: "succeeded",
  transcript: "请把这里替换成语音识别器返回的真实文字",
  language: "zh",
  acoustics: { note: "可选：时长、语速、音高或情绪等真实音频分析结果" }
}));
