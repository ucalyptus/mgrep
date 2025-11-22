# Local Setup with Ollama

This guide explains how to use `mgrep` with local embedding models via Ollama instead of the Mixedbread API.

## Why Local Mode?

- **Privacy**: All data stays on your machine
- **No API costs**: Free to use
- **Custom models**: Use any embedding model supported by Ollama
- **Offline capable**: Works without internet connection

## Prerequisites

### 1. Install Ollama

Download and install Ollama from [ollama.com](https://ollama.com) or:

```bash
# macOS
brew install ollama

# Linux
curl -fsSL https://ollama.com/install.sh | sh
```

### 2. Pull an Embedding Model

The default model is `mxbai-embed-large` (same as Mixedbread's model):

```bash
ollama pull mxbai-embed-large
```

Other embedding models available:
- `nomic-embed-text` - 768 dimensions, fast and efficient
- `all-minilm` - 384 dimensions, lightweight
- `snowflake-arctic-embed` - Multi-lingual support

## Configuration

### Enable Local Mode

Set the `MGREP_LOCAL` environment variable:

```bash
export MGREP_LOCAL=true
```

### Optional Configuration

```bash
# Specify a different embedding model (default: mxbai-embed-large)
export MXBAI_MODEL="nomic-embed-text"

# Specify Ollama host (default: http://127.0.0.1:11434)
export OLLAMA_HOST="http://localhost:11434"

# Specify database path (default: ~/.mgrep)
export MGREP_DB_PATH="$HOME/.mgrep"
```

## Usage

### Basic Workflow

1. **Start Ollama** (if not running as a service):
   ```bash
   ollama serve
   ```

2. **Index your files**:
   ```bash
   MGREP_LOCAL=true mgrep watch
   ```

3. **Search semantically**:
   ```bash
   MGREP_LOCAL=true mgrep search "authentication logic"
   ```

### Example: Complete Setup

```bash
# 1. Install Ollama
brew install ollama

# 2. Pull the embedding model
ollama pull mxbai-embed-large

# 3. Start Ollama (in background)
ollama serve &

# 4. Configure environment (add to ~/.bashrc or ~/.zshrc)
export MGREP_LOCAL=true
export MXBAI_MODEL="mxbai-embed-large"

# 5. Index your codebase
cd /path/to/your/project
mgrep watch

# 6. Search
mgrep search "error handling middleware"
mgrep search -m 20 "database connection pool"
mgrep search -c "authentication flow" src/
```

## Store Management

Each indexed codebase is stored as a separate "store". By default, the store name is "mgrep".

### Using Different Stores

```bash
# Index with a custom store name
mgrep watch --store my-project

# Search in a specific store
mgrep search "function name" --store my-project
```

### Database Location

All vector data is stored in LanceDB format at:
- Default: `~/.mgrep/`
- Custom: Set via `MGREP_DB_PATH`

To clear all data:
```bash
rm -rf ~/.mgrep/
```

## Performance Tips

1. **Model Selection**:
   - `mxbai-embed-large`: Best accuracy, slower
   - `nomic-embed-text`: Good balance
   - `all-minilm`: Fastest, smaller footprint

2. **Hardware Requirements**:
   - Minimum: 8GB RAM
   - Recommended: 16GB RAM + Apple Silicon or NVIDIA GPU

3. **Indexing Speed**:
   - Initial indexing processes ~10-50 files/second (depends on model and hardware)
   - Subsequent updates are incremental and faster

## Switching Between Local and Remote

You can switch between local (Ollama) and remote (Mixedbread) modes:

```bash
# Use remote Mixedbread API
unset MGREP_LOCAL
mgrep search "query"

# Use local Ollama
export MGREP_LOCAL=true
mgrep search "query"
```

**Note**: Local and remote modes use separate databases, so you'll need to re-index when switching.

## Troubleshooting

### Ollama Connection Issues

```bash
# Check if Ollama is running
curl http://localhost:11434/api/version

# Start Ollama
ollama serve
```

### Model Not Found

```bash
# List available models
ollama list

# Pull the required model
ollama pull mxbai-embed-large
```

### Slow Performance

- Use a smaller/faster model: `export MXBAI_MODEL="all-minilm"`
- Ensure Ollama is using GPU acceleration
- Check system resources: `top` or Activity Monitor

### Database Issues

```bash
# Reset database
rm -rf ~/.mgrep/

# Re-index
mgrep watch
```

## Advanced: Using Custom Models

You can use any embedding model available in Ollama:

```bash
# Pull a custom model
ollama pull <model-name>

# Configure mgrep to use it
export MXBAI_MODEL="<model-name>"

# Index and search
mgrep watch
mgrep search "your query"
```

## Comparison: Local vs Remote

| Feature | Local (Ollama) | Remote (Mixedbread) |
|---------|----------------|---------------------|
| **Privacy** | ✅ Complete | ❌ Data sent to API |
| **Cost** | ✅ Free | 💰 API costs |
| **Setup** | ⚙️ Requires Ollama | ✅ Just login |
| **Speed** | 🐌 Depends on hardware | ⚡ Fast (cloud servers) |
| **Model Choice** | ✅ Any Ollama model | ❌ Fixed models |
| **Offline** | ✅ Works offline | ❌ Requires internet |
| **Multimodal** | ❌ Text only | ✅ Text, images, audio, video |

## Getting Help

- Ollama documentation: https://github.com/ollama/ollama
- LanceDB documentation: https://lancedb.github.io/lancedb/
- Report issues: https://github.com/mixedbread-ai/mgrep/issues
