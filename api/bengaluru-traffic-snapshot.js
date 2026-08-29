const snapshot = require("../data/bengaluru-traffic-weekly-snapshot.json");
const { allowMethods, sendJson } = require("./_lib/http");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    allowMethods(res, ["GET"]);
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }
  sendJson(res, 200, snapshot);
};
