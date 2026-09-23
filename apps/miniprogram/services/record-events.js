const api = require("./api");
const { requestId } = require("./photo-upload-session");

function recordSession() {
  const sessionId = requestId();
  return {
    opened(entry, petId) { send("record_entry_opened", Object.assign({ sessionId, entry }, petId ? { petId } : {})); },
    viewed(petId, viewType) { send("memory_viewed", { sessionId, petId, viewType }); },
    deliverable(petId, productId, entry) { send("record_deliverable_opened", { petId, productId, entry }); }
  };
}
function send(name, metadata) { api.request("/api/events", { method: "POST", data: { name, channel: "miniprogram", metadata } }).catch(() => undefined); }
module.exports = { recordSession };
