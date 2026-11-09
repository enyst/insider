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
    if (path === "/server_info") return { conversation_runtime: "local" };
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
    extension: {
      name: "insider-cat",
      version: "0.2.0-beta.1",
      resolvedRef: null,
    },
    registerPage: vi.fn((id, factory) => {
      expect(id).toBe("projects");
      mount = factory;
      return vi.fn();
    }),
    registerCompanion: overrides.registerCompanion,
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

describe("Insider Cat work board", () => {
  const running = {
    ...worker,
    id: "44444444-4444-4444-8444-444444444444",
    title: "Build the release",
    execution_status: "running",
    tags: { insidercat: controller.id, insiderrole: "worker" },
  };
  const idle = {
    ...worker,
    id: "55555555-5555-4555-8555-555555555555",
    title: "Old experiment",
    execution_status: "idle",
  };
  const groups = (app) =>
    [...app.container.querySelectorAll(".cat-group")].map((section) => [
      section.dataset.group,
      [...section.querySelectorAll(".cat-card-title")].map(
        (node) => node.textContent,
      ),
    ]);

  const project = {
    id: "77777777-7777-4777-8777-777777777777",
    name: "Release 0.2",
    description: "Ship the Projects release.",
    coordinator_conversation_id: controller.id,
  };
  const member = (c) => ({
    ...c,
    tags: { ...(c.tags || {}), project: project.id.replace(/-/g, "") },
  });
  // A backend with Projects where the Cat coordinates `project`.
  const projectWorld =
    (items, extra = () => undefined) =>
    async (args) => {
      const result = await extra(args);
      if (result !== undefined) return result;
      if (args.path.startsWith("/api/conversations/search"))
        return { items: [controller, ...items], next_page_id: null };
      if (args.path === "/api/projects") return { projects: [project] };
      if (args.path === `/api/projects/${project.id}/artifacts`)
        return { artifacts: [] };
    };

  it("groups the project's work by what it needs and collapses idle work", async () => {
    const app = mountApp({
      request: projectWorld([member(idle), member(running), member(worker)]),
    });
    await waitFor(() => expect(groups(app).length).toBe(3));
    expect(groups(app)).toEqual([
      ["needsYou", [worker.title]],
      ["working", [running.title]],
      ["idle", []],
    ]);
    const idleHead = find(app, "group-idle");
    expect(idleHead.getAttribute("aria-expanded")).toBe("false");
    idleHead.click();
    expect(groups(app)[2]).toEqual(["idle", [idle.title]]);
  });

  it("exposes card actions and groups to assistive technology", async () => {
    const app = mountApp({
      request: projectWorld([member(running), member(worker)]),
    });
    await waitFor(() => expect(groups(app).length).toBe(2));

    const title = app.container.querySelector(".cat-card-title");
    expect(title.tagName).toBe("H3");
    expect(title.textContent).toBe(worker.title);

    expect(find(app, "open-worker").getAttribute("aria-label")).toBe(
      `Open ${worker.title}`,
    );
    expect(find(app, "resolve-worker").getAttribute("aria-label")).toBe(
      `Resolve ${worker.title}`,
    );

    const head = find(app, "group-needsYou");
    expect(head.getAttribute("aria-controls")).toBe("group-panel-needsYou");
    const panel = app.container.querySelector("#group-panel-needsYou");
    expect(panel.getAttribute("role")).toBe("group");
    expect(panel.getAttribute("aria-label")).toBe("Needs you");
    expect(panel.querySelectorAll(".cat-card").length).toBe(1);
  });

  it("heads the board with the project's name, goal and progress, and links each part's PR", async () => {
    const app = mountApp({
      request: projectWorld([member(running), member(worker)], ({ path }) => {
        if (path.includes(`/conversations/${running.id}/messages`))
          return {
            messages: [
              {
                source: "agent",
                text: "Opened https://github.com/enyst/insider/pull/3 first.",
              },
              {
                source: "user",
                text: "See https://github.com/enyst/insider/pull/99",
              },
              {
                source: "agent",
                text: "Replaced it with https://github.com/enyst/insider/pull/7.",
              },
            ],
          };
        if (path.includes("/messages")) return { messages: [] };
        if (
          path ===
          "/api/git/repositories/enyst/insider/pull-requests/7?provider=github"
        )
          return {
            state: "open",
            draft: false,
            title: "Projects header",
            url: "https://github.com/enyst/insider/pull/7",
            checks: "failure",
          };
      }),
    });
    await waitFor(() =>
      expect(
        app.container.querySelector('[data-role="work-title"]').textContent,
      ).toBe("Release 0.2"),
    );
    expect(
      app.container.querySelector('[data-role="project-goal"]').textContent,
    ).toBe("Ship the Projects release.");
    expect(
      app.container.querySelector('[data-role="project-progress"]').textContent,
    ).toBe("Needs you 1 · Working 1");
    await waitFor(() =>
      expect(app.container.querySelector(".cat-card-pr")).not.toBeNull(),
    );
    await waitFor(() =>
      expect(app.container.querySelector(".cat-card-pr").textContent).toBe(
        "PR enyst/insider#7 · open · checks failing",
      ),
    );
    const pr = app.container.querySelector(".cat-card-pr");
    expect(pr.dataset.checks).toBe("failure");
    expect(pr.getAttribute("href")).toBe(
      "https://github.com/enyst/insider/pull/7",
    );
    expect(pr.getAttribute("aria-label")).toBe(
      "PR enyst/insider#7 · open · checks failing — opens in a new tab",
    );
    expect(pr.closest("[data-card]").dataset.card).toBe(running.id);
    expect(app.container.querySelectorAll(".cat-card-pr").length).toBe(1);
  });

  it("reads a PR's checks again on Refresh, and keeps the plain link without a token", async () => {
    let statusReads = 0;
    const app = mountApp({
      request: projectWorld([member(running), member(worker)], ({ path }) => {
        if (path.includes(`/conversations/${running.id}/messages`))
          return {
            messages: [
              {
                source: "agent",
                text: "https://github.com/enyst/insider/pull/7",
              },
            ],
          };
        if (path.includes(`/conversations/${worker.id}/messages`))
          return {
            messages: [
              {
                source: "agent",
                text: "https://github.com/enyst/insider/pull/8",
              },
            ],
          };
        if (
          path ===
          "/api/git/repositories/enyst/insider/pull-requests/7?provider=github"
        ) {
          statusReads += 1;
          return {
            state: "open",
            draft: false,
            url: "https://github.com/enyst/insider/pull/7",
            checks: statusReads === 1 ? "pending" : "success",
          };
        }
        if (
          path ===
          "/api/git/repositories/enyst/insider/pull-requests/8?provider=github"
        )
          throw Object.assign(new Error("HTTP request failed (409)"), {
            status: 409,
          });
      }),
    });
    const prOf = (c) =>
      app.container.querySelector(`[data-card="${c.id}"] .cat-card-pr`);
    await waitFor(() =>
      expect(prOf(running)?.textContent).toBe(
        "PR enyst/insider#7 · open · checks running",
      ),
    );
    await waitFor(() =>
      expect(prOf(worker)?.textContent).toBe("PR enyst/insider#8"),
    );
    expect(prOf(worker).dataset.checks).toBeUndefined();
    expect(statusReads).toBe(1);
    click(app, "refresh");
    await waitFor(() =>
      expect(prOf(running).textContent).toBe(
        "PR enyst/insider#7 · open · checks pass",
      ),
    );
    expect(statusReads).toBe(2);
  });

  it("keeps one Cat per project: no chooser inside a Cat, and projects listed by name", async () => {
    const app = mountApp({ request: projectWorld([member(running)]) });
    await waitFor(() =>
      expect(
        app.container.querySelector('[data-role="work-title"]').textContent,
      ).toBe("Release 0.2"),
    );
    const picker = app.container.querySelector('[data-role="picker"]');
    expect(picker.hidden).toBe(true);
    expect(find(app, "all-projects").hidden).toBe(false);
    click(app, "all-projects");
    expect(picker.hidden).toBe(false);
    expect(find(app, "all-projects").hidden).toBe(true);
    expect(find(app, "controller").value).toBe("");
    expect(
      [...find(app, "controller").options].map((o) => o.textContent),
    ).toEqual(["Choose a project", "Release 0.2"]);
    expect(find(app, "new-cat").textContent).toBe("New project");
    expect(app.host.navigate).toHaveBeenLastCalledWith(
      "/extensions/insider-cat/projects",
    );
    // On the list, Send can't start a second Cat by accident.
    find(app, "draft").value = "hello";
    expect(find(app, "send").disabled).toBe(true);
    // A remount (route change, language) keeps the list.
    app.remount("");
    await waitFor(() =>
      expect(
        [...find(app, "controller").options].map((o) => o.textContent),
      ).toEqual(["Choose a project", "Release 0.2"]),
    );
    expect(find(app, "controller").value).toBe("");
    expect(app.container.querySelector('[data-role="picker"]').hidden).toBe(
      false,
    );
    click(app, "new-cat");
    expect(app.container.querySelector('[data-role="picker"]').hidden).toBe(
      true,
    );
    expect(find(app, "all-projects").hidden).toBe(false);
  });

  it("goes back to the project list when the route does", async () => {
    const app = mountApp({ request: projectWorld([member(running)]) });
    await waitFor(() =>
      expect(find(app, "controller").value).toBe(controller.id),
    );
    app.remount(`conversations/${controller.id}`);
    await waitFor(() =>
      expect(find(app, "controller").value).toBe(controller.id),
    );
    app.remount("");
    await waitFor(() =>
      expect(app.container.querySelector('[data-role="picker"]').hidden).toBe(
        false,
      ),
    );
    expect(find(app, "controller").value).toBe("");
    expect(find(app, "send").disabled).toBe(true);
  });

  it("dictates into the draft with the microphone, apart from real-time voice", async () => {
    const started = [];
    globalThis.webkitSpeechRecognition = class {
      start() {
        started.push(this);
      }
      stop() {
        this.onend?.();
      }
    };
    try {
      const app = mountApp({ request: projectWorld([member(running)]) });
      await waitFor(() => expect(find(app, "dictate").hidden).toBe(false));
      expect(find(app, "voice-start").closest(".cat-composer")).not.toBeNull();
      find(app, "draft").value = "Please";
      click(app, "dictate");
      expect(find(app, "dictate").getAttribute("aria-pressed")).toBe("true");
      started[0].onresult({
        resultIndex: 0,
        results: [
          Object.assign([{ transcript: " ship it " }], { isFinal: true }),
        ],
      });
      expect(find(app, "draft").value).toBe("Please ship it");
      click(app, "dictate");
      expect(find(app, "dictate").getAttribute("aria-pressed")).toBe("false");
      // A refused microphone says so instead of silently turning off.
      click(app, "dictate");
      started[1].onerror({ error: "not-allowed" });
      expect(find(app, "dictate").getAttribute("aria-pressed")).toBe("false");
      await waitFor(() =>
        expect(app.container.textContent).toContain(
          "Dictation stopped: the browser couldn't use the microphone.",
        ),
      );
    } finally {
      delete globalThis.webkitSpeechRecognition;
    }
  });

  it("says how to turn Projects on when the server has it off", async () => {
    const other = {
      ...controller,
      id: "99999999-9999-4999-8999-999999999999",
      title: "Other Cat",
    };
    const app = mountApp({
      request: async ({ path }) => {
        if (path.startsWith("/api/conversations/search"))
          return { items: [controller, other], next_page_id: null };
        if (path === "/api/projects")
          throw Object.assign(new Error("HTTP request failed (404)"), {
            status: 404,
          });
      },
    });
    const note = () =>
      app.container.querySelector('[data-role="projects-off"]');
    await waitFor(() => expect(note().hidden).toBe(false));
    expect(note().textContent).toContain(
      "Projects is turned off on this server",
    );
    click(app, "projects-settings");
    expect(app.host.navigate).toHaveBeenLastCalledWith(
      "/settings/experimental",
    );
    find(app, "controller").value = controller.id;
    find(app, "controller").dispatchEvent(new Event("change"));
    expect(note().hidden).toBe(true);
  });

  it("shows what an asking conversation needs on its card", async () => {
    const asking = member({
      ...idle,
      execution_status: "finished",
      tags: { turn: "asked", ask: "Keep the redirects or remove them?" },
    });
    const app = mountApp({
      request: projectWorld([asking, member(running)]),
    });
    await waitFor(() => expect(groups(app).length).toBe(2));
    expect(groups(app)[0]).toEqual(["needsYou", [asking.title]]);
    const cardAsk = app.container.querySelector(".cat-card-ask");
    expect(cardAsk.textContent).toBe("Keep the redirects or remove them?");
    expect(app.container.querySelectorAll(".cat-card-ask").length).toBe(1);
  });

  it("shows only the project's conversations, with no search, folders or tracking", async () => {
    const app = mountApp({
      request: projectWorld([member(running), worker]),
    });
    await waitFor(() =>
      expect(groups(app)).toEqual([["working", [running.title]]]),
    );
    for (const gone of [
      "search",
      "project",
      "scope",
      "load-more",
      "select-worker",
      "track-worker",
    ])
      expect(find(app, gone)).toBeNull();
    // The card says when the conversation last moved, not which folder it is in.
    expect(
      app.container.querySelector(".cat-card-meta").textContent,
    ).not.toContain("/projects/example");
  });

  it("keeps the project board when its files can't be read", async () => {
    const app = mountApp({
      request: projectWorld([member(running)], ({ path }) => {
        if (path === `/api/projects/${project.id}/artifacts`)
          throw Object.assign(new Error("HTTP request failed (500)"), {
            status: 500,
          });
      }),
    });
    await waitFor(() =>
      expect(groups(app)).toEqual([["working", [running.title]]]),
    );
    expect(app.container.querySelector('[data-role="files"]').hidden).toBe(
      true,
    );
    draft(app, "What is left?");
    click(app, "send");
    await waitFor(() =>
      expect(app.request).toHaveBeenCalledWith(
        expect.objectContaining({
          path: `/api/conversations/${controller.id}/events`,
          method: "POST",
        }),
      ),
    );
    const sent = app.request.mock.calls.find(
      ([call]) => call.path === `/api/conversations/${controller.id}/events`,
    )[0];
    expect(JSON.stringify(sent.body)).toContain("Release 0.2");
  });

  it("does not carry a project into a new Cat", async () => {
    const app = mountApp({ request: projectWorld([member(running)]) });
    await waitFor(() =>
      expect(groups(app)).toEqual([["working", [running.title]]]),
    );
    click(app, "new-cat");
    expect(groups(app)).toEqual([]);
    draft(app, "Start fresh.");
    click(app, "send");
    await waitFor(() =>
      expect(app.request).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/conversations", method: "POST" }),
      ),
    );
    const create = app.request.mock.calls.find(
      ([call]) => call.path === "/api/conversations" && call.method === "POST",
    )[0];
    expect(create.body.initial_message.content[0].text).not.toContain(
      "Release 0.2",
    );
  });

  it("shows the Cat's own work on a backend without Projects", async () => {
    const other = {
      ...controller,
      id: "66666666-6666-4666-8666-666666666666",
      title: "Second Cat",
    };
    const app = mountApp({
      request: ({ path }) => {
        if (path.startsWith("/api/conversations/search"))
          return {
            items: [controller, other, running, worker],
            next_page_id: null,
          };
        if (path === `/api/conversations/${other.id}`) return other;
      },
    });
    await waitFor(() => expect(find(app, "controller").options.length).toBe(3));
    find(app, "controller").value = controller.id;
    find(app, "controller").dispatchEvent(new Event("change"));
    await waitFor(() =>
      expect(groups(app)).toEqual([["working", [running.title]]]),
    );
    find(app, "controller").value = other.id;
    find(app, "controller").dispatchEvent(new Event("change"));
    expect(groups(app)).toEqual([]);
    expect(app.container.querySelector(".cat-cards").textContent).not.toBe("");
  });

  it("resolves from the saved tags, keeps focus, reopens, and reports a failed update", async () => {
    let saved = { team: "web", project: project.id.replace(/-/g, "") };
    let fail = false;
    const app = mountApp({
      request: projectWorld([], ({ path, method, body }) => {
        if (path.startsWith("/api/conversations/search"))
          return {
            items: [
              controller,
              { ...worker, execution_status: "finished", tags: saved },
            ],
            next_page_id: null,
          };
        if (path === `/api/conversations/${worker.id}` && method === "GET")
          return { ...worker, execution_status: "finished", tags: saved };
        if (method === "PATCH") {
          if (fail) throw new Error("tag update refused");
          saved = body.tags;
          return { success: true };
        }
      }),
    });
    await waitFor(() =>
      expect(groups(app)).toEqual([["finished", [worker.title]]]),
    );
    click(app, "resolve-worker");
    await waitFor(() =>
      expect(app.request).toHaveBeenCalledWith({
        path: `/api/conversations/${worker.id}`,
        method: "PATCH",
        body: { tags: { ...saved, resolved: "user" } },
      }),
    );
    // Resolved starts collapsed; focus follows the card to its group toggle.
    await waitFor(() => expect(groups(app)).toEqual([["resolved", []]]));
    expect(document.activeElement).toBe(find(app, "group-resolved"));
    expect(
      app.container.querySelector('[data-role="board-status"]').textContent,
    ).toBe("Review the project — Resolved");
    find(app, "group-resolved").click();
    expect(document.activeElement).toBe(find(app, "group-resolved"));
    expect(find(app, "resolve-worker").textContent).toBe("Reopen");
    fail = true;
    click(app, "resolve-worker");
    await waitFor(() =>
      expect(
        app.container.querySelector('[data-role="notice"]').textContent,
      ).toBe("Could not update this conversation: tag update refused"),
    );
    expect(find(app, "resolve-worker").textContent).toBe("Reopen");
    fail = false;
    click(app, "resolve-worker");
    await waitFor(() =>
      expect(saved).toEqual({
        team: "web",
        project: project.id.replace(/-/g, ""),
      }),
    );
    expect(
      app.container.querySelector('[data-role="board-status"]').textContent,
    ).toBe("Review the project — Finished, ready to check");
  });

  it.each([
    [
      '[Sent by "Lead" (conversation abc), the coordinator of your project, not by the person.]',
      "[Sent by",
      "Another conversation",
    ],
    [
      '[Update from "Lead" (conversation abc), a conversation in your project, not from the person. It finished its turn; its final message follows.]',
      "[Update from",
      "Another conversation",
    ],
    [
      '[Reply in "Lead" (conversation abc), a conversation in your project. Its final reply to the person follows.]',
      "[Reply in",
      "Another conversation",
    ],
    [
      '[Message from the person in "Lead" (conversation abc), a conversation in your project. For your awareness: that conversation already has it and works on it, so do not forward or repeat it. The person\'s words follow.]',
      "[Message from the person",
      "You, in another conversation",
    ],
  ])(
    "labels a message another conversation sent and drops the agent header %#",
    async (header, prefix, label) => {
      const app = mountApp({
        request: ({ path }) => {
          if (path.startsWith("/api/conversations/search"))
            return { items: [controller], next_page_id: null };
          if (path.includes("/events/search"))
            return {
              items: [
                {
                  sender: `conversation:${worker.id.replace(/-/g, "")}`,
                  llm_message: {
                    role: "user",
                    content: [
                      { type: "text", text: header },
                      {
                        type: "text",
                        text: `Please summarize the board. I am ${worker.id}.`,
                      },
                    ],
                  },
                },
              ],
            };
          if (
            [worker.id, worker.id.replace(/-/g, "")].some(
              (id) => path === `/api/conversations/${id}`,
            )
          )
            return { ...worker, title: "Lead" };
        },
      });
      await waitFor(() =>
        expect(
          app.container.querySelector(
            '.cat-message[data-speaker="conversation"]',
          ),
        ).not.toBeNull(),
      );
      const row = app.container.querySelector(
        '.cat-message[data-speaker="conversation"]',
      );
      expect(row.querySelector("strong").textContent).toBe(label);
      expect(row.textContent).toContain("Please summarize the board.");
      expect(row.textContent).not.toContain(prefix);
      await waitFor(() =>
        expect(row.querySelector(".cat-ref")?.textContent).toContain("Lead"),
      );
      // The sender named again in the text still gets one card.
      expect(row.querySelectorAll(".cat-ref").length).toBe(1);
    },
  );

  it("asks again for a live card after a transient error when the person refreshes", async () => {
    let failures = 1;
    const app = mountApp({
      request: ({ path }) => {
        if (path.startsWith("/api/conversations/search"))
          return { items: [controller], next_page_id: null };
        if (path.includes("/events/search"))
          return {
            items: [
              {
                id: "a1",
                llm_message: {
                  role: "assistant",
                  content: [{ type: "text", text: `Started ${worker.id}.` }],
                },
              },
            ],
          };
        if (path === `/api/conversations/${worker.id}`) {
          if (failures-- > 0)
            throw Object.assign(
              new Error("HTTP request failed (503 Service Unavailable)"),
              { status: 503 },
            );
          return { ...worker, title: "Back again" };
        }
      },
    });
    const reads = () =>
      app.request.mock.calls.filter(
        ([call]) => call.path === `/api/conversations/${worker.id}`,
      ).length;
    await waitFor(() => expect(reads()).toBe(1));
    expect(app.container.querySelector(".cat-ref")).toBeNull();
    click(app, "refresh");
    await waitFor(() =>
      expect(app.container.querySelector(".cat-ref")?.textContent).toContain(
        "Back again",
      ),
    );
  });

  it("shows reaction chips on the message they target", async () => {
    const app = mountApp({
      request: ({ path }) => {
        if (path.startsWith("/api/conversations/search"))
          return { items: [controller], next_page_id: null };
        if (path.includes("/events/search"))
          return {
            items: [
              {
                kind: "ReactionEvent",
                target_event_id: "f1",
                emoji: "tada",
                source: "agent",
                removed: false,
              },
              {
                kind: "ReactionEvent",
                target_event_id: "f1",
                emoji: "tada",
                source: "user",
                removed: false,
              },
              {
                id: "f1",
                action: { kind: "FinishAction", message: "All finished." },
              },
              {
                kind: "ReactionEvent",
                target_event_id: "u1",
                emoji: "eyes",
                source: "agent",
                removed: true,
              },
              {
                kind: "ReactionEvent",
                target_event_id: "a1",
                emoji: "+1",
                source: "user",
                removed: false,
              },
              {
                id: "a1",
                llm_message: {
                  role: "assistant",
                  content: [{ type: "text", text: "Done." }],
                },
              },
              {
                kind: "ReactionEvent",
                target_event_id: "u1",
                emoji: "eyes",
                source: "agent",
                removed: false,
              },
              {
                id: "u1",
                llm_message: {
                  role: "user",
                  content: [{ type: "text", text: "Check the board." }],
                },
              },
            ],
          };
      },
    });
    await waitFor(() =>
      expect(app.container.querySelectorAll(".cat-message").length).toBe(3),
    );
    const [asked, answered, finished] =
      app.container.querySelectorAll(".cat-message");
    // Newest first from the API: the eyes reaction was later removed.
    expect(asked.querySelector(".cat-reactions")).toBeNull();
    const chip = answered.querySelector(".cat-reaction");
    expect(chip.textContent).toBe("👍");
    expect(chip.title).toBe("You");
    expect(chip.getAttribute("role")).toBe("img");
    expect(chip.getAttribute("aria-label")).toBe("👍 You");
    // A finish answer can be a target, and one chip names both reactors.
    const both = finished.querySelector(".cat-reaction");
    expect(both.textContent).toBe("🎉");
    expect(both.title).toBe("You, Insider Cat");
  });

  it("turns conversation mentions into links with the live title", async () => {
    const hex = worker.id.replace(/-/g, "");
    const app = mountApp({
      request: ({ path }) => {
        if (path.startsWith("/api/conversations/search"))
          return { items: [controller], next_page_id: null };
        if (path.includes("/events/search"))
          return {
            items: [
              {
                llm_message: {
                  role: "assistant",
                  content: [
                    {
                      type: "text",
                      text: `[Old title](conversation:${hex}) needs your **answer** on \`main\`.`,
                    },
                  ],
                },
              },
            ],
          };
        if (path === `/api/conversations/${hex}`)
          return { ...worker, title: "Ship the board" };
      },
    });
    await waitFor(() =>
      expect(app.container.querySelector(".cat-mention")?.textContent).toBe(
        "Ship the board",
      ),
    );
    const row = app.container
      .querySelector(".cat-mention")
      .closest(".cat-message");
    expect(row.textContent).toContain(
      "Ship the board needs your answer on main.",
    );
    expect(row.textContent).not.toContain("conversation:");
    expect(row.textContent).not.toContain("**");
    expect(row.querySelector("b").textContent).toBe("answer");
    expect(row.querySelector("code").textContent).toBe("main");
    const mention = app.container.querySelector(".cat-mention");
    expect(mention.tagName).toBe("A");
    expect(mention.getAttribute("href")).toBe(
      `/conversations/${encodeURIComponent(worker.id)}`,
    );
    app.container.querySelector(".cat-mention").click();
    expect(app.host.navigate).toHaveBeenCalledWith(
      `/conversations/${encodeURIComponent(worker.id)}`,
    );
  });

  it("shows live cards for conversations the Cat names", async () => {
    const named = {
      ...worker,
      title: "Ship the board",
      execution_status: "running",
      updated_at: new Date(Date.now() - 5 * 60_000).toISOString(),
    };
    const app = mountApp({
      request: ({ path }) => {
        if (path.startsWith("/api/conversations/search"))
          return { items: [controller], next_page_id: null };
        if (path.includes("/events/search"))
          return {
            items: [
              {
                llm_message: {
                  role: "assistant",
                  content: [
                    {
                      type: "text",
                      text: `Started ${worker.id.replace(/-/g, "")} and checked myself (${controller.id.replace(/-/g, "")}); 99999999-9999-4999-8999-999999999999 is gone.`,
                    },
                  ],
                },
              },
            ],
          };
        if (path === `/api/conversations/${worker.id.replace(/-/g, "")}`)
          return named;
        if (path === "/api/conversations/99999999-9999-4999-8999-999999999999")
          throw Object.assign(
            new Error("HTTP request failed (404 Not Found)"),
            { status: 404 },
          );
      },
    });
    await waitFor(() =>
      expect(app.container.querySelectorAll(".cat-ref").length).toBe(1),
    );
    const card = app.container.querySelector(".cat-ref");
    expect(card.textContent).toContain("Ship the board");
    expect(card.dataset.status).toBe("running");
    expect(card.textContent).toContain("5m ago");
    card.click();
    expect(app.host.navigate).toHaveBeenCalledWith(
      `/conversations/${encodeURIComponent(worker.id)}`,
    );
    const reads = (path) =>
      app.request.mock.calls.filter(([call]) => call.path === path).length;
    const missing = "/api/conversations/99999999-9999-4999-8999-999999999999";
    // The Cat's own ID (written without dashes) is not fetched as a card.
    expect(reads(`/api/conversations/${controller.id.replace(/-/g, "")}`)).toBe(
      0,
    );
    expect(reads(missing)).toBe(1);
    const namedReads = reads(
      `/api/conversations/${worker.id.replace(/-/g, "")}`,
    );
    click(app, "refresh");
    await waitFor(() =>
      expect(
        reads(`/api/conversations/${worker.id.replace(/-/g, "")}`),
      ).toBeGreaterThan(namedReads),
    );
    // A UUID that is not a conversation is not asked for again.
    expect(reads(missing)).toBe(1);
  });

  it("keeps keyboard focus on a card across history refreshes", async () => {
    const app = mountApp({
      request: ({ path }) => {
        if (path.startsWith("/api/conversations/search"))
          return { items: [controller], next_page_id: null };
        if (path.includes("/events/search"))
          return {
            items: [
              {
                llm_message: {
                  role: "assistant",
                  content: [{ type: "text", text: `See ${worker.id}.` }],
                },
              },
            ],
          };
      },
    });
    await waitFor(() =>
      expect(app.container.querySelector(".cat-ref")).not.toBeNull(),
    );
    const before = app.container.querySelector(".cat-ref");
    before.focus();
    click(app, "refresh");
    await waitFor(() =>
      expect(app.container.querySelector(".cat-ref")).not.toBe(before),
    );
    expect(document.activeElement).toBe(
      app.container.querySelector(".cat-ref"),
    );
  });

  it("shows no work until a Cat is chosen", async () => {
    const app = mountApp();
    await waitFor(() =>
      expect(app.container.querySelector(".cat-cards").textContent).not.toBe(
        "",
      ),
    );
    expect(groups(app)).toEqual([]);
  });
});

