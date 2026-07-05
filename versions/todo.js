
// Register the custom protocol handler dynamically
if ("registerProtocolHandler" in navigator) {
  try {
    navigator.registerProtocolHandler(
      "web+myapp", 
      `${window.location.origin}/handle-protocol?open=%s`,
      "My Markdown Notes"
    );
    console.log("Protocol handler registered successfully!");
  } catch (err) {
    console.error("Failed to register protocol handler:", err);
  }
} else {
  console.warn("Protocol handler API not supported in this browser.");
}

