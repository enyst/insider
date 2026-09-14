import { afterEach, describe, expect, it, vi } from "vitest";
import { act, waitFor } from "@testing-library/react";
import { mountLocalizedApp } from "./i18n.jsx";

vi.unmock("react-i18next");

let dispose;

afterEach(() => {
  act(() => dispose?.());
  dispose = undefined;
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("Insider Cat localization", () => {
  it("uses Canvas's language, central shared labels, and interpolation", async () => {
    localStorage.setItem("i18nextLng", "fr-FR");
    const container = document.createElement("div");
    document.body.append(container);
    await act(async () => {
      dispose = mountLocalizedApp(container, ({ container: inner, t }) => {
        inner.textContent = [
          t("title"),
          t("send"),
          t("backend", { id: "<backend-two>" }),
        ].join(" / ");
        return () => inner.replaceChildren();
      });
    });

    expect(container.textContent).toBe(
      "Projets / Envoyer / Serveur : <backend-two>",
    );
    expect(container.querySelector("[lang='fr']")).not.toBeNull();
    expect(container.querySelector("backend-two")).toBeNull();
  });

  it("remounts translated content with RTL after a language change and cleans up", async () => {
    localStorage.setItem("i18nextLng", "en");
    const container = document.createElement("div");
    document.body.append(container);
    const cleanup = vi.fn();
    const activationState = { draft: "Please review the tests" };
    const mount = vi.fn(({ container: inner, t }) => {
      const input = document.createElement("input");
      input.value = activationState.draft;
      input.setAttribute("aria-label", t("draft"));
      const update = () => {
        activationState.draft = input.value;
      };
      input.addEventListener("input", update);
      inner.replaceChildren(input);
      return () => {
        input.removeEventListener("input", update);
        inner.replaceChildren();
        cleanup();
      };
    });
    await act(async () => {
      dispose = mountLocalizedApp(container, mount);
    });
    const input = container.querySelector("input");
    input.value = "Keep this unsent draft";
    input.dispatchEvent(new Event("input"));

    await act(async () => {
      localStorage.setItem("i18nextLng", "ar");
      window.dispatchEvent(new StorageEvent("storage", { key: "i18nextLng" }));
    });
    await waitFor(() => expect(container.firstElementChild.dir).toBe("rtl"));
    expect(container.firstElementChild.lang).toBe("ar");
    expect(container.querySelector("input").value).toBe(
      "Keep this unsent draft",
    );
    expect(
      container.querySelector("input").getAttribute("aria-label"),
    ).not.toBe("Message Insider Cat");
    expect(cleanup).toHaveBeenCalledTimes(1);

    act(() => dispose());
    dispose = undefined;
    expect(cleanup).toHaveBeenCalledTimes(2);
    const mountCount = mount.mock.calls.length;
    window.dispatchEvent(new Event("focus"));
    expect(mount).toHaveBeenCalledTimes(mountCount);
    expect(container.childElementCount).toBe(0);
  });
});
