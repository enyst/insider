const MAX_METADATA_LENGTH = 16384;
const METADATA_TIMEOUT_MS = 3000;
const SERVICES = [
  ["agent_server", "Agent Server"],
  ["ingress", "Canvas ingress"],
  ["frontend", "Canvas frontend"],
  ["automation", "Automation"],
];

function serviceUrl(value) {
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    /[\u0000-\u0020\u007f]/.test(value)
  )
    return null;
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}

function environmentName(value) {
  return typeof value === "string" && /^[A-Z_][A-Z0-9_]{0,63}$/.test(value)
    ? value
    : null;
}

/** Only advertised addresses and credential references enter the prompt. */
export function buildRuntimeServicesSuffix(serverInfo) {
  let runtime = serverInfo?.runtime_services;
  if (typeof runtime === "string") {
    if (runtime.length > MAX_METADATA_LENGTH) return "";
    try {
      runtime = JSON.parse(runtime);
    } catch {
      return "";
    }
  }
  if (!runtime || typeof runtime !== "object" || Array.isArray(runtime))
    return "";
  const lines = [];
  for (const [name, label] of SERVICES) {
    const service = runtime.services?.[name];
    const url = serviceUrl(service?.url_from_agent);
    if (!url) continue;
    lines.push(`* ${label}: ${url}`);
    const urlEnv = environmentName(service.url_env_var);
    if (urlEnv) lines.push(`  URL environment variable: ${urlEnv}`);
    const keyFileEnv = environmentName(service.auth_key_file_env_var);
    const keyEnv = environmentName(service.auth_env_var);
    if (keyFileEnv)
      lines.push(
        `  Session authentication: read the key file named by $${keyFileEnv} and use its contents as the X-Session-API-Key header.`,
      );
    else if (keyEnv)
      lines.push(
        `  Session authentication: use $${keyEnv} as the X-Session-API-Key header.`,
      );
  }
  if (!lines.length) return "";
  return [
    "<RUNTIME_SERVICES>",
    "This backend advertises the following service addresses from the agent's point of view. Use these addresses instead of guessing ports or using another backend.",
    ...lines,
    "Use available tools, including Terminal, for authorized API requests. Never print credential values into commands, output, messages, or logs. Existing confirmation policy still applies.",
    "</RUNTIME_SERVICES>",
  ].join("\n");
}

/** Optional metadata must not prevent launching a Cat on a valid backend. */
export async function fetchRuntimeServicesSuffix(request) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve()
        .then(() => request("/server_info"))
        .then(buildRuntimeServicesSuffix),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(""), METADATA_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}
