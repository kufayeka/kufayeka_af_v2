// const ASSET_URL =
//   "http://localhost:3000/api/asset-attributes/value?path=Jasuindo.Timestamp";
const ASSET_URL =
  "http://localhost:3000/api/assets/path?path=Jasuindo.Taiyo1"

  async function readAssetValue() {
  const response = await fetch(ASSET_URL);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }

  return response.text();
}

async function fn2Node(msg, send) {
  const calculated = msg.payload * 10;

  try {
    const remoteValue = await readAssetValue();
    msg.payload = {
      calculated,
      remoteValue,
    };
    //console.log("fn2:", msg.payload);
    console.log("fn2: berhasil ambil data async I/O");
  } catch (error) {
    msg.payload = {
      calculated,
      remoteValue: null,
      error: error.message,
    };
    console.error("fn2: gagal ambil data async I/O:", error.message);
  }

  send(msg);
}

module.exports = fn2Node;
