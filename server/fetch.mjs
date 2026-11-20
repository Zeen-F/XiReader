// Use the audited runtime dependency rather than Electron/Node's embedded copy.
// Keep this scoped to our Node request sites; do not replace browser/global APIs.
export { fetch } from 'undici';
