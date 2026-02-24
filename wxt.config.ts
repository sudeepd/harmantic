import { defineConfig } from "wxt";

export default defineConfig({
  extensionApi: "chrome",
  manifest: {
    name: "Harmantic",
    description: "Record browser sessions and generate API tests",
    permissions: ["declarativeNetRequest"],
    host_permissions: ["<all_urls>"],
  },
});
