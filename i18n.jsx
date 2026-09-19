import React, { useEffect, useLayoutEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { createInstance } from "i18next";
import { I18nextProvider, useTranslation } from "react-i18next";
import { I18nKey } from "./src/i18n/declaration.js";
import definitions from "./src/i18n/translation.json";

const NAMESPACE = "openhands";
const LANGUAGE_STORAGE_KEY = "i18nextLng";
const TRANSLATION_KEYS = {
  liveTranscript: I18nKey.INSIDER_CAT$LIVE_TRANSCRIPT,
  workTitle: I18nKey.INSIDER_CAT$WORK_TITLE,
  resting: I18nKey.INSIDER_CAT$RESTING,
  title: I18nKey.INSIDER_CAT$TITLE,
  subtitle: I18nKey.INSIDER_CAT$SUBTITLE,
  backend: I18nKey.INSIDER_CAT$BACKEND,
  refresh: I18nKey.BUTTON$REFRESH,
  loadMore: I18nKey.INSIDER_CAT$LOAD_MORE,
  loading: I18nKey.INSIDER_CAT$LOADING,
  loaded: I18nKey.INSIDER_CAT$LOADED,
  complete: I18nKey.INSIDER_CAT$COMPLETE,
  refreshed: I18nKey.INSIDER_CAT$REFRESHED,
  search: I18nKey.INSIDER_CAT$SEARCH,
  project: I18nKey.WORKSPACE$TITLE,
  all: I18nKey.INSIDER_CAT$ALL,
  noWorkspace: I18nKey.INSIDER_CAT$NO_WORKSPACE,
  empty: I18nKey.INSIDER_CAT$EMPTY,
  select: I18nKey.INSIDER_CAT$SELECT,
  open: I18nKey.INSIDER_CAT$OPEN,
  clear: I18nKey.COMMON$CLEAR_SELECTION,
  selected: I18nKey.INSIDER_CAT$SELECTED,
  cat: I18nKey.INSIDER_CAT$CAT,
  controller: I18nKey.INSIDER_CAT$CONTROLLER,
  chooseController: I18nKey.INSIDER_CAT$CHOOSE_CONTROLLER,
  newCat: I18nKey.INSIDER_CAT$NEW_CAT,
  searching: I18nKey.INSIDER_CAT$SEARCHING,
  choose: I18nKey.INSIDER_CAT$CHOOSE,
  newReady: I18nKey.INSIDER_CAT$NEW_READY,
  workspace: I18nKey.INSIDER_CAT$WORKSPACE,
  chooseWorkspace: I18nKey.INSIDER_CAT$CHOOSE_WORKSPACE,
  draft: I18nKey.INSIDER_CAT$DRAFT,
  placeholder: I18nKey.INSIDER_CAT$PLACEHOLDER,
  send: I18nKey.BUTTON$SEND,
  sending: I18nKey.INSIDER_CAT$SENDING,
  missingWorkspace: I18nKey.INSIDER_CAT$MISSING_WORKSPACE,
  noProfile: I18nKey.INSIDER_CAT$NO_PROFILE,
  incompatible: I18nKey.INSIDER_CAT$INCOMPATIBLE,
  accepted: I18nKey.INSIDER_CAT$ACCEPTED,
  recent: I18nKey.INSIDER_CAT$RECENT,
  full: I18nKey.INSIDER_CAT$FULL,
  noMessages: I18nKey.INSIDER_CAT$NO_MESSAGES,
  partialHistory: I18nKey.INSIDER_CAT$PARTIAL_HISTORY,
  user: I18nKey.INSIDER_CAT$USER,
  assistant: I18nKey.INSIDER_CAT$ASSISTANT,
  uncertain: I18nKey.INSIDER_CAT$UNCERTAIN,
  checked: I18nKey.INSIDER_CAT$CHECKED,
  invalidController: I18nKey.INSIDER_CAT$INVALID_CONTROLLER,
  discoveryFailed: I18nKey.INSIDER_CAT$DISCOVERY_FAILED,
  voiceStart: I18nKey.INSIDER_CAT$VOICE_START,
  voiceInterrupt: I18nKey.INSIDER_CAT$VOICE_INTERRUPT,
  voiceEnd: I18nKey.INSIDER_CAT$VOICE_END,
  voiceMute: I18nKey.INSIDER_CAT$VOICE_MUTE,
  voiceUnmute: I18nKey.INSIDER_CAT$VOICE_UNMUTE,
  voiceMuted: I18nKey.INSIDER_CAT$VOICE_MUTED,
  voiceConnecting: I18nKey.INSIDER_CAT$VOICE_CONNECTING,
  voiceListening: I18nKey.INSIDER_CAT$VOICE_LISTENING,
  voiceThinking: I18nKey.INSIDER_CAT$VOICE_THINKING,
  voiceSpeaking: I18nKey.INSIDER_CAT$VOICE_SPEAKING,
  voiceChoose: I18nKey.INSIDER_CAT$VOICE_CHOOSE,
  voiceUnavailable: I18nKey.INSIDER_CAT$VOICE_UNAVAILABLE,
  voiceKeyMissing: I18nKey.INSIDER_CAT$VOICE_KEY_MISSING,
  voiceCodexMissing: I18nKey.INSIDER_CAT$VOICE_CODEX_MISSING,
  voiceCodexSignIn: I18nKey.INSIDER_CAT$VOICE_CODEX_SIGN_IN,
  voiceCodexUnavailable: I18nKey.INSIDER_CAT$VOICE_CODEX_UNAVAILABLE,
  voiceSetup: I18nKey.SETTINGS$NAV_SECRETS,
  voicePlaybackBlocked: I18nKey.INSIDER_CAT$VOICE_PLAYBACK_BLOCKED,
  voiceConnectionFailed: I18nKey.INSIDER_CAT$VOICE_CONNECTION_FAILED,
  voicePermissionDenied: I18nKey.INSIDER_CAT$VOICE_PERMISSION_DENIED,
  condenseChoose: I18nKey.INSIDER_CAT$CONDENSE_CHOOSE,
  condenseBusy: I18nKey.INSIDER_CAT$CONDENSE_BUSY,
  condensing: I18nKey.INSIDER_CAT$CONDENSING,
  condensed: I18nKey.INSIDER_CAT$CONDENSED,
  condenseError: I18nKey.INSIDER_CAT$CONDENSE_ERROR,
  idle: I18nKey.CONVERSATION$READY,
  running: I18nKey.COMMON$WORKING,
  paused: I18nKey.COMMON$PAUSED,
  waiting_for_confirmation: I18nKey.INSIDER_CAT$WAITING_FOR_CONFIRMATION,
  finished: I18nKey.INSIDER_CAT$FINISHED,
  error: I18nKey.COMMON$ERROR,
  stuck: I18nKey.INSIDER_CAT$STUCK,
  deleting: I18nKey.INSIDER_CAT$DELETING,
  unknown: I18nKey.INSIDER_CAT$UNKNOWN,
  loadError: I18nKey.INSIDER_CAT$LOAD_ERROR,
  catError: I18nKey.INSIDER_CAT$CAT_ERROR,
  requestError: I18nKey.INSIDER_CAT$REQUEST_ERROR,
  compatibleError: I18nKey.INSIDER_CAT$COMPATIBLE_ERROR,
};
const includedKeys = new Set(Object.values(TRANSLATION_KEYS));
const resources = {};

for (const [key, translations] of Object.entries(definitions)) {
  if (!includedKeys.has(key)) continue;
  for (const [language, value] of Object.entries(translations)) {
    resources[language] ??= { [NAMESPACE]: {} };
    resources[language][NAMESPACE][key] = value;
  }
}

function selectedLanguage() {
  let stored;
  try {
    stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
  } catch {
    // Canvas also works when browser storage is disabled.
  }
  const candidates = [stored, ...(navigator.languages || [navigator.language])];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const normalized = candidate.toLowerCase();
    const exact = Object.keys(resources).find(
      (language) => language.toLowerCase() === normalized,
    );
    if (exact) return exact;
    if (/^zh-(tw|hk|hant)/.test(normalized)) return "zh-TW";
    if (/^zh(-|$)/.test(normalized)) return "zh-CN";
    if (/^ko(-|$)/.test(normalized)) return "ko-KR";
    if (/^(nb|nn)(-|$)/.test(normalized)) return "no";
    const base = normalized.split("-")[0];
    if (resources[base]) return base;
  }
  return "en";
}

