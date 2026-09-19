import { afterEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { activate } from "./extension.js";

const controller = {
  id: "22222222-2222-4222-8222-222222222222",
  title: "Insider Cat",
  workspace: { working_dir: "/projects/example" },
  execution_status: "idle",
  tags: { smolpaws: "insider", insiderrole: "controller" },
};
const worker = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Review the project",
  execution_status: "waiting_for_confirmation",
  workspace: { working_dir: "/projects/example" },
};
const mounted = [];

function mountApp(overrides = {}) {
  let mount;
  const request = vi.fn(async ({ path, method = "GET", body }) => {
    if (overrides.request) {
      const result = await overrides.request({ path, method, body });
      if (result !== undefined) return result;
    }
    if (path.startsWith("/api/conversations/search")) {
      return { items: [worker], next_page_id: null };
    }
    if (path === "/api/agent-profiles") {
      return {
        profiles: [
          {
            id: "33333333-3333-4333-8333-333333333333",
            name: "My agent",
            agent_kind: "openhands",
          },
        ],
        active_agent_profile_id: "33333333-3333-4333-8333-333333333333",
      };
    }
    if (path === "/api/settings") {
      return {
        conversation_settings: {
          confirmation_mode: true,
          security_analyzer: "llm",
          max_iterations: 42,
        },
      };
    }
    if (path === "/openapi.json") {
      return {
        paths: {
          "/api/conversations": {
            post: {
              requestBody: {
                content: {
                  "application/json": {
                    schema: {
                      properties: {
                        agent_launch_additions: {},
                        agent_profile_id: {},
                      },
                    },
                  },
                },
              },
            },
          },
        },
      };
    }
    if (path === "/api/workspaces") return { workspaces: [] };
    if (path === "/api/conversations" && method === "POST")
      return { ...controller, id: body.conversation_id };
    if (path.includes("/events/search"))
      return { items: [], next_page_id: null };
    if (path.endsWith("/events")) return { success: true };
    if (path === `/api/conversations/${worker.id}`) return worker;
    if (path.startsWith("/api/conversations/"))
      return { ...controller, id: path.split("/")[3] };
    throw new Error(`Unexpected request ${method} ${path}`);
  });
  const host = {
    apiVersion: "1",
    backend: {
      id: overrides.backendId || "backend-one",
      kind: "local",
      orgId: null,
    },
    extension: { name: "insider-cat", version: "0.1.0", resolvedRef: null },
    registerPage: vi.fn((id, factory) => {
      expect(id).toBe("projects");
      mount = factory;
      return vi.fn();
    }),
    navigate: vi.fn(),
    agentServer: { request },
  };
  const disposeActivation = activate(host);
  const container = document.createElement("div");
  document.body.append(container);
  let disposePage = mount({
    container,
    path: overrides.path || "",
    navigate: host.navigate,
  });
  const remount = (path = "") => {
    disposePage?.();
    disposePage = mount({ container, path, navigate: host.navigate });
  };
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    disposePage?.();
    disposeActivation?.();
    container.remove();
  };
  mounted.push(cleanup);
  return { container, request, host, cleanup, remount };
}
const find = (app, action) =>
  app.container.querySelector(`[data-action="${action}"]`);
const draft = (app, text) => {
  find(app, "draft").value = text;
  find(app, "draft").dispatchEvent(new Event("input", { bubbles: true }));
};
const click = (app, action) => find(app, action).click();

