const BASE = "/api";

async function request(method, path, body) {
  const token = localStorage.getItem("token");

  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    localStorage.removeItem("token");
    window.location.href = "/login";
    return;
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error || `API error ${res.status}`);
  }

  return res.json();
}

export const api = {
  get: (path) => request("GET", path),
  post: (path, body) => request("POST", path, body),
  put: (path, body) => request("PUT", path, body),
  patch: (path, body) => request("PATCH", path, body),
  delete: (path) => request("DELETE", path),
};
