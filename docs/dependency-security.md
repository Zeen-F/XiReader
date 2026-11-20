# Desktop runtime dependencies

The server uses the application's pinned `undici` fetch implementation for Node HTTP requests. Electron and Node also provide a separate embedded implementation. The application dependency is pinned in the lockfile and ships with the desktop and browser distributions.

Run `npm ci`, `npm audit --omit=dev` and `npm run check` to verify a checkout. The regression suite checks which fetch implementation the application imports, bounded input validation, and translation-provider errors and recovery. The package build verifies that the runtime dependencies are present.
