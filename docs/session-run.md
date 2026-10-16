# Running another program as a profile

`allman session run <name> -- <command...>` starts a program as one registered
LinkedIn profile through its BrowserOS neo MCP endpoint.

## Bind the MCP endpoint once

    allman session bind-mcp brian --mcp http://127.0.0.1:9010/mcp
    allman session bind-mcp jp --mcp http://127.0.0.1:9012/mcp

Binding lists open page targets through the MCP endpoint and through the
profile's CDP endpoint (`/json/list`). They must share at least one page,
otherwise the endpoints belong to different browsers and binding is refused.
Each browser needs at least one open tab while binding.

## Run

    allman session run jp -- lmc mutuals targets.xlsx

In order, `session run`:

1. takes `linkedin-command.lock` and keeps it until the program exits;
2. checks the MCP/CDP binding again;
3. resolves the profile's LinkedIn member ID from its store;
4. activates the profile: the other profiles are paused, and Shield is
   verified on the target over CDP;
5. starts the program with these variables:

| Variable | Value |
|---|---|
| `ALLMAN_PROFILE` | profile name |
| `ALLMAN_NEO_MCP_URL` | the bound MCP endpoint |
| `ALLMAN_EXPECTED_MEMBER_ID` | the profile's `ACo…` member ID |
| `ALLMAN_SESSION_RUN` | `1` |

allman exits with the program's exit code. Ctrl-C reaches the program
directly; allman waits for it to exit, then releases the lock. SIGTERM and
SIGHUP are forwarded.

Any failure in steps 1–4 stops before the program starts. Steps 2 and 3 fail
before the active profile changes.

The program must check, before any other LinkedIn request, that the signed-in
account equals `ALLMAN_EXPECTED_MEMBER_ID`.
