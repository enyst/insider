import { describe, expect, it } from "vitest";
import { catAvatarMarkup, catPose } from "./src/cat-avatar.js";

describe("Cat avatar state", () => {
  it.each([undefined, "idle", "finished"])(
    "rests immediately when controller status is %s and no work or call is active",
    (execution_status) => {
      expect(catPose({ controller: { execution_status } })).toBe("sleeping");
      expect(catPose()).toBe("sleeping");
    },
  );

  it("wakes for connection, listens only with an open microphone, and rests after ending", () => {
    expect(catPose({ voice: { status: "connecting" } })).toBe("waking");
    expect(catPose({ voice: { status: "listening", muted: false } })).toBe(
      "listening",
    );
    expect(catPose({ voice: { status: "listening", muted: true } })).toBe(
      "waking",
    );
    expect(catPose({ voice: { status: "idle" } })).toBe("sleeping");
  });

  it.each([
    { busy: true },
    { voice: { status: "thinking" } },
    { voice: { status: "listening", requestPending: true } },
    {
      voice: { status: "listening", muted: true },
      controller: { execution_status: "running" },
    },
    { controller: { execution_status: "running" } },
  ])("keeps accepted or running work visible: %j", (state) => {
    expect(catPose(state)).toBe("working");
  });

  it("shows spoken output over work without interpreting microphone mute as speaker mute", () => {
    expect(
      catPose({
        voice: { status: "speaking", requestPending: true, muted: true },
        controller: { execution_status: "running" },
        busy: true,
      }),
    ).toBe("speaking");
  });

  it.each(["paused", "waiting_for_confirmation", "error", "stuck", "deleting"])(
    "keeps controller %s visible even over speaking or pending work",
    (execution_status) => {
      expect(
        catPose({
          controller: { execution_status },
          voice: { status: "speaking", requestPending: true },
          busy: true,
        }),
      ).toBe("attention");
    },
  );

  it.each([
    { status: "error" },
    { status: "idle", error: "voicePlaybackBlocked" },
  ])("keeps a voice failure visible until cleared: %j", (voice) => {
    expect(catPose({ voice })).toBe("attention");
    expect(catPose({ voice: { status: "idle", error: null } })).toBe(
      "sleeping",
    );
  });
});

describe("Cat avatar markup", () => {
  it("can be mounted twice without IDs, external resources, or an extra accessible control", () => {
    const container = document.createElement("div");
    container.innerHTML = catAvatarMarkup() + catAvatarMarkup();
    const svgs = [...container.querySelectorAll("svg")];
    expect(svgs).toHaveLength(2);
    for (const svg of svgs) {
      expect(svg.namespaceURI).toBe("http://www.w3.org/2000/svg");
      expect(svg.getAttribute("aria-hidden")).toBe("true");
      expect(svg.getAttribute("focusable")).toBe("false");
      expect(svg.getAttribute("viewBox")).toBe("0 0 160 120");
    }
    expect(
      container.querySelector("[id], [href], script, image, foreignObject"),
    ).toBeNull();
  });
});
