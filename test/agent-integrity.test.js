import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runAgent } from "../src/ai/agent.js";
import { SessionStore } from "../src/workspace/session-store.js";

test("agent mengeksekusi tool walau provider mengirim finish_reason stop", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sibercraft-agent-integrity-stop-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const server = await startChatServer([
    {
      tool: {
        id: "call_write",
        name: "write_file",
        arguments: JSON.stringify({ path: "index.html", content: "<h1>Nyata</h1>" }),
      },
      finishReason: "stop",
    },
    { content: "File sudah diperbarui.", finishReason: "stop" },
  ], t);

  const store = new SessionStore(root);
  await store.init();
  const session = await store.create({ name: "Integrity", template: "blank", model: "primary-model" });
  const events = [];
  const result = await runAgent({
    session,
    store,
    prompt: "edit file index.html",
    config: baseConfig(server.baseUrl),
    emit: (event) => events.push(event),
  });

  assert.equal(result.mutated, true);
  assert.equal(await readFile(join(store.workspaceDir(session.id), "index.html"), "utf8"), "<h1>Nyata</h1>");
  assert.deepEqual(events.filter((event) => event.type === "tool_result").map(({ ok, status, mutated }) => ({ ok, status, mutated })), [
    { ok: true, status: "success", mutated: true },
  ]);
  const history = await store.history(session.id);
  assert.match(history.find((message) => message.role === "tool")?.content || "", /TOOL_STATUS=SUCCESS; MUTATED/);
});

test("agent me-retry klaim selesai yang tidak menjalankan tool", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sibercraft-agent-integrity-retry-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const server = await startChatServer([
    { content: "Selesai, sudah diedit.", finishReason: "stop" },
    {
      tool: {
        id: "call_retry_write",
        name: "write_file",
        arguments: JSON.stringify({ path: "index.html", content: "<h1>Retry berhasil</h1>" }),
      },
      finishReason: "stop",
    },
    { content: "Sekarang perubahan benar-benar sudah diterapkan.", finishReason: "stop" },
  ], t);

  const store = new SessionStore(root);
  await store.init();
  const session = await store.create({ name: "Retry", template: "blank", model: "primary-model" });
  const events = [];
  await runAgent({
    session,
    store,
    prompt: "edit file index.html",
    config: { ...baseConfig(server.baseUrl), maxIterations: 5 },
    emit: (event) => events.push(event),
  });

  assert.equal(server.requestCount, 3);
  assert.equal(events.filter((event) => event.type === "assistant_retry").length, 1);
  assert.equal(await readFile(join(store.workspaceDir(session.id), "index.html"), "utf8"), "<h1>Retry berhasil</h1>");
  const history = await store.history(session.id);
  assert.equal(history.find((message) => message.role === "assistant" && message.execution_status === "unverified")?.execution_status, "unverified");
  assert.equal(history.at(-1).execution_status, "verified");
});

function baseConfig(baseUrl) {
  return {
    apiKey: "primary-key",
    baseUrl,
    model: "primary-model",
    maxIterations: 4,
    requestLogging: false,
    contextOptimize: { enabled: false, mode: "summary" },
    multimodal: { apiKey: "", baseUrl: "", model: "" },
  };
}

async function startChatServer(responses, t) {
  let requestCount = 0;
  const server = createServer(async (request, response) => {
    if (request.url !== "/chat/completions") {
      response.writeHead(404);
      response.end();
      return;
    }
    for await (const _chunk of request) {}
    const payload = responses[Math.min(requestCount++, responses.length - 1)];
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    if (payload.tool) {
      sendSse(response, {
        choices: [{
          delta: {
            content: payload.content || "",
            tool_calls: [{
              index: 0,
              id: payload.tool.id,
              type: "function",
              function: { name: payload.tool.name, arguments: payload.tool.arguments },
            }],
          },
          finish_reason: null,
        }],
      });
    } else {
      sendSse(response, { choices: [{ delta: { content: payload.content }, finish_reason: null }] });
    }
    sendSse(response, { choices: [{ delta: {}, finish_reason: payload.finishReason }] });
    response.end("data: [DONE]\n\n");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    get requestCount() { return requestCount; },
  };
}

function sendSse(response, payload) {
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}
