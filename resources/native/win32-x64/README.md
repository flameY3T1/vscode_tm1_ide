# TM1 Top native helper

Windows x64, .NET Framework 4.x and the IBM TM1 client bin64 installation are
required on the **extension host**. A Windows desktop with a Linux/WSL remote
extension host does not satisfy that requirement. IBM DLLs and certificate
stores are not redistributed. `tm1.nativeApiPath` selects the client directory
or its `tm1api.dll`; the default is `C:\Program Files\ibm\tm1_64\bin64`.

Build from this directory using the framework compiler (no C++ toolchain):

```bat
C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe -nologo -platform:x64 -r:System.Web.Extensions.dll -out:tm1top.exe Tm1TopHelper.cs
```

`System.Web.Extensions` is a .NET Framework assembly used for JSON parsing and
serialization. The packaged executable is built from the adjacent source. If
absent, discovery compiles that source into the extension's storage directory.

## Protocol and lifetime

Arguments: `<bin64Dir> <adminHost> <serverName> [operation]`. The default operation
is `getState`, preserving the proven three-argument display invocation.

| Operation | Standard input | One JSON object on standard output |
| --- | --- | --- |
| `enumServers` | none | `{ "servers": ["TM1SRV"] }` |
| `getState` | none | `{ "rows": ["16024\tTh:Pseudo\t-\tIdle\t-\t-\t-\t-\t     0", "   "] }` |
| `verifyAdmin` | `{ "username": "…", "password": "…" }` followed by EOF | `{ "verified": true }` or false |
| `kill` | `{ "username": "…", "password": "…", "threadId": "16024" }` followed by EOF | `{ "killed": true }` |

Errors return exit code 2 and `{ "error": "…", "reason": "…", "code": 84 }`
(numeric code only for native API errors). Credentials never enter arguments,
output, logs or persisted webview state. Input is bounded at 64 KiB.

Each invocation owns one system handle, value pool and connection, and releases
them before exiting. Killing the child on timeout contains blocked/crashed native
calls; the next request starts a new child. Cancellation is never retried.
Every `kill` verifies credentials on **that same native connection** before
calling cancellation. A successful verification in a prior process is only a UI
gate, never native authorization for the next process. This username/password
path does not implement CAM passport or integrated-login credential acquisition.
The anonymous display path does not depend on those authentication modes.

## Notes

- `TM1ValArraySize` gives the true one-based element count of a value array;
  `TM1ValArrayMaxSize` is the allocated capacity and is wrong here. State rows
  are individual tab-separated strings, including a whitespace-only trailing
  sentinel.
- Cleanup uses `TM1SystemServerDisconnect(pool, connection)`, then
  `TM1ValPoolDestroy(pool)` and `TM1SystemClose(system)` in that order.
- Native destinations come from admin registration; the client does not rewrite
  advertised addresses.
