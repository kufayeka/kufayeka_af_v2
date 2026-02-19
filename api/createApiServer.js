const http = require("node:http");
const { createAssetFrameworkStore } = require("../runtime/assetFramework");

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";

    req.on("data", (chunk) => {
      raw += chunk;
    });

    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error("Body JSON tidak valid"));
      }
    });

    req.on("error", reject);
  });
}

function getKeyFromPath(urlPath) {
  if (!urlPath.startsWith("/api/global/")) return null;
  const encodedKey = urlPath.slice("/api/global/".length);
  if (!encodedKey) return null;
  return decodeURIComponent(encodedKey);
}

function createApiServer(runtime, options = {}) {
  const port = options.port ?? 4000;
  const host = options.host ?? "0.0.0.0";
  const assetStore = createAssetFrameworkStore(runtime.getGlobal("assetFramework", {}));

  const syncAssetGlobal = () => {
    runtime.setGlobal("assetFramework", assetStore.getState());
  };

  const server = http.createServer(async (req, res) => {
    const method = req.method || "GET";
    const requestUrl = new URL(req.url || "/", `http://${req.headers.host}`);
    const urlPath = requestUrl.pathname;

    if (method === "GET" && urlPath === "/api/global") {
      sendJson(res, 200, { data: runtime.getGlobalEntries() });
      return;
    }

    if (urlPath === "/api/assets" && method === "GET") {
      sendJson(res, 200, { data: assetStore.getState() });
      return;
    }

    if (urlPath === "/api/assets" && method === "PUT") {
      try {
        const body = await parseJsonBody(req);
        const next = assetStore.replace(body);
        syncAssetGlobal();
        sendJson(res, 200, { data: next });
      } catch (error) {
        sendJson(res, 400, { error: error.message });
      }
      return;
    }

    if (urlPath === "/api/assets/system" && method === "GET") {
      sendJson(res, 200, { data: assetStore.getState() });
      return;
    }

    if (urlPath === "/api/assets/system" && method === "PUT") {
      try {
        const body = await parseJsonBody(req);
        const next = assetStore.replace(body);
        syncAssetGlobal();
        sendJson(res, 200, { data: next });
      } catch (error) {
        sendJson(res, 400, { error: error.message });
      }
      return;
    }

    if (urlPath === "/api/assets/hierarchy" && method === "GET") {
      const populatedRaw = requestUrl.searchParams.get("populated");
      const populated =
        populatedRaw === null
          ? true
          : populatedRaw === "1" ||
            populatedRaw.toLowerCase() === "true" ||
            populatedRaw.toLowerCase() === "yes";
      const data = assetStore.getHierarchy({ populateAttributes: populated });
      sendJson(res, 200, { populated, count: data.length, data });
      return;
    }

    if (urlPath === "/api/assets/query" && method === "GET") {
      const pathQuery = requestUrl.searchParams.get("path") || "";
      if (!pathQuery) {
        sendJson(res, 400, { error: "Query parameter 'path' wajib diisi" });
        return;
      }
      const matches = assetStore.query(pathQuery);
      sendJson(res, 200, { path: pathQuery, count: matches.length, matches });
      return;
    }

    if (urlPath.startsWith("/api/assets/value/")) {
      const encoded = urlPath.slice("/api/assets/value/".length);
      const pathQuery = decodeURIComponent(encoded || "");
      if (!pathQuery) {
        sendJson(res, 400, { error: "Path asset wajib diisi" });
        return;
      }

      if (method === "GET") {
        const matches = assetStore
          .query(pathQuery)
          .filter((item) => item.kind === "attribute");
        sendJson(res, 200, { path: pathQuery, count: matches.length, matches });
        return;
      }

      if (method === "PUT") {
        try {
          const body = await parseJsonBody(req);
          if (!Object.prototype.hasOwnProperty.call(body, "value")) {
            sendJson(res, 400, { error: "Body wajib punya field 'value'" });
            return;
          }
          const matches = assetStore.setAttribute(pathQuery, body.value);
          syncAssetGlobal();
          sendJson(res, 200, { path: pathQuery, count: matches.length, matches });
        } catch (error) {
          sendJson(res, 400, { error: error.message });
        }
        return;
      }
    }

    const key = getKeyFromPath(urlPath);
    if (!key) {
      sendJson(res, 404, { error: "Route tidak ditemukan" });
      return;
    }

    if (method === "GET") {
      if (!runtime.hasGlobal(key)) {
        sendJson(res, 404, { error: `Key "${key}" tidak ditemukan` });
        return;
      }
      sendJson(res, 200, { key, value: runtime.getGlobal(key) });
      return;
    }

    if (method === "PUT") {
      try {
        const body = await parseJsonBody(req);
        if (!Object.prototype.hasOwnProperty.call(body, "value")) {
          sendJson(res, 400, { error: "Body wajib punya field 'value'" });
          return;
        }

        const value = runtime.setGlobal(key, body.value);
        sendJson(res, 200, { key, value });
      } catch (error) {
        sendJson(res, 400, { error: error.message });
      }
      return;
    }

    if (method === "DELETE") {
      const deleted = runtime.deleteGlobal(key);
      sendJson(res, 200, { key, deleted });
      return;
    }

    sendJson(res, 405, { error: `Method ${method} tidak didukung` });
  });

  return {
    start() {
      server.listen(port, host, () => {
        console.log(`Global store API aktif di http://${host}:${port}`);
      });
      return server;
    },
    stop() {
      return new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

module.exports = createApiServer;
