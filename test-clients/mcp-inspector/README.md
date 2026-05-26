# mcp-inspector

Dev wrapper around [`@modelcontextprotocol/inspector`](https://github.com/modelcontextprotocol/inspector) pointed at the deployed `/v1/mcp`.

```bash
cp .env.example .env   # fill MCP_URL + MCP_BEARER
bun install

bun run ui                              # browser UI
bun run list-tools
bun run list-projects
PROJECT=prj_xxx bun run list-variables
PROJECT=prj_xxx bun run list-dashboards
PROJECT=prj_xxx bun run get-state

# ad-hoc:
bun inspect.mjs --method tools/call \
  --tool-name get_series --tool-arg project=prj_xxx --tool-arg key=power
```