describe("Insider Cat App", () => {
  it.each(["local", "docker"])(
    "keeps a Cat on the host when a mixed backend defaults to %s",
    async (conversation_runtime) => {
      const containerWorker = {
        ...worker,
        workspace: { working_dir: "/workspace" },
      };
      const app = mountApp({
        request: ({ path }) => {
          if (path === "/server_info")
            return {
              conversation_runtime,
              available_conversation_runtimes: ["local", "docker"],
            };
          if (path === "/api/workspaces")
            return { workspaces: [{ path: "/host/cat" }] };
          if (path.startsWith("/api/conversations/search"))
            return { items: [containerWorker] };
          if (path === `/api/conversations/${worker.id}`)
            return containerWorker;
        },
      });
      await waitFor(() =>
        expect(find(app, "workspace").options.length).toBeGreaterThan(1),
      );
      // The Cat runs in the host workspace without asking; the container
      // worker's folder is never offered.
      expect(
        [...find(app, "workspace").options].map((item) => item.value),
      ).toEqual(["", "/host/cat"]);
      expect(find(app, "workspace").value).toBe("/host/cat");
      expect(
        app.container.querySelector('[data-role="workspace-field"]').hidden,
      ).toBe(true);
      draft(app, "Explain this container's work.");
      click(app, "send");
      await waitFor(() =>
        expect(app.request).toHaveBeenCalledWith(
          expect.objectContaining({
            path: "/api/conversations",
            method: "POST",
          }),
        ),
      );
      const create = app.request.mock.calls.find(
        ([call]) =>
          call.path === "/api/conversations" && call.method === "POST",
      )[0];
      expect(create.body).toMatchObject({
        conversation_runtime: "local",
        workspace: { working_dir: "/host/cat" },
        tags: controller.tags,
      });
      expect(create.body).not.toHaveProperty("parent_conversation_id");
    },
  );

  it.each([
    null,
    { conversation_runtime: "docker", available_conversation_runtimes: [] },
  ])(
    "refuses an unverified or Docker-only new Cat and recovers without losing its draft",
    async (initialInfo) => {
      let info = initialInfo;
      const app = mountApp({
        request: ({ path }) => {
          if (path === "/server_info") {
            if (!info) throw new Error("Backend unavailable");
            return info;
          }
          if (path === "/api/workspaces")
            return { workspaces: [{ path: "/host/cat" }] };
        },
      });
      await waitFor(() =>
        expect(find(app, "workspace").options.length).toBe(2),
      );
      find(app, "workspace").value = "/host/cat";
      find(app, "workspace").dispatchEvent(new Event("change"));
      draft(app, "Keep my request.");
      click(app, "send");
      await waitFor(() =>
        expect(app.container.textContent).toContain(
          "Could not verify a host-local runtime",
        ),
      );
      expect(
        app.request.mock.calls.some(([call]) => call.method === "POST"),
      ).toBe(false);
      expect(find(app, "draft").value).toBe("Keep my request.");
      expect(find(app, "checked").hidden).toBe(true);
      info = { conversation_runtime: "local" };
      click(app, "refresh");
      await waitFor(() => expect(find(app, "refresh").disabled).toBe(false));
      click(app, "send");
      await waitFor(() =>
        expect(app.request).toHaveBeenCalledWith(
          expect.objectContaining({
            path: "/api/conversations",
            method: "POST",
          }),
        ),
      );
    },
  );

  it("rechecks the saved host workspace before submitting a new Cat", async () => {
    let workspaceAvailable = true;
    const app = mountApp({
      request: ({ path }) => {
        if (path === "/server_info")
          return {
            conversation_runtime: "local",
            available_conversation_runtimes: ["local", "docker"],
          };
        if (path === "/api/workspaces")
          return {
            workspaces: workspaceAvailable ? [{ path: "/host/cat" }] : [],
          };
      },
    });
    await waitFor(() => expect(find(app, "workspace").options.length).toBe(2));
    expect(find(app, "workspace").value).toBe("/host/cat");
    draft(app, "Keep the worker in context.");
    workspaceAvailable = false;
    click(app, "send");
    await waitFor(() =>
      expect(app.container.textContent).toContain(
        "Choose a saved host workspace",
      ),
    );
    expect(
      app.request.mock.calls.some(([call]) => call.method === "POST"),
    ).toBe(false);
    expect(find(app, "workspace").value).toBe("");
    expect(find(app, "draft").value).toBe("Keep the worker in context.");
    // With no host workspace left, the field shows so the person sees why.
    expect(
      app.container.querySelector('[data-role="workspace-field"]').hidden,
    ).toBe(false);
    expect(find(app, "checked").hidden).toBe(true);
  });

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
      expect(find(first, "workspace").value).toBe(worker.workspace.working_dir),
    );
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

  it("resumes an explicit Insider controller while excluding unmarked conversations, children, and other roles", async () => {
    const app = mountApp({
      request: ({ path }) => {
        if (path.startsWith("/api/conversations/search"))
          return {
            items: [
              controller,
              {
                ...controller,
                id: "missing-cat-tag",
                tags: { insiderrole: "controller" },
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

  it.each(["discovery", "deep link"])(
    "continues a legacy Cat through %s and resumes it without replacing its identity",
    async (entry) => {
      const legacy = {
        ...controller,
        id: "55555555-5555-4555-8555-555555555555",
        title: "Legacy Cat",
        tags: { smolpaws: "insider" },
      };
      const request = ({ path }) => {
        if (path.includes("page_id=legacy-page"))
          return { items: [legacy], next_page_id: null };
        if (path.startsWith("/api/conversations/search"))
          return {
            items: entry === "deep link" ? [worker, controller] : [worker],
            next_page_id: "legacy-page",
          };
        if (path === `/api/conversations/${legacy.id}`) return legacy;
        if (
          path ===
          `/api/conversations/${legacy.id}/events/search?limit=50&sort_order=TIMESTAMP_DESC`
        )
          return {
            items: [
              {
                id: "legacy-answer",
                llm_message: {
                  role: "assistant",
                  content: [{ type: "text", text: "A saved legacy answer." }],
                },
              },
            ],
          };
      };
      const first = mountApp({
        request,
        registerCompanion: () => () => {},
        path: entry === "deep link" ? `/conversations/${legacy.id}` : "",
      });
      await waitFor(() => {
        expect(find(first, "controller").value).toBe(legacy.id);
        expect(find(first, "voice-start").disabled).toBe(false);
        expect(first.container.textContent).toContain("A saved legacy answer.");
      });
      draft(first, "Continue this saved Cat.");
      click(first, "send");
      await waitFor(() =>
        expect(first.request).toHaveBeenCalledWith(
          expect.objectContaining({
            path: `/api/conversations/${legacy.id}/events`,
            method: "POST",
          }),
        ),
      );
      expect(
        first.request.mock.calls.some(
          ([call]) =>
            call.method === "PATCH" ||
            (call.method === "POST" && call.path === "/api/conversations"),
        ),
      ).toBe(false);
      first.cleanup();
      const resumed = mountApp({ request, registerCompanion: () => () => {} });
      await waitFor(() => {
        expect(find(resumed, "controller").value).toBe(legacy.id);
        expect(find(resumed, "voice-start").disabled).toBe(false);
      });
      expect(
        resumed.request.mock.calls.some(([call]) => call.method === "POST"),
      ).toBe(false);
    },
  );

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

  it("reads every page into the board and opens a conversation inside Canvas", async () => {
    const mine = { insidercat: controller.id, insiderrole: "worker" };
    const app = mountApp({
      request: ({ path }) => {
        if (path.includes("page_id=next-page"))
          return {
            items: [
              {
                id: "ended",
                title: "Another task",
                execution_status: "finished",
                tags: mine,
              },
            ],
            next_page_id: null,
          };
        if (path.startsWith("/api/conversations/search"))
          return {
            items: [controller, { ...worker, tags: mine }],
            next_page_id: "next-page",
          };
      },
    });
    await waitFor(() =>
      expect(app.container.textContent).toContain("Another task"),
    );
    expect(app.container.textContent).toContain(worker.title);
    expect(app.container.textContent).toContain("Approval requested");
    expect(app.container.textContent).toContain("Run ended");
    click(app, "open-worker");
    expect(app.host.navigate).toHaveBeenCalledWith(
      `/conversations/${worker.id}`,
    );
    expect(
      app.request.mock.calls.every(
        ([call]) => !call.method || call.method === "GET",
      ),
    ).toBe(true);
  });

  it("creates one durable controller with the active profile and confirmation policy, then sends follow-ups to its ID", async () => {
    const app = mountApp();
    await waitFor(() =>
      expect(find(app, "workspace").value).toBe(worker.workspace.working_dir),
    );
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
    // Older local-only metadata needs no new runtime field or service addresses.
    expect(create.body).not.toHaveProperty("conversation_runtime");
    expect(
      create.body.agent_launch_additions.system_message_suffix_append,
    ).not.toContain("<RUNTIME_SERVICES>");
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

  it("adds only its owning backend's advertised runtime context without replacing the active profile", async () => {
    const app = mountApp({
      backendId: "backend-two",
      request: ({ path }) => {
        if (path === "/server_info")
          return {
            conversation_runtime: "local",
            runtime_services: {
              services: {
                agent_server: {
                  url_from_agent: "https://agent-two.internal:9443",
                  auth_key_file_env_var: "OH_SESSION_API_KEY_PATH",
                },
              },
              session_api_key: "test-secret-never-in-prompt",
            },
          };
      },
    });
    await waitFor(() =>
      expect(find(app, "workspace").value).toBe(worker.workspace.working_dir),
    );
    draft(app, "Count the conversations here.");
    click(app, "send");
    await waitFor(() =>
      expect(
        app.request.mock.calls.some(
          ([call]) =>
            call.path === "/api/conversations" && call.method === "POST",
        ),
      ).toBe(true),
    );
    const { body } = app.request.mock.calls.find(
      ([call]) => call.path === "/api/conversations" && call.method === "POST",
    )[0];
    expect(body.agent_profile_id).toBe("33333333-3333-4333-8333-333333333333");
    expect(body).not.toHaveProperty("agent_settings");
    expect(body).not.toHaveProperty("agent");
    const suffix = body.agent_launch_additions.system_message_suffix_append;
    expect(suffix).toContain("Agent Server: https://agent-two.internal:9443/");
    expect(suffix).toContain("$OH_SESSION_API_KEY_PATH");
    expect(suffix).toContain("Backend: backend-two");
    expect(suffix).toContain("<INSIDER_CONTROLLER>");
    expect(suffix).not.toMatch(/test-secret|localhost|127\.0\.0\.1/);
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
    await waitFor(() => expect(find(other, "send").disabled).toBe(false));
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
      expect(find(app, "workspace").value).toBe(worker.workspace.working_dir),
    );
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
      expect(find(app, "workspace").value).toBe(worker.workspace.working_dir),
    );
    draft(app, "Start once.");
    click(app, "send");
    await waitFor(() => expect(resolveCreate).toBeTypeOf("function"));
    draft(app, "My next request, still a draft.");
    app.remount();
    await waitFor(() => expect(find(app, "refresh").disabled).toBe(false));
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
        expect(find(app, "workspace").value).toBe(worker.workspace.working_dir),
      );
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
      expect(find(app, "workspace").value).toBe(worker.workspace.working_dir),
    );
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

describe("Insider Cat project files", () => {
  const projectId = "44444444-4444-4444-8444-444444444444";
  const files = [
    {
      name: "CHANGELOG.md",
      size: 120,
      source: "agent",
      conversation_id: worker.id.replace(/-/g, ""),
      created_at: "2026-11-09T10:00:00Z",
      updated_at: "2026-11-09T10:00:00Z",
    },
    {
      name: "board.png",
      size: 4096,
      source: "user",
      conversation_id: null,
      created_at: "2026-11-09T11:00:00Z",
      updated_at: "2026-11-09T11:00:00Z",
    },
  ];
  const projectRequests =
    (extra = () => undefined) =>
    async (call) => {
      const result = await extra(call);
      if (result !== undefined) return result;
      const { path } = call;
      if (path.startsWith("/api/conversations/search"))
        return { items: [controller, worker], next_page_id: null };
      if (path === "/api/projects")
        return {
          projects: [
            {
              id: projectId,
              name: "Insider 0.2",
              coordinator_conversation_id: controller.id.replace(/-/g, ""),
            },
          ],
        };
      if (path === `/api/projects/${projectId}/artifacts`)
        return { artifacts: files };
      if (path === `/api/projects/${projectId}/artifacts/CHANGELOG.md`)
        return "# 0.2.0-beta.1\n";
      return undefined;
    };

  it("lists the files of the project the Cat leads, newest first, by source", async () => {
    const app = mountApp({ request: projectRequests() });
    await waitFor(() =>
      expect(app.container.querySelector('[data-role="files"]').hidden).toBe(
        false,
      ),
    );
    const rows = [...app.container.querySelectorAll(".cat-file")];
    expect(rows.map((row) => row.dataset.file)).toEqual([
      "board.png",
      "CHANGELOG.md",
    ]);
    expect(rows[0].dataset.source).toBe("user");
    expect(rows[0].textContent).toContain("Added by you");
    expect(rows[1].textContent).toContain(
      "Made by an agent · Review the project",
    );
    expect(
      app.container.querySelector('[data-role="files-title"]').textContent,
    ).toBe("Project files · 2");
  });

  it("previews text files and not other types", async () => {
    const app = mountApp({ request: projectRequests() });
    await waitFor(() =>
      expect(app.container.querySelectorAll(".cat-file").length).toBe(2),
    );
    const preview = app.container.querySelector('[data-role="file-preview"]');
    app.container
      .querySelector('.cat-file[data-file="CHANGELOG.md"] button')
      .click();
    await waitFor(() => expect(preview.textContent).toBe("# 0.2.0-beta.1\n"));
    expect(preview.hidden).toBe(false);
    app.container
      .querySelector('.cat-file[data-file="board.png"] button')
      .click();
    expect(preview.textContent).toBe("No preview for this file type.");
    app.container
      .querySelector('.cat-file[data-file="board.png"] button')
      .click();
    expect(preview.hidden).toBe(true);
  });

  it("uploads an added file to the project and refreshes the list", async () => {
    let uploaded = null;
    const app = mountApp({
      request: projectRequests(({ path, method, body }) => {
        if (
          method === "POST" &&
          path === `/api/projects/${projectId}/artifacts`
        ) {
          uploaded = body;
          return { name: "notes.txt", source: "user" };
        }
        return undefined;
      }),
    });
    await waitFor(() =>
      expect(app.container.querySelectorAll(".cat-file").length).toBe(2),
    );
    const input = find(app, "file-input");
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });
    Object.defineProperty(input, "files", {
      value: [file],
      configurable: true,
    });
    input.dispatchEvent(new Event("change"));
    await waitFor(() => expect(uploaded).toBeInstanceOf(FormData));
    expect(uploaded.get("file").name).toBe("notes.txt");
  });

  it("stays hidden when the Cat leads no project or the server has no projects", async () => {
    const app = mountApp({
      request: ({ path }) => {
        if (path.startsWith("/api/conversations/search"))
          return { items: [controller], next_page_id: null };
        if (path === "/api/projects") return { projects: [] };
        return undefined;
      },
    });
    await waitFor(() =>
      expect(app.request).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/projects" }),
      ),
    );
    expect(app.container.querySelector('[data-role="files"]').hidden).toBe(
      true,
    );
  });
});
