# Phase 4: API + Auth + React Shell - Research

**Researched:** 2026-03-21
**Domain:** Express API layer + JWT auth + React SPA scaffold on existing Node.js/Supabase pipeline
**Confidence:** HIGH

## Summary

Phase 4 adds three capabilities to the existing Node.js cron pipeline: (1) an Express HTTP layer serving API routes and static files, (2) JWT-based authentication with hardcoded env var credentials, and (3) a minimal React SPA shell with a login page and a protected home page. The scope deliberately excludes dashboard data, charts, and lead management -- those belong to Phases 5-7.

The existing `src/index.js` currently only validates env vars and loads the scheduler. Express must be added to this same process (no new PM2 processes). The React app builds to `dist/` and is served by Express's static middleware. Port 3005 must be rebound to `127.0.0.1` and proxied through the existing Nginx Proxy Manager for HTTPS.

**Primary recommendation:** Build Express + auth middleware first, then scaffold the React app with Vite, connect login flow, and configure Nginx last. Keep the cron scheduler untouched -- Express is purely additive to the same process.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| INFRA-01 | Express API layer serves React SPA and API routes from existing Node.js process | Express integration pattern in Architecture section; route mounting order; SPA catch-all pattern |
| INFRA-02 | Port 3005 bound to 127.0.0.1 behind Nginx Proxy Manager with HTTPS | Port binding pattern; Nginx Proxy Manager config; pitfall on 0.0.0.0 exposure |
| INFRA-03 | Vite React SPA builds to static dist/ served by Express | Vite build config; express.static() setup; build output path configuration |
| AUTH-01 | User can login with email/password (env var credentials) | Auth flow pattern; bcryptjs password hashing; POST /api/auth/login endpoint |
| AUTH-02 | JWT session persists across browser refresh (7-day expiry) | JWT signing with jsonwebtoken; localStorage token storage; 7d expiry config |
| AUTH-03 | Unauthenticated requests redirect to login page | Express middleware for 401; React-side auth guard with redirect; API client 401 handler |
</phase_requirements>

## Standard Stack

### Core (Backend additions)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| express | 5.2.x | HTTP server, API routing, static file serving | Industry standard; already the architecture decision; v5 stable since 2025 |
| jsonwebtoken | 9.x | JWT sign/verify for auth | Lightweight, no deps, standard for Node.js JWT |
| bcryptjs | 3.x | Password hash comparison | Pure JS (no native compilation needed on VPS); drop-in compatible with bcrypt API |

### Core (Frontend)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| react | 18.3.1 | UI framework | PROJECT.md decision; stable; required by TanStack Query v5 |
| react-dom | 18.3.1 | React DOM renderer | Matches react version |
| react-router-dom | 7.x | Client-side routing | Standard for React SPAs; library mode for pure SPA |
| @tanstack/react-query | 5.x | Server state management | Architecture decision; handles loading/error/cache for all API calls |
| vite | 6.x | Build tool + dev server | Fast, zero-config React template, ESM-native |
| tailwindcss | 4.x | Utility-first CSS | PROJECT.md decision |

### Why bcryptjs over bcrypt

`bcrypt` (v6) requires native compilation (`node-gyp`, `python3`, `make`). On the VPS, this can fail if build tools are missing. `bcryptjs` is a pure JavaScript implementation with the identical API -- `bcryptjs.compare(password, hash)` works identically. For a single-user login checked once per 7 days, the performance difference is irrelevant.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| bcryptjs | bcrypt (native) | Faster hashing but requires native build tools on VPS |
| jsonwebtoken | jose | jose is ESM-only; existing project is CommonJS |
| React Router v7 | TanStack Router | Type-safe routes but overkill for 5 routes |
| Tailwind v4 | Tailwind v3 | v4 has new CSS-first config; v3 is more documented but v4 is stable |

**Installation (backend):**
```bash
npm install express jsonwebtoken bcryptjs
```

**Installation (frontend):**
```bash
# From project root
npm create vite@latest frontend -- --template react
cd frontend
npm install react-router-dom @tanstack/react-query
npm install -D tailwindcss @tailwindcss/vite
```

## Architecture Patterns

### Recommended Project Structure (Phase 4 scope only)

