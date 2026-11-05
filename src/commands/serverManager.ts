// Thin facade — re-exports the serverManager sub-modules so the ~58 existing
// importers of `../serverManager` keep working unchanged. The real code lives
// in `./serverManager/{state,profiles,migrations,connection,form}.ts`.
//   - state       singleton leaf: in-memory connection map, emitters, keys,
//                 profile CRUD helpers, name resolver, initServerManager
//   - profiles    per-server profile/git/folder/process-group reads & writes
//   - migrations  one-time globalState/settings migrations
//   - connection  connect/disconnect/restore + connect-error mapping
//   - form        webview form data, connection test, discovery, manager UI
export * from '../serverState/state';
export * from '../serverState/profiles';
export * from './serverManager/migrations';
export * from './serverManager/connection';
export * from './serverManager/form';
export * from '../serverState/adminServers';
export * from '../providers/adminDiscovery';
export {
  requireServerConfig, requireServerConfigOrThrow, serverIdForCommand,
} from '../serverState/requireServerConfig';
