import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isOriginApproved,
  pluginConfiguredFetch,
} from "/js/plugins/pluginConfiguredFetch.js";

function makeFakeFetch({ status = 200, body = "", headers = {} } = {}) {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, init });
    return {
      status,
      ok: status >= 200 && status < 300,
      headers: {
        get: (name) => headers[name.toLowerCase()] ?? null,
      },
      text: async () => body,
    };
  };
  return { fakeFetch, calls };
}

async function expectRejection(fn, includes) {
  let threw = false;
  try {
    await fn();
  } catch (error) {
    threw = true;
    if (includes) {
      assert(
        error.message.toLowerCase().includes(includes.toLowerCase()),
        `expected error to include "${includes}", got "${error.message}"`,
      );
    }
  }
  assert(threw, "expected promise to reject");
}

describe("isOriginApproved", () => {
  it("matches identical origins", () => {
    assert(
      isOriginApproved(
        "https://api.example.com/v1/chat",
        "https://api.example.com/v1",
      ),
    );
  });

  it("rejects a different hostname", () => {
    assert(
      !isOriginApproved(
        "https://evil.com/v1/chat",
        "https://api.example.com/v1",
      ),
    );
  });

  it("rejects a different port", () => {
    assert(
      !isOriginApproved(
        "http://localhost:11434/api/chat",
        "http://localhost:8080/api/chat",
      ),
    );
  });

  it("rejects a different protocol", () => {
    assert(!isOriginApproved("http://example.com/x", "https://example.com/x"));
  });

  it("rejects when nothing is approved", () => {
    assert(!isOriginApproved("https://example.com/x", null));
  });

  it("rejects malformed urls", () => {
    assert(!isOriginApproved("not a url", "https://example.com/x"));
  });
});

describe("pluginConfiguredFetch", () => {
  it("rejects when no endpoint is approved", async () => {
    const { fakeFetch, calls } = makeFakeFetch();
    await expectRejection(() =>
      pluginConfiguredFetch("https://api.example.com/x", {}, null, fakeFetch),
    );
    assert.deepEqual(calls.length, 0);
  });

  it("allows a request matching the approved origin", async () => {
    const { fakeFetch, calls } = makeFakeFetch();
    await pluginConfiguredFetch(
      "https://api.example.com/v1/chat/completions",
      {},
      "https://api.example.com/v1",
      fakeFetch,
    );
    assert.deepEqual(calls.length, 1);
  });

  it("rejects a request to a different origin than approved", async () => {
    const { fakeFetch, calls } = makeFakeFetch();
    await expectRejection(() =>
      pluginConfiguredFetch(
        "https://evil.com/x",
        {},
        "https://api.example.com/v1",
        fakeFetch,
      ),
    );
    assert.deepEqual(calls.length, 0);
  });

  it("allows http for an approved loopback endpoint", async () => {
    const { fakeFetch, calls } = makeFakeFetch();
    await pluginConfiguredFetch(
      "http://localhost:11434/api/chat",
      {},
      "http://localhost:11434",
      fakeFetch,
    );
    assert.deepEqual(calls.length, 1);
  });

  it("rejects an approved endpoint that is http and non-loopback", async () => {
    const { fakeFetch, calls } = makeFakeFetch();
    await expectRejection(() =>
      pluginConfiguredFetch(
        "http://example.com/x",
        {},
        "http://example.com/x",
        fakeFetch,
      ),
    );
    assert.deepEqual(calls.length, 0);
  });

  it("allows an Authorization header through", async () => {
    const { fakeFetch, calls } = makeFakeFetch();
    await pluginConfiguredFetch(
      "https://api.example.com/v1/chat",
      { headers: { Authorization: "Bearer sk-test" } },
      "https://api.example.com/v1",
      fakeFetch,
    );
    assert.deepEqual(calls[0].init.headers.Authorization, "Bearer sk-test");
  });

  it("still forbids a Cookie header", async () => {
    const { fakeFetch, calls } = makeFakeFetch();
    await expectRejection(
      () =>
        pluginConfiguredFetch(
          "https://api.example.com/v1/chat",
          { headers: { Cookie: "session=abc" } },
          "https://api.example.com/v1",
          fakeFetch,
        ),
      "header",
    );
    assert.deepEqual(calls.length, 0);
  });

  it("forces credentials=omit and redirect=error", async () => {
    const { fakeFetch, calls } = makeFakeFetch();
    await pluginConfiguredFetch(
      "https://api.example.com/v1/chat",
      {},
      "https://api.example.com/v1",
      fakeFetch,
    );
    assert.deepEqual(calls[0].init.credentials, "omit");
    assert.deepEqual(calls[0].init.redirect, "error");
  });

  it("rejects disallowed methods", async () => {
    const { fakeFetch, calls } = makeFakeFetch();
    await expectRejection(() =>
      pluginConfiguredFetch(
        "https://api.example.com/v1/chat",
        { method: "CONNECT" },
        "https://api.example.com/v1",
        fakeFetch,
      ),
    );
    assert.deepEqual(calls.length, 0);
  });
});
