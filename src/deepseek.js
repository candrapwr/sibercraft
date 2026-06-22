export class DeepSeekClient {
  constructor({ apiKey, baseUrl, model }) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.model = model;
  }

  async complete({ messages, tools, signal, onContent, onToolCall }) {
    if (!this.apiKey) throw new Error("DEEPSEEK_API_KEY belum dikonfigurasi di file .env");
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        ...(tools?.length ? { tools, tool_choice: "auto" } : {}),
        stream: true,
        stream_options: { include_usage: true },
      }),
      signal,
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 1500);
      throw new Error(`DeepSeek API ${response.status}: ${detail}`);
    }
    if (!response.body) throw new Error("DeepSeek mengembalikan response kosong");

    let content = "";
    let finishReason = "stop";
    let usage = null;
    const toolCalls = new Map();

    for await (const payload of parseSSE(response.body)) {
      if (payload.usage) usage = payload.usage;
      const choice = payload.choices?.[0];
      if (!choice) continue;
      if (choice.finish_reason) finishReason = choice.finish_reason;
      const delta = choice.delta || {};
      if (typeof delta.content === "string" && delta.content) {
        content += delta.content;
        onContent(delta.content);
      }
      for (const call of delta.tool_calls || []) {
        const current = toolCalls.get(call.index) || { id: "", type: "function", function: { name: "", arguments: "" } };
        if (call.id) current.id = call.id;
        if (call.function?.name) current.function.name += call.function.name;
        if (call.function?.arguments) current.function.arguments += call.function.arguments;
        toolCalls.set(call.index, current);
        onToolCall?.({
          index: call.index,
          id: current.id,
          name: current.function.name,
          arguments: current.function.arguments,
        });
      }
    }

    const calls = [...toolCalls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call);
    return {
      message: {
        role: "assistant",
        content: content || (calls.length ? "" : " "),
        ...(calls.length ? { tool_calls: calls } : {}),
      },
      finishReason,
      usage,
    };
  }
}

async function* parseSSE(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let separator;
      while ((separator = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        for (const line of block.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data) continue;
          if (data === "[DONE]") return;
          try {
            yield JSON.parse(data);
          } catch {
            // Abaikan chunk SSE parsial atau tidak valid.
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