function LocalizedMount({ mount, instance }) {
  const { t, i18n } = useTranslation(NAMESPACE);
  const container = useRef(null);

  useLayoutEffect(() => {
    const dispose = mount({
      container: container.current,
      t: (key, values) => t(TRANSLATION_KEYS[key], values),
    });
    return dispose;
  }, [mount, t]);

  useEffect(() => {
    const refreshLanguage = () => {
      const language = selectedLanguage();
      if (language !== instance.language)
        void instance.changeLanguage(language);
    };
    const storageChanged = (event) => {
      if (event.key === LANGUAGE_STORAGE_KEY || event.key === null) {
        refreshLanguage();
      }
    };
    window.addEventListener("storage", storageChanged);
    window.addEventListener("focus", refreshLanguage);
    return () => {
      window.removeEventListener("storage", storageChanged);
      window.removeEventListener("focus", refreshLanguage);
    };
  }, [instance]);

  return <div ref={container} lang={i18n.resolvedLanguage} dir={i18n.dir()} />;
}

/** Use the copied Canvas translations in a self-contained App bundle. */
export function mountLocalizedApp(container, mount) {
  const instance = createInstance();
  void instance.init({
    resources,
    lng: selectedLanguage(),
    fallbackLng: "en",
    supportedLngs: Object.keys(resources),
    ns: [NAMESPACE],
    defaultNS: NAMESPACE,
    initImmediate: false,
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
  const root = createRoot(container);
  root.render(
    <I18nextProvider i18n={instance}>
      <LocalizedMount mount={mount} instance={instance} />
    </I18nextProvider>,
  );
  return () => root.unmount();
}
