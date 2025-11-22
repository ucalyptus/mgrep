import * as fs from "node:fs";
import * as path from "node:path";
import { Ollama } from "ollama";
import { connect, type Connection, type Table } from "@lancedb/lancedb";
import type {
  Store,
  StoreFile,
  UploadFileOptions,
  SearchResponse,
  AskResponse,
  ChunkType,
  FileMetadata,
  CreateStoreOptions,
  StoreInfo,
} from "./store";
import type { SearchFilter } from "@mixedbread/sdk/resources/shared";

interface Chunk {
  id: string; // unique chunk identifier: filepath:chunk_index
  file_id: string; // external_id (filepath)
  chunk_index: number;
  text: string;
  vector: number[];
  metadata: FileMetadata;
  type: string;
  offset?: number;
  generated_metadata?: {
    start_line?: number;
    num_lines?: number;
    word_count?: number;
    file_size?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown; // Index signature for LanceDB
}

interface SearchResult extends Chunk {
  _distance: number;
}

export class LocalStore implements Store {
  private ollama: Ollama;
  private dbConnection: Connection | null = null;
  private model: string;
  private dbPath: string;

  constructor(options?: { model?: string; ollamaHost?: string; dbPath?: string }) {
    this.model = options?.model || process.env.MXBAI_MODEL || "mxbai-embed-large";
    this.ollama = new Ollama({ host: options?.ollamaHost || process.env.OLLAMA_HOST || "http://127.0.0.1:11434" });
    this.dbPath = options?.dbPath || process.env.MGREP_DB_PATH || path.join(process.env.HOME || "~", ".mgrep");
  }

  private async getConnection(): Promise<Connection> {
    if (!this.dbConnection) {
      // Ensure db directory exists
      await fs.promises.mkdir(this.dbPath, { recursive: true });
      this.dbConnection = await connect(this.dbPath);
    }
    return this.dbConnection;
  }

  private async getTable(storeId: string): Promise<Table> {
    const conn = await this.getConnection();
    const tables = await conn.tableNames();

    // Sanitize store name for use as table name
    const tableName = `store_${storeId.replace(/[^a-zA-Z0-9_]/g, "_")}`;

    if (!tables.includes(tableName)) {
      throw new Error(`Store '${storeId}' does not exist. Create it first with 'watch' command.`);
    }

    return await conn.openTable(tableName);
  }

  private async createTable(storeId: string): Promise<Table> {
    const conn = await this.getConnection();
    const tableName = `store_${storeId.replace(/[^a-zA-Z0-9_]/g, "_")}`;

    // Create empty table with schema
    const data: Chunk[] = [];
    return await conn.createTable(tableName, data, { mode: "overwrite" });
  }

  private async generateEmbedding(text: string): Promise<number[]> {
    const response = await this.ollama.embeddings({
      model: this.model,
      prompt: text,
    });
    return response.embedding;
  }

  private chunkText(text: string, chunkSize: number = 512): string[] {
    const words = text.split(/\s+/);
    const chunks: string[] = [];

    for (let i = 0; i < words.length; i += chunkSize) {
      chunks.push(words.slice(i, i + chunkSize).join(" "));
    }

    return chunks.length > 0 ? chunks : [""];
  }

  async *listFiles(storeId: string): AsyncGenerator<StoreFile> {
    try {
      const table = await this.getTable(storeId);
      const results = await table
        .query()
        .select(["file_id", "metadata"])
        .toArray();

      const seen = new Set<string>();
      for (const row of results) {
        const fileId = row.file_id as string;
        if (!seen.has(fileId)) {
          seen.add(fileId);
          yield {
            external_id: fileId,
            metadata: row.metadata as FileMetadata | null,
          };
        }
      }
    } catch (error) {
      // If store doesn't exist, yield nothing
      if (error instanceof Error && error.message.includes("does not exist")) {
        return;
      }
      throw error;
    }
  }