```
leadgen/
├── src/
│   ├── index.js              # MODIFIED: add Express app, static serving, bind 127.0.0.1
│   ├── scheduler.js          # UNCHANGED
│   ├── tasks/                # UNCHANGED
│   ├── lib/                  # UNCHANGED
│   └── api/                  # NEW
│       ├── auth.js           # POST /api/auth/login
│       └── middleware.js     # JWT verification middleware
│
├── frontend/                 # NEW: React SPA
│   ├── index.html
│   ├── vite.config.js
│   ├── package.json
│   └── src/
│       ├── main.jsx
│       ├── App.jsx
│       ├── api/
│       │   └── client.js     # Fetch wrapper with Authorization header
│       ├── context/
│       │   └── AuthContext.jsx  # Auth state + protected route logic
│       └── pages/
│           ├── Login.jsx
│           └── Home.jsx      # Minimal protected page (placeholder for dashboard)
│
└── dist/                     # Vite build output (gitignored), served by Express
```

### Pattern 1: Express Added to Existing Entry Point

**What:** Add Express to `src/index.js` alongside the existing scheduler require. The scheduler remains a side-effect import. Express listens on 127.0.0.1:3005.

**When to use:** Always -- this is the architecture decision.

**Critical order:**
1. `dotenv` and env validation (existing)
2. Express app creation and middleware
3. API route mounting (`/api/auth`, `/api/*`)
4. Static file serving (`express.static`)
5. SPA catch-all (`app.get('*')`) -- MUST be last
6. `app.listen('127.0.0.1', 3005)`
7. `require('./scheduler')` -- scheduler starts independently

```javascript
// src/index.js (modified)
require("dotenv").config();

// ... existing env validation ...

const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());

// API routes (auth is public, all others require JWT)
app.use('/api/auth', require('./api/auth'));
// Future phases will add more routes here with middleware:
// app.use('/api', require('./api/middleware'), require('./api/leads'));

// Serve React build
app.use(express.static(path.join(__dirname, '..', 'dist')));

// SPA catch-all -- MUST be after all /api routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'dist', 'index.html'));
});

app.listen(3005, '127.0.0.1', () => {
  console.log('HTTP server listening on 127.0.0.1:3005');
});

// Load scheduler (unchanged)
try {
  require("./scheduler");
} catch (err) {
  console.error("Failed to load scheduler:", err.message);
  // Don't exit -- Express should keep running even if scheduler fails
}
```

### Pattern 2: JWT Auth Flow

**What:** POST `/api/auth/login` validates email+password from env vars, returns signed JWT. All other `/api/*` routes verify JWT via middleware.

**Env vars to add:**
```
DASHBOARD_USER=julien@messagingme.fr
DASHBOARD_PASSWORD_HASH=$2a$10$...  # bcrypt hash of the password
JWT_SECRET=<random 64-char hex string>
```

**Generate password hash (one-time):**
```javascript
const bcrypt = require('bcryptjs');
console.log(bcrypt.hashSync('chosen-password', 10));
```

```javascript
// src/api/auth.js
const { Router } = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const router = Router();

router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (email !== process.env.DASHBOARD_USER) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const valid = await bcrypt.compare(password, process.env.DASHBOARD_PASSWORD_HASH);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign(
    { sub: email },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.json({ token });
});

module.exports = router;
```

```javascript
// src/api/middleware.js
const jwt = require('jsonwebtoken');

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = authMiddleware;
```

### Pattern 3: React Auth Context + Protected Routes

**What:** AuthContext stores token in localStorage, provides login/logout functions. ProtectedRoute component wraps pages that require auth.

```javascript
// frontend/src/context/AuthContext.jsx
import { createContext, useContext, useState, useEffect } from 'react';
import { api } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Check if stored token is still valid on mount
    if (token) {
      api.get('/auth/check')
        .then(() => setIsLoading(false))
        .catch(() => {
          localStorage.removeItem('token');
          setToken(null);
          setIsLoading(false);
        });
    } else {
      setIsLoading(false);
    }
  }, []);

  const login = async (email, password) => {
    const data = await api.post('/auth/login', { email, password });
    localStorage.setItem('token', data.token);
    setToken(data.token);
  };

  const logout = () => {
    localStorage.removeItem('token');
    setToken(null);
  };

  return (
    <AuthContext.Provider value={{ token, login, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
```

### Pattern 4: API Client with 401 Auto-Redirect

```javascript
// frontend/src/api/client.js
const BASE = '/api';

async function request(method, path, body) {
  const token = localStorage.getItem('token');

  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    localStorage.removeItem('token');
    window.location.href = '/login';
    return;
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(err.error || `API error ${res.status}`);
  }

  return res.json();
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  patch: (path, body) => request('PATCH', path, body),
  delete: (path) => request('DELETE', path),
};
```

### Anti-Patterns to Avoid

