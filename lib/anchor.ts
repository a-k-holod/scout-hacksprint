import type { RetrievedPage } from "@/lib/events";

const ANCHOR_API = "https://api.anchorbrowser.io";
const PAGE_LIMIT = 3;
const REQUEST_TIMEOUT_MS = 15_000;
const TEXT_LIMIT = 4_000;

type PageSession = {
  read: (url: string) => Promise<string | null>;
  close: () => Promise<void>;
};

type AnchorDependencies = {
  fetchImpl?: typeof fetch;
  connect?: (cdpUrl: string) => Promise<PageSession>;
};

export async function enrichEventPages(
  pages: RetrievedPage[],
  readPages: (urls: string[]) => Promise<ReadonlyMap<string, string>>,
  shouldRead: (url: string) => boolean,
): Promise<{ pages: RetrievedPage[]; opened: number }> {
  const urls = [...new Set(pages.map((page) => page.url))]
    .filter(shouldRead)
    .slice(0, PAGE_LIMIT);

  if (urls.length === 0) {
    return { pages, opened: 0 };
  }

  let texts: ReadonlyMap<string, string>;
  try {
    texts = await readPages(urls);
  } catch {
    return { pages, opened: 0 };
  }

  if (texts.size === 0) {
    return { pages, opened: 0 };
  }

  return {
    opened: texts.size,
    pages: pages.map((page) => {
      const text = texts.get(page.url);
      if (!text) {
        return page;
      }
      return {
        ...page,
        content: `${page.content}\n${text}`.slice(0, 8_000),
      };
    }),
  };
}

export async function readVisiblePages(
  urls: string[],
  apiKey: string,
  dependencies: AnchorDependencies = {},
): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  if (urls.length === 0 || !apiKey.trim()) {
    return found;
  }

  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const connect = dependencies.connect ?? connectOverCdp;
  const session = await startSession(apiKey, fetchImpl);
  if (!session) {
    return found;
  }

  let page: PageSession | null = null;
  try {
    page = await connect(session.cdpUrl);
    for (const url of urls) {
      const text = await page.read(url);
      if (text) {
        found.set(url, text);
      }
    }
  } catch {
    return found;
  } finally {
    await page?.close().catch(() => undefined);
    await endSession(session.id, apiKey, fetchImpl);
  }

  return found;
}

async function startSession(
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<{ id: string; cdpUrl: string } | null> {
  try {
    const response = await fetchImpl(`${ANCHOR_API}/v1/sessions`, {
      method: "POST",
      headers: {
        "anchor-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session: {
          recording: { active: false },
          timeout: { max_duration: 1, idle_timeout: 1 },
        },
        browser: {
          captcha_solver: { active: false },
        },
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      return null;
    }
    const body = (await response.json()) as {
      data?: { id?: unknown; cdp_url?: unknown };
    };
    const id = body.data?.id;
    const cdpUrl = body.data?.cdp_url;
    if (typeof id !== "string" || !id || typeof cdpUrl !== "string" || !cdpUrl) {
      return null;
    }
    return { id, cdpUrl };
  } catch {
    return null;
  }
}

async function endSession(
  sessionId: string,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<void> {
  try {
    await fetchImpl(`${ANCHOR_API}/v1/sessions/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
      headers: { "anchor-api-key": apiKey },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    // The session also ends on its idle timeout.
  }
}

async function connectOverCdp(cdpUrl: string): Promise<PageSession> {
  const ws = new WebSocket(cdpUrl);
  let nextId = 0;
  const pending = new Map<
    number,
    {
      resolve: (value: CdpResult) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("session connection timed out")), REQUEST_TIMEOUT_MS);
    ws.addEventListener("open", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("session connection failed"));
    }, { once: true });
  });

  ws.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as {
      id?: number;
      error?: { message?: string };
      result?: CdpResult;
    };
    if (!message.id || !pending.has(message.id)) {
      return;
    }
    const item = pending.get(message.id);
    if (!item) {
      return;
    }
    clearTimeout(item.timer);
    pending.delete(message.id);
    if (message.error) {
      item.reject(new Error("session command failed"));
      return;
    }
    item.resolve(message.result ?? {});
  });

  function send(method: string, params: Record<string, unknown> = {}, sessionId?: string) {
    const messageId = ++nextId;
    return new Promise<CdpResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(messageId);
        reject(new Error("session command timed out"));
      }, REQUEST_TIMEOUT_MS);
      pending.set(messageId, { resolve, reject, timer });
      const message: { id: number; method: string; params: Record<string, unknown>; sessionId?: string } = {
        id: messageId,
        method,
        params,
      };
      if (sessionId) {
        message.sessionId = sessionId;
      }
      ws.send(JSON.stringify(message));
    });
  }

  const targets = await send("Target.getTargets");
  const pages = (targets.targetInfos ?? []).filter((target) => target.type === "page");
  const targetId = pages[0]?.targetId ?? (await send("Target.createTarget", { url: "about:blank" })).targetId;
  if (!targetId) {
    throw new Error("session has no page");
  }
  const attached = await send("Target.attachToTarget", { targetId, flatten: true });
  if (!attached.sessionId) {
    throw new Error("session page did not attach");
  }
  const sessionId = attached.sessionId;
  await send("Page.enable", {}, sessionId);

  return {
    async read(url: string) {
      try {
        const navigated = await send("Page.navigate", { url }, sessionId);
        if (navigated.errorText) {
          return null;
        }
        return await visibleText(sessionId, send);
      } catch {
        return null;
      }
    },
    async close() {
      ws.close();
    },
  };
}

async function visibleText(
  sessionId: string,
  send: (method: string, params?: Record<string, unknown>, sessionId?: string) => Promise<CdpResult>,
): Promise<string | null> {
  const started = Date.now();
  let text = "";
  while (Date.now() - started < 8_000) {
    const state = await send("Runtime.evaluate", {
      expression: "document.readyState",
      returnByValue: true,
    }, sessionId);
    const value = await send("Runtime.evaluate", {
      expression: "document.body ? document.body.innerText.slice(0, 4000) : ''",
      returnByValue: true,
    }, sessionId);
    text = typeof value.result?.value === "string" ? value.result.value.trim() : "";
    if (state.result?.value === "complete" && text.length > 80) {
      return text.slice(0, TEXT_LIMIT);
    }
    await delay(300);
  }
  return text ? text.slice(0, TEXT_LIMIT) : null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type CdpResult = {
  targetInfos?: { targetId?: string; type?: string }[];
  targetId?: string;
  sessionId?: string;
  errorText?: string;
  result?: { value?: unknown };
};
