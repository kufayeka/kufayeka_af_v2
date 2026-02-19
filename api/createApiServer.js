const http = require("node:http");

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

  const server = http.createServer(async (req, res) => {
    const method = req.method || "GET";
    const requestUrl = new URL(req.url || "/", `http://${req.headers.host}`);
    const urlPath = requestUrl.pathname;

    if (method === "GET" && urlPath === "/api/global") {
      sendJson(res, 200, { data: runtime.getGlobalEntries() });
      return;
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