- **SPA catch-all before API routes:** `app.get('*')` must be the LAST route. If placed before `/api/*`, all API calls return `index.html`.
- **Modifying scheduler.js:** Express is additive to `src/index.js`. The scheduler file stays untouched.
- **CORS middleware:** Not needed. React and API are served from the same origin (same Express process, same port). CORS only matters for cross-origin requests.
- **Service role key in frontend:** Never. The React app has zero Supabase imports in Phase 4. All data access goes through Express API in future phases.
- **process.exit(1) on scheduler failure:** With Express running, crashing the process kills the HTTP server too. Log the error, don't exit.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Password hashing | Custom hash function | bcryptjs | Timing attacks, salt handling, algorithm selection are all solved |
| JWT creation/verification | Manual base64 encoding | jsonwebtoken | Signature validation, expiry checking, algorithm options handled correctly |
| HTTP routing | Manual `http.createServer` with if/else | Express 5 | Route matching, middleware chain, error handling, static serving |
| Build tooling | Custom webpack config | Vite with react template | Zero config, fast HMR, production-ready output |
| Token storage security | Custom encryption in localStorage | Plain localStorage (acceptable for solo user) | No XSS vector matters for internal tool with one user on a private domain |

**Key insight:** Phase 4 is infrastructure plumbing. Every component has a battle-tested library. The only custom code is wiring them together.

## Common Pitfalls

### Pitfall 1: Port 3005 Still on 0.0.0.0

**What goes wrong:** Adding Express without changing the listen address leaves the API publicly accessible without HTTPS.
**Why it happens:** Default `app.listen(3005)` binds to all interfaces.
**How to avoid:** Always specify host: `app.listen(3005, '127.0.0.1', callback)`.
**Warning signs:** `ss -tlnp | grep 3005` shows `0.0.0.0:3005`.
**Verification:** `curl http://146.59.233.252:3005` from outside the VPS must be refused.

### Pitfall 2: SPA Routes Return 404 on Refresh

**What goes wrong:** Navigating to `/login` works via React Router, but F5 on `/login` returns 404 because Express has no file at that path.
**Why it happens:** The SPA catch-all `app.get('*')` is missing or placed before API routes.
**How to avoid:** The catch-all serves `dist/index.html` for all non-API, non-static paths. Must be last.
**Warning signs:** Direct URL access or F5 on any route other than `/` returns 404.

### Pitfall 3: Express Breaks Existing Scheduler

**What goes wrong:** Adding Express to `src/index.js` introduces a crash (syntax error, missing module) that kills the PM2 process, stopping all 7 cron tasks.
**Why it happens:** No safety net -- PM2 restarts the process, but if the error persists, PM2 stops restarting.
**How to avoid:** Test the Express addition locally (or with `node src/index.js` on VPS) before `pm2 restart`. Wrap scheduler require in try/catch (already done). Never let Express errors propagate to uncaught exceptions.
**Warning signs:** `pm2 status` shows the process in `errored` state with restart count climbing.

### Pitfall 4: Vite Build Output Path Mismatch

**What goes wrong:** Vite builds to `frontend/dist/` by default, but Express looks for `../dist/` relative to `src/`.
**Why it happens:** Default Vite `outDir` is relative to the Vite project root.
**How to avoid:** Configure `vite.config.js` with `build: { outDir: '../dist' }` to output at project root.
**Warning signs:** Express serves an empty page or 404 for all routes after build.

### Pitfall 5: PM2 Env Var Caching

**What goes wrong:** Adding `DASHBOARD_USER`, `DASHBOARD_PASSWORD_HASH`, `JWT_SECRET` to `.env` and running `pm2 restart` does not pick them up.
**Why it happens:** PM2 caches env vars at process start. `restart` reuses the cached env.
**How to avoid:** Use `pm2 delete leadgen && pm2 start src/index.js --name leadgen` to force reload. Or use `pm2 start ecosystem.config.js` with env vars defined there.
**Warning signs:** Login always returns 401 even with correct credentials. `process.env.JWT_SECRET` is undefined.

### Pitfall 6: bcrypt Native Build Failure on VPS

**What goes wrong:** `npm install bcrypt` fails because `node-gyp` requires Python 3, make, and gcc which may not be installed on the VPS.
**Why it happens:** bcrypt v6 is a native addon.
**How to avoid:** Use `bcryptjs` instead -- pure JavaScript, identical API, no native dependencies.
**Warning signs:** `npm install` shows gyp ERR! during bcrypt compilation.

## Vite Configuration

```javascript
// frontend/vite.config.js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: '../dist',      // Output to project root dist/
    emptyOutDir: true,      // Clean dist/ before build
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:3005',  // Dev server proxies API to Express
    },
  },
});
```

## Nginx Proxy Manager Configuration

In Nginx Proxy Manager UI, add a new Proxy Host:

- **Domain:** `leadgen.messagingme.fr` (or chosen subdomain)
- **Forward Hostname/IP:** `127.0.0.1`
- **Forward Port:** `3005`
- **SSL:** Request new Let's Encrypt certificate, Force SSL
- **Advanced (Custom Nginx Configuration):** Not needed -- Express handles SPA routing with its catch-all. NPM just proxies.

**Important:** Since Express serves both the React SPA and API routes on the same port, Nginx only needs a single proxy host. No `try_files` needed at the Nginx level -- Express's catch-all handles it.

## Supabase Keep-Alive

Add a weekend keep-alive to prevent the 7-day free tier pause (STATE.md blocker):

```javascript
// In src/index.js or scheduler.js
const cron = require('node-cron');
const { supabase } = require('./lib/supabase');

// Weekend keep-alive (Saturday and Sunday 10:00 Paris time)
cron.schedule('0 10 * * 0,6', async () => {
  try {
    await supabase.from('leads').select('id', { count: 'exact', head: true });
    console.log('Supabase keep-alive ping OK');
  } catch (err) {
    console.error('Supabase keep-alive failed:', err.message);
  }
}, { timezone: 'Europe/Paris' });
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Express 4 | Express 5 (stable) | 2025 | Async error handling built-in, no need for express-async-errors |
| Tailwind v3 (JS config) | Tailwind v4 (CSS-first config) | 2025 | No `tailwind.config.js` needed; config via `@theme` in CSS |
| CRA (create-react-app) | Vite | 2023+ | CRA abandoned; Vite is the standard for new React projects |
| bcrypt (native) | bcryptjs (pure JS) | Always available | No build tools needed; identical API |

## Build & Deploy Flow

```
Development on VPS:
1. cd /home/openclaw/leadgen/frontend && npm run build  → outputs to ../dist/
2. pm2 delete leadgen && pm2 start src/index.js --name leadgen
3. Verify: curl -s http://127.0.0.1:3005/ → returns HTML
4. Verify: curl -s http://127.0.0.1:3005/api/auth/login → returns 4xx (no body)
5. Verify: curl http://146.59.233.252:3005 → connection refused (bound to 127.0.0.1)
6. Verify via browser: https://leadgen.messagingme.fr → React login page
```

## Open Questions

1. **Domain name for the dashboard**
   - What we know: Nginx Proxy Manager requires a domain/subdomain for the proxy host
   - What's unclear: Exact subdomain to use (e.g., `leadgen.messagingme.fr` vs `app.messagingme.fr`)
   - Recommendation: Use whatever domain Julien prefers; configuration is a one-line change in NPM

2. **JavaScript vs TypeScript for React**
   - What we know: Backend is plain JavaScript (CommonJS). ARCHITECTURE.md shows JSX examples. STACK.md recommends TypeScript.
   - What's unclear: Whether TypeScript adds enough value for a solo-user internal tool
   - Recommendation: Use plain JavaScript (JSX) for consistency with the backend and faster iteration. TypeScript can be added later if needed. The architecture research examples are all in JS.

3. **React 18 vs React 19**
   - What we know: React 19 is latest (19.2.4). ARCHITECTURE.md specifies React 18.
   - What's unclear: Whether React 19 has any breaking changes for this use case
   - Recommendation: Use React 18.3.1 as specified in architecture. It is stable, all libraries (TanStack Query v5, React Router) support it, and there is no feature in React 19 needed for this project.

## Sources

### Primary (HIGH confidence)
- Existing codebase: `src/index.js`, `src/scheduler.js`, `package.json` -- verified current state
- `.planning/research/ARCHITECTURE.md` -- locked architecture decisions
- `.planning/research/PITFALLS.md` -- catalogued pitfalls
- `.planning/research/STACK.md` -- stack research (some conflicts with architecture -- architecture takes precedence)
- npm registry: express@5.2.1, jsonwebtoken@9.0.3, bcryptjs@3.0.3, vite@8.0.1, react@18.3.1, react-router-dom@7.13.1, @tanstack/react-query@5.94.5 -- verified via `npm view`

### Secondary (MEDIUM confidence)
- Express 5 migration guide (async error handling improvements)
- Vite v6 documentation (react template, build config)
- Tailwind v4 CSS-first configuration approach

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries verified via npm, versions confirmed
- Architecture: HIGH -- based on locked decisions in ARCHITECTURE.md, verified against existing codebase
- Pitfalls: HIGH -- cross-referenced with PITFALLS.md research, verified against codebase patterns (CommonJS, PM2, port 3005)

**Research date:** 2026-03-21
**Valid until:** 2026-04-21 (stable domain, no fast-moving dependencies)