  async uploadFile(
    storeId: string,
    file: File | ReadableStream,
    options: UploadFileOptions,
  ): Promise<void> {
    let table: Table;
    try {
      table = await this.getTable(storeId);
    } catch {
      table = await this.createTable(storeId);
    }

    // Read file content
    let buffer: Buffer;
    if (file instanceof ReadableStream) {
      const chunks: Uint8Array[] = [];
      const reader = file.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      buffer = Buffer.concat(chunks);
    } else {
      buffer = Buffer.from(await file.arrayBuffer());
    }

    const content = buffer.toString("utf-8");
    const textChunks = this.chunkText(content);

    // Delete existing chunks for this file if overwriting
    if (options.overwrite) {
      await table.delete(`file_id = '${options.external_id}'`);
    }

    // Create embeddings for each chunk
    const chunks: Chunk[] = [];
    const lines = content.split("\n");

    for (let i = 0; i < textChunks.length; i++) {
      const chunkText = textChunks[i];
      const vector = await this.generateEmbedding(chunkText);

      // Estimate line numbers for this chunk
      const wordsPerChunk = 512;
      const estimatedWordsInFile = content.split(/\s+/).length;
      const startLine = Math.floor((i * wordsPerChunk / estimatedWordsInFile) * lines.length);
      const endLine = Math.min(
        Math.floor(((i + 1) * wordsPerChunk / estimatedWordsInFile) * lines.length),
        lines.length
      );

      chunks.push({
        id: `${options.external_id}:${i}`,
        file_id: options.external_id,
        chunk_index: i,
        text: chunkText,
        vector,
        metadata: options.metadata as FileMetadata,
        type: "text",
        offset: i * wordsPerChunk,
        generated_metadata: {
          start_line: startLine,
          num_lines: endLine - startLine,
          word_count: chunkText.split(/\s+/).length,
          file_size: buffer.length,
        },
      });
    }

    // Add chunks to table
    if (chunks.length > 0) {
      await table.add(chunks);
    }
  }

  async search(
    storeId: string,
    query: string,
    top_k?: number,
    _search_options?: { rerank?: boolean },
    filters?: SearchFilter,
  ): Promise<SearchResponse> {
    const table = await this.getTable(storeId);
    const queryEmbedding = await this.generateEmbedding(query);

    let queryBuilder = table
      .vectorSearch(queryEmbedding)
      .limit(top_k || 10);

    // Apply filters
    if (filters && "all" in filters && Array.isArray(filters.all)) {
      for (const filter of filters.all) {
        if ("key" in filter && "operator" in filter && "value" in filter) {
          if (filter.key === "path" && filter.operator === "starts_with") {
            queryBuilder = queryBuilder.where(`file_id LIKE '${filter.value}%'`);
          }
        }
      }
    }

    const results = await queryBuilder.toArray();

    const data: ChunkType[] = results.map((row: SearchResult) => ({
      chunk_index: row.chunk_index,
      mime_type: "text/plain",
      generated_metadata: row.generated_metadata ? {
        type: "text" as const,
        file_type: "text/plain" as const,
        language: "unknown",
        word_count: row.generated_metadata.word_count || 0,
        file_size: row.generated_metadata.file_size || 0,
        start_line: row.generated_metadata.start_line,
        num_lines: row.generated_metadata.num_lines,
      } : null,
      model: this.model,
      score: 1 - (row._distance / 2), // Convert distance to similarity score
      file_id: row.file_id,
      filename: path.basename(row.file_id),
      store_id: storeId,
      metadata: row.metadata,
      type: "text" as const,
      offset: row.offset,
      text: row.text,
    }));

    return { data };
  }

  async retrieve(storeId: string): Promise<unknown> {
    await this.getTable(storeId);
    return {
      name: storeId,
      id: storeId,
      exists: true,
    };
  }

  async create(options: CreateStoreOptions): Promise<unknown> {
    await this.createTable(options.name);
    return {
      name: options.name,
      id: options.name,
      description: options.description,
    };
  }

  async ask(
    storeId: string,
    question: string,
    top_k?: number,
    search_options?: { rerank?: boolean },
    filters?: SearchFilter,
  ): Promise<AskResponse> {
    // Get relevant chunks via search
    const searchResults = await this.search(storeId, question, top_k, search_options, filters);

    // For now, return a simple answer. In the future, this could use Ollama's LLM capabilities
    // to generate a more sophisticated answer from the context
    const answer = `Based on the search results, I found ${searchResults.data.length} relevant code chunks. ` +
      `To get AI-generated answers, you would need to integrate an LLM model via Ollama.`;

    return {
      answer,
      sources: searchResults.data,
    };
  }

  async getInfo(storeId: string): Promise<StoreInfo> {
    try {
      await this.getTable(storeId);

      return {
        name: storeId,
        description: "",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        counts: {
          pending: 0,
          in_progress: 0,
        },
      };
    } catch (_error) {
      return {
        name: storeId,
        description: "",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        counts: {
          pending: 0,
          in_progress: 0,
        },
      };
    }
  }
}
