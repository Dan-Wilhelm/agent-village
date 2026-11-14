import "server-only";

/**
 * Agent knowledge vault, stored in a private GitHub repo (VAULT_REPO, e.g.
 * "owner/brain-agents") and synced into the owner's Obsidian vault.
 * The token (GITHUB_VAULT_TOKEN) is a fine-grained token for THIS repo only.
 * Never put ClickUp content into the vault (see docs/phase-3-spec.md).
 */

const API = "https://api.github.com";

export class VaultError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "VaultError";
  }
}

function config() {
  const token = process.env.GITHUB_VAULT_TOKEN;
  const repo = process.env.VAULT_REPO;
  const branch = process.env.VAULT_BRANCH ?? "main";
  if (!token || !repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new VaultError("Vault is not configured", 500);
  return { token, repo, branch };
}

const encodePath = (p: string) => p.split("/").map(encodeURIComponent).join("/");

async function gh(path: string, init: RequestInit = {}) {
  const { token } = config();
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    cache: "no-store",
  });
  return res;
}

/** All file paths in the vault (one request). */
export async function listVaultFiles(): Promise<string[]> {
  const { repo, branch } = config();
  const res = await gh(`/repos/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
  if (!res.ok) throw new VaultError(`Vault listing failed (${res.status})`, res.status);
  const json = (await res.json()) as { tree: Array<{ path: string; type: string }>; truncated?: boolean };
  return json.tree.filter((e) => e.type === "blob").map((e) => e.path);
}

export async function readVaultFile(path: string): Promise<{ content: string; sha: string } | null> {
  const { repo, branch } = config();
  const res = await gh(`/repos/${repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new VaultError(`Vault read failed (${res.status})`, res.status);
  const json = (await res.json()) as { content: string; encoding: string; sha: string };
  return { content: Buffer.from(json.content, "base64").toString("utf8"), sha: json.sha };
}

/** Creates or updates a file. Pass `sha` when updating (prevents overwriting concurrent edits). */
export async function writeVaultFile(path: string, content: string, message: string, sha?: string) {
  const { repo, branch } = config();
  const res = await gh(`/repos/${repo}/contents/${encodePath(path)}`, {
    method: "PUT",
    body: JSON.stringify({ message, content: Buffer.from(content, "utf8").toString("base64"), branch, ...(sha ? { sha } : {}) }),
  });
  if (res.status === 409 || res.status === 422) throw new VaultError("The note changed in the meantime — please retry.", 409);
  if (!res.ok) throw new VaultError(`Vault write failed (${res.status})`, res.status);
  const json = (await res.json()) as { content: { sha: string } };
  return { sha: json.content.sha };
}
