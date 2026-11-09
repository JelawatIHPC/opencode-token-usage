import { Plugin } from "@opencode/plugin"

/**
 * 服务端入口。真正的面板在终端侧（./tui.tsx）和桌面侧（./gui-experimental），
 * 这里只提供插件身份，让包同时具备 `.` / `./tui` / `./gui-experimental` 三个入口，
 * 符合 V2 的插件包布局。
 */
export default Plugin.define({
  id: "opencode-token-usage",
  setup() {},
})
