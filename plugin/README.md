# nodrix for Claude Code

Connects Claude Code to your own [nodrix](https://nodrix.live) deployment over MCP. Claude can read live telemetry from your devices and, once you allow it, manage projects, variables, dashboards, automations, and integrations, and send commands to hardware.

nodrix is self-hosted, so the plugin talks only to the instance you configure.

## Setup

1. In nodrix, open **Settings** and turn on the **MCP server** card. Turn on **Allow control writes** as well if Claude should be able to change anything.
2. Install the plugin in Claude Code, and enter your MCP endpoint when prompted. The card shows it, for example `https://nodrix.example.workers.dev/v1/mcp`.

   ```
   /plugin install nodrix --marketplace decoded-cipher/nodrix
   ```
3. The first time Claude uses nodrix, Claude Code opens your browser so you can sign in and approve access. You choose read-only or read and manage on that screen.

## Tools

- **Read (12):** projects, variables, current state, telemetry history, dashboards, widgets, automations, and integrations. Integration secrets are redacted.
- **Write (16):** create and update projects, variables, dashboards, widgets, automations, and integrations; set a variable (which sends a command to the device); run an automation; emit an event; test an integration. These need read-and-manage access and the owner's **Allow control writes** setting, and Claude asks before running each one.

There are no delete tools.

## claude.ai

In claude.ai, add your MCP endpoint as a custom connector instead. claude.ai doesn't connect a plugin's MCP server when its URL comes from your settings.

## License

MIT