afterEach(() => {
  mounted.splice(0).forEach((cleanup) => cleanup());
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("Insider Cat App", () => {
  it.each(["none", "accepted", "uncertain"])(
    "clears a recovered controller-read error and preserves the %s submission notice",
    async (outcome) => {
      let unavailable = false;
      let recovered = false;
      const app = mountApp({
        request: ({ path, method }) => {
          if (path.startsWith("/api/conversations/search"))
            return { items: [controller], next_page_id: null };
          if (path === `/api/conversations/${controller.id}` && unavailable)
            throw new Error("HTTP request failed (502)");
          if (
            path.endsWith("/events") &&
            method === "POST" &&
            outcome === "uncertain"
          )
            throw new Error("Submission response lost");
          if (path.includes("/events/search"))
            return {
              items: recovered
                ? [
                    {
                      id: "recovered-message",
                      llm_message: {
                        role: "assistant",
                        content: [
                          {
                            type: "text",
                            text: "Fresh saved reply after recovery.",
                          },
                        ],
                      },
                    },
                  ]
                : [],
            };
        },
      });
      const notice = () =>
        app.container.querySelector('[data-role="notice"]').textContent;
      await waitFor(() =>
        expect(find(app, "controller").value).toBe(controller.id),
      );
      if (outcome !== "none") {
        draft(app, "Keep this request.");
        click(app, "send");
        await waitFor(() =>
          expect(notice()).toContain(
            outcome === "accepted"
              ? "Message accepted"
              : "Submission response lost",
          ),
        );
      }
      const submissionNotice = notice();
      unavailable = true;
      click(app, "refresh");
      await waitFor(() =>
        expect(notice()).toContain("Could not load the Cat conversation"),
      );
      unavailable = false;
      recovered = true;
      click(app, "refresh");
      await waitFor(() =>
        expect(app.container.textContent).toContain(
          "Fresh saved reply after recovery.",
        ),
      );
      expect(notice()).toBe(submissionNotice);
      if (outcome === "uncertain") {
        expect(find(app, "send").disabled).toBe(true);
        expect(find(app, "draft").value).toBe("Keep this request.");
      }
    },
  );

  it("replaces the /new URL with the created Cat so reloading resumes it", async () => {
    let createdId;
    const request = ({ path, method, body }) => {
      if (path === "/api/conversations" && method === "POST") {
        createdId = body.conversation_id;
        return { ...controller, id: createdId };
      }
      if (path.startsWith("/api/conversations/search"))
        return {
          items: createdId
            ? [worker, { ...controller, id: createdId }]
            : [worker],
          next_page_id: null,
        };
    };
    const first = mountApp({ path: "/new", request });
    await waitFor(() =>
      expect(first.container.textContent).toContain(worker.title),
    );
    click(first, "select-worker");
    draft(first, "Start this Cat.");
    click(first, "send");
    await waitFor(() =>
      expect(first.host.navigate).toHaveBeenCalledWith(
        `/extensions/insider-cat/projects/conversations/${createdId}`,
      ),
    );
    first.cleanup();
    const reloaded = mountApp({ path: `/conversations/${createdId}`, request });
    await waitFor(() =>
      expect(find(reloaded, "controller")?.value).toBe(createdId),
    );
    expect(
      reloaded.request.mock.calls.some(([call]) => call.method === "POST"),
    ).toBe(false);
  });

  it("resumes an explicit Insider controller while excluding incomplete tags, children, and other roles", async () => {
    const app = mountApp({
      request: ({ path }) => {
        if (path.startsWith("/api/conversations/search"))
          return {
            items: [
              controller,
              {
                ...controller,
                id: "missing-role",
                tags: { smolpaws: "insider" },
              },
              {
                ...controller,
                id: "delegated-child",
                parent_conversation_id: controller.id,
              },
              {
                ...controller,
                id: "worker-role",
                tags: { smolpaws: "insider", insiderrole: "worker" },
              },
            ],
            next_page_id: null,
          };
        if (path === `/api/conversations/${controller.id}`) return controller;
      },
    });
    await waitFor(() =>
      expect(find(app, "controller")?.value).toBe(controller.id),
    );
    expect(find(app, "controller").options.length).toBe(2);
    draft(app, "Continue our conversation.");
    click(app, "send");
    await waitFor(() =>
      expect(app.request).toHaveBeenCalledWith(
        expect.objectContaining({
          path: `/api/conversations/${controller.id}/events`,
          method: "POST",
        }),
      ),
    );
    expect(
      app.request.mock.calls.some(
        ([call]) =>
          call.path === "/api/conversations" && call.method === "POST",
      ),
    ).toBe(false);
    expect(
      app.request.mock.calls.some(([call]) => call.method === "PATCH"),
    ).toBe(false);
  });

  it("condenses the selected Cat without creating or sending another conversation", async () => {
    const app = mountApp({
      request: ({ path }) =>
        path.startsWith("/api/conversations/search")
          ? { items: [controller], next_page_id: null }
          : undefined,
    });
    await waitFor(() =>
      expect(find(app, "controller")?.value).toBe(controller.id),
    );
    draft(app, "/condense");
    click(app, "send");
    await waitFor(() =>
      expect(app.request).toHaveBeenCalledWith({
        path: `/api/conversations/${controller.id}/condense`,
        method: "POST",
      }),
    );
    await waitFor(() =>
      expect(app.container.textContent).toContain("Conversation condensed"),
    );
    expect(find(app, "controller").value).toBe(controller.id);
    expect(
      app.request.mock.calls.filter(([call]) => call.method === "POST"),
    ).toHaveLength(1);
  });

  it("preserves an approval request when /condense is entered", async () => {
    const app = mountApp({
      request: ({ path }) => {
        if (path.startsWith("/api/conversations/search"))
          return { items: [controller], next_page_id: null };
        if (path === `/api/conversations/${controller.id}`)
          return {
            ...controller,
            execution_status: "waiting_for_confirmation",
          };
      },
    });
    await waitFor(() =>
      expect(find(app, "controller")?.value).toBe(controller.id),
    );
    draft(app, "/condense");
    click(app, "send");
    await waitFor(() =>
      expect(app.container.textContent).toContain(
        "resolve its approval request",
      ),
    );
    expect(
      app.request.mock.calls.some(([call]) => call.method === "POST"),
    ).toBe(false);
    expect(find(app, "draft").value).toBe("/condense");
  });

  it("handles /new locally and creates a second durable Cat on the next message", async () => {
    const app = mountApp({
      path: `/conversations/${controller.id}`,
      request: ({ path }) => {
        if (path.startsWith("/api/conversations/search"))
          return {
            items: [worker, { ...controller, workspace: worker.workspace }],
            next_page_id: null,
          };
      },
    });
    await waitFor(() =>
      expect(find(app, "controller")?.value).toBe(controller.id),
    );
    draft(app, "/new");
    click(app, "send");
    expect(find(app, "controller").value).toBe("");
    expect(find(app, "draft").value).toBe("");
    expect(app.host.navigate).toHaveBeenCalledWith(
      "/extensions/insider-cat/projects/new",
    );
    expect(
      app.request.mock.calls.some(([call]) => call.method === "POST"),
    ).toBe(false);
    draft(app, "A separate planning conversation.");
    click(app, "send");
    await waitFor(() =>
      expect(
        app.request.mock.calls.some(
          ([call]) =>
            call.path === "/api/conversations" && call.method === "POST",
        ),
      ).toBe(true),
    );
    const create = app.request.mock.calls.find(
      ([call]) => call.path === "/api/conversations" && call.method === "POST",
    )[0];
    expect(create.body.conversation_id).not.toBe(controller.id);
    expect(create.body.tags).toEqual(controller.tags);
    expect(create.body.workspace).toEqual(worker.workspace);
    expect(create.body.initial_message.content[0].text).not.toContain("/new");
  });

  it("resumes an explicit older Cat link and remembers it across activation", async () => {
    const older = { ...controller, id: "44444444-4444-4444-8444-444444444444" };
    const request = ({ path }) => {
      if (path.startsWith("/api/conversations/search"))
        return { items: [controller, older], next_page_id: null };
    };
    const first = mountApp({ request, path: `/conversations/${older.id}` });
    await waitFor(() =>
      expect(find(first, "controller")?.value).toBe(older.id),
    );
    click(first, "open-controller");
    expect(first.host.navigate).toHaveBeenCalledWith(
      `/conversations/${older.id}`,
    );
    first.cleanup();
    const resumed = mountApp({ request });
    await waitFor(() =>
      expect(find(resumed, "controller")?.value).toBe(older.id),
    );
    expect(
      resumed.request.mock.calls.some(([call]) => call.method === "POST"),
    ).toBe(false);
  });

  it("rejects an explicit regular-worker ID instead of silently switching the Cat", async () => {
    const app = mountApp({
      path: `/conversations/${worker.id}`,
      request: ({ path }) => {
        if (path.startsWith("/api/conversations/search"))
          return { items: [worker, controller], next_page_id: null };
      },
    });
    await waitFor(() =>
      expect(app.container.textContent).toContain(
        "This conversation is not an Insider controller",
      ),
    );
    expect(find(app, "controller").value).toBe("");
    expect(find(app, "send").disabled).toBe(true);
    expect(
      app.request.mock.calls.some(([call]) => call.method === "POST"),
    ).toBe(false);
  });

  it("loads explicit pages, keeps drafts when a full-ID worker is selected, and navigates inside Canvas", async () => {
    const app = mountApp({
      request: ({ path }) => {
        if (path.includes("page_id=next-page"))
          return {
            items: [
              {
                id: "ended",
                title: "Another task",
                execution_status: "finished",
              },
            ],
            next_page_id: null,
          };
        if (path.startsWith("/api/conversations/search"))
          return { items: [worker], next_page_id: "next-page" };
      },
    });
    await waitFor(() =>
      expect(app.container.textContent).toContain(worker.title),
    );
    expect(app.container.textContent).toContain("Approval requested");
    draft(app, "Please explain the pending decision.");
    click(app, "select-worker");
    expect(find(app, "draft").value).toBe(
      "Please explain the pending decision.",
    );
    expect(app.container.querySelector('[data-role="target"] span').title).toBe(
      worker.id,
    );
    click(app, "open-worker");
    expect(app.host.navigate).toHaveBeenCalledWith(
      `/conversations/${worker.id}`,
    );
    click(app, "load-more");
    await waitFor(() =>
      expect(app.container.textContent).toContain("Another task"),
    );
    expect(app.container.textContent).toContain("Run ended");
    expect(find(app, "load-more").hidden).toBe(true);
    expect(
      app.request.mock.calls.every(
        ([call]) => !call.method || call.method === "GET",
      ),
    ).toBe(true);
  });

  it("creates one durable controller with the active profile and confirmation policy, then sends follow-ups to its ID", async () => {
    const app = mountApp();
    await waitFor(() =>
      expect(app.container.textContent).toContain(worker.title),
    );
    click(app, "select-worker");
    draft(app, "Explain this work.");
    click(app, "send");
    await waitFor(() =>
      expect(
        app.request.mock.calls.some(
          ([call]) =>
            call.method === "POST" && call.path === "/api/conversations",
        ),
      ).toBe(true),
    );
    const create = app.request.mock.calls.find(
      ([call]) => call.method === "POST" && call.path === "/api/conversations",
    )[0];
    expect(create.body).toMatchObject({
      agent_profile_id: "33333333-3333-4333-8333-333333333333",
      tags: controller.tags,
      confirmation_policy: {
        kind: "ConfirmRisky",
        threshold: "HIGH",
        confirm_unknown: true,
      },
      security_analyzer: { kind: "LLMSecurityAnalyzer" },
      max_iterations: 42,
      workspace: { working_dir: "/projects/example" },
      initial_message: { run: true },
    });
    expect(
      create.body.agent_launch_additions.system_message_suffix_append,
    ).toContain("sibling of SmolPaws");
    expect(create.body.initial_message.content[0].text).toContain(worker.id);
    await waitFor(() => expect(find(app, "send").disabled).toBe(false));
    draft(app, "Continue the explanation.");
    click(app, "send");
    await waitFor(() =>
      expect(app.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "POST",
          path: `/api/conversations/${create.body.conversation_id}/events`,
        }),
      ),
    );
    expect(
      app.request.mock.calls.filter(
        ([call]) =>
          call.path === "/api/conversations" && call.method === "POST",
      ),
    ).toHaveLength(1);
  });

  it("restores the durable controller and shows saved text without leaking selection across backends", async () => {
    const restored = mountApp({
      request: ({ path }) => {
        if (path.startsWith("/api/conversations/search"))
          return { items: [worker, controller], next_page_id: null };
        if (path.includes("/events/search"))
          return {
            items: [
              {
                id: "finish",
                timestamp: "2026-09-14T10:00:01Z",
                source: "agent",
                action: {
                  kind: "FinishAction",
                  message: "A saved final answer",
                },
              },
              {
                id: "reply",
                timestamp: "2026-09-14T10:00:00Z",
                source: "agent",
                llm_message: {
                  role: "assistant",
                  content: [{ type: "text", text: "A saved result" }],
                },
                reasoning_content: "Private reasoning must not render",
              },
            ],
            next_page_id: null,
          };
      },
    });
    await waitFor(() =>
      expect(restored.container.textContent).toContain("A saved result"),
    );
    expect(restored.container.textContent).toContain("A saved final answer");
    expect(restored.container.textContent).not.toContain(
      "Private reasoning must not render",
    );
    expect(
      restored.request.mock.calls.some(([call]) => call.method === "POST"),
    ).toBe(false);
    const other = mountApp({ backendId: "backend-two" });
    await waitFor(() =>
      expect(other.container.textContent).toContain(worker.title),
    );
    expect(
      other.request.mock.calls.some(([call]) =>
        call.path.includes("/events/search"),
      ),
    ).toBe(false);
  });

  it("does not recreate after an uncertain send and ignores late reads after page cleanup", async () => {
    const app = mountApp({
      request: ({ path, method }) => {
        if (path === "/api/conversations" && method === "POST")
          throw new Error("Network interrupted");
      },
    });
    await waitFor(() =>
      expect(app.container.textContent).toContain(worker.title),
    );
    click(app, "select-worker");
    draft(app, "Do this once.");
    click(app, "send");
    await waitFor(() =>
      expect(app.container.textContent).toContain(
        "Check the conversation before sending again",
      ),
    );
    expect(find(app, "draft").value).toBe("Do this once.");
    expect(find(app, "send").disabled).toBe(true);
    app.cleanup();
    expect(app.container.childElementCount).toBe(0);
  });

  it("keeps an in-flight creation locked across page navigation and reconciles its result", async () => {
    let resolveCreate;
    const app = mountApp({
      request: ({ path, method, body }) => {
        if (path === "/api/conversations" && method === "POST") {
          return new Promise((resolve) => {
            resolveCreate = () =>
              resolve({ ...controller, id: body.conversation_id });
          });
        }
      },
    });
    await waitFor(() =>
      expect(app.container.textContent).toContain(worker.title),
    );
    click(app, "select-worker");
    draft(app, "Start once.");
    click(app, "send");
    await waitFor(() => expect(resolveCreate).toBeTypeOf("function"));
    draft(app, "My next request, still a draft.");
    app.remount();
    await waitFor(() =>
      expect(app.container.textContent).toContain(worker.title),
    );
    expect(find(app, "send").disabled).toBe(true);
    expect(find(app, "new-cat").disabled).toBe(true);
    resolveCreate();
    await waitFor(() => expect(find(app, "send").disabled).toBe(false));
    expect(find(app, "draft").value).toBe("My next request, still a draft.");
    expect(
      app.request.mock.calls.filter(
        ([call]) =>
          call.path === "/api/conversations" && call.method === "POST",
      ),
    ).toHaveLength(1);
  });

  it("finds controllers on later pages and requires a choice when more than one exists", async () => {
    const another = {
      ...controller,
      id: "44444444-4444-4444-8444-444444444444",
    };
    const app = mountApp({
      request: ({ path }) => {
        if (path.includes("page_id=controllers"))
          return { items: [controller, another], next_page_id: null };
        if (path.startsWith("/api/conversations/search"))
          return { items: [worker], next_page_id: "controllers" };
      },
    });
    await waitFor(() =>
      expect(find(app, "controller")?.options.length).toBe(3),
    );
    expect(find(app, "controller").value).toBe("");
    expect(find(app, "send").disabled).toBe(true);
    click(app, "new-cat");
    expect(app.host.navigate).toHaveBeenCalledWith(
      "/extensions/insider-cat/projects/new",
    );
    expect(find(app, "send").disabled).toBe(false);
    expect(find(app, "controller").options.length).toBe(3);
    find(app, "controller").value = another.id;
    find(app, "controller").dispatchEvent(
      new Event("change", { bubbles: true }),
    );
    expect(app.host.navigate).toHaveBeenCalledWith(
      `/extensions/insider-cat/projects/conversations/${another.id}`,
    );
    await waitFor(() =>
      expect(
        app.request.mock.calls.some(
          ([call]) => call.path === `/api/conversations/${another.id}`,
        ),
      ).toBe(true),
    );
    expect(
      app.request.mock.calls.some(([call]) => call.method === "POST"),
    ).toBe(false);
  });

  it.each(["/api/settings", "/api/agent-profiles"])(
    "does not create work when %s preflight fails",
    async (failedPath) => {
      const app = mountApp({
        request: ({ path }) => {
          if (path === failedPath) throw new Error("Preflight unavailable");
        },
      });
      await waitFor(() =>
        expect(app.container.textContent).toContain(worker.title),
      );
      click(app, "select-worker");
      draft(app, "Keep this request.");
      click(app, "send");
      await waitFor(() =>
        expect(app.container.textContent).toContain("Preflight unavailable"),
      );
      expect(find(app, "draft").value).toBe("Keep this request.");
      expect(
        app.request.mock.calls.some(([call]) => call.method === "POST"),
      ).toBe(false);
    },
  );

  it("does not submit after the page is disposed during preflight", async () => {
    let resolveSettings;
    const app = mountApp({
      request: ({ path }) => {
        if (path === "/api/settings")
          return new Promise((resolve) => {
            resolveSettings = resolve;
          });
      },
    });
    await waitFor(() =>
      expect(app.container.textContent).toContain(worker.title),
    );
    click(app, "select-worker");
    draft(app, "Wait for settings.");
    click(app, "send");
    await waitFor(() => expect(resolveSettings).toBeTypeOf("function"));
    app.cleanup();
    resolveSettings({ conversation_settings: { confirmation_mode: true } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      app.request.mock.calls.some(([call]) => call.method === "POST"),
    ).toBe(false);
    expect(app.container.childElementCount).toBe(0);
  });
});
