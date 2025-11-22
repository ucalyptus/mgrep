import Mixedbread from "@mixedbread/sdk";
import { ensureAuthenticated, isDevelopment } from "../utils";
import { getJWTToken } from "./auth";
import {
  type FileSystem,
  type FileSystemOptions,
  NodeFileSystem,
} from "./file";
import { type Git, NodeGit } from "./git";
import { MixedbreadStore, type Store } from "./store";
import { LocalStore } from "./local-store";

const BASE_URL = isDevelopment()
  ? "http://localhost:8000"
  : "https://api.mixedbread.com";

/**
 * Determines if local mode is enabled
 * Local mode uses Ollama + LanceDB instead of Mixedbread API
 */
function isLocalMode(): boolean {
  return process.env.MGREP_LOCAL === "true" || process.env.MGREP_LOCAL === "1";
}

/**
 * Creates an authenticated Store instance
 * Supports both Mixedbread API (remote) and local Ollama+LanceDB
 * Set MGREP_LOCAL=true to use local mode
 */
export async function createStore(): Promise<Store> {
  if (isLocalMode()) {
    // Local mode: use Ollama + LanceDB
    return new LocalStore({
      model: process.env.MXBAI_MODEL,
      ollamaHost: process.env.OLLAMA_HOST,
      dbPath: process.env.MGREP_DB_PATH,
    });
  }

  // Remote mode: use Mixedbread API
  await ensureAuthenticated();
  const jwtToken = await getJWTToken();
  const client = new Mixedbread({
    baseURL: BASE_URL,
    apiKey: jwtToken,
  });
  return new MixedbreadStore(client);
}

/**
 * Creates a Git instance
 */
export function createGit(): Git {
  return new NodeGit();
}

/**
 * Creates a FileSystem instance
 */
export function createFileSystem(
  options: FileSystemOptions = { ignorePatterns: [] },
): FileSystem {
  return new NodeFileSystem(createGit(), options);
}
