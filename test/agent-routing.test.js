import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runAgent } from "../src/agent.js";
import { SessionStore } from "../src/session-store.js";

test("agent berpindah dari primary ke multimodal setelah tool screenshot", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sibercraft-agent-route-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const requests = [];
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
  const server = createServer(async (request, response) => {
    if (request.url === "/screenshot") {
      for await (const _chunk of request) {}
      response.writeHead(200, { "Content-Type": "image/png" });
      response.end(png);
      return;
    }

    let raw = "";
    for await (const chunk of request) raw += chunk;
    const payload = JSON.parse(raw);
    requests.push(payload);
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    if (requests.length === 1) {
      sendSse(response, {
        choices: [{
          delta: {
            content: "Saya akan melihat website referensi.",
            tool_calls: [{
              index: 0,
              id: "call_webshot",
              type: "function",
              function: {
                name: "capture_webpage_screenshot",
                arguments: '{"url":"https://93.184.216.34/reference"}',
              },
            }],
          },
          finish_reason: null,
        }],
      });
      sendSse(response, { choices: [{ delta: {}, finish_reason: "tool_calls" }] });
    } else {
      sendSse(response, {
        choices: [{ delta: { content: "Mockup selesai." }, finish_reason: "stop" }],
        usage: { prompt_tokens: 20, completion_tokens: 4 },
      });
    }
    response.end("data: [DONE]\n\n");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const store = new SessionStore(root);
  await store.init();
  const session = await store.create({ name: "Routing", template: "blank", model: "primary-model" });
  const events = [];
  await runAgent({
    session,
    store,
    prompt: "Buat website yang mirip https://93.184.216.34/reference",
    config: {
      apiKey: "primary-key",
      baseUrl,
      model: "primary-model",
      maxIterations: 5,
      requestLogging: false,
      contextOptimize: { enabled: false, mode: "summary" },
      multimodal: { apiKey: "vision-key", baseUrl, model: "vision-model" },
    },
    webScreenshot: { endpoint: `${baseUrl}/screenshot` },
    emit: (event) => events.push(event),
  });

  assert.equal(requests.length, 2);
  assert.equal(requests[0].model, "primary-model");
  assert.equal(requests[1].model, "vision-model");
  assert.equal(
    requests[1].messages.some((message) =>
      Array.isArray(message.content)
      && message.content.some((item) => item.type === "image_url" && item.image_url.url.startsWith("data:image/png;base64,"))
    ),
    true,
  );
  assert.deepEqual(
    events.filter((event) => event.type === "iteration_model").map(({ model, mode }) => ({ model, mode })),
    [
      { model: "primary-model", mode: "primary" },
      { model: "vision-model", mode: "multimodal" },
    ],
  );
  const history = await store.history(session.id);
  assert.deepEqual(history.at(-1).models_used, [
    { model: "primary-model", mode: "primary" },
    { model: "vision-model", mode: "multimodal" },
  ]);
});

function sendSse(response, payload) {
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}
