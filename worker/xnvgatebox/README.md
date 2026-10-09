# xnvgatebox single Worker

这是项目对外的唯一 Cloudflare Worker 入口，提供管理页、订阅、节点检查入口和数据面 WebSocket 入口。`worker/control/worker.mjs` 保存可单元测试的路由实现，本目录只提供唯一发布入口。

`LEGACY_CHECKER_URL` 和 `LEGACY_EDGE_URL` 仅用于第一轮迁移兼容：统一入口会验证请求后转发到已存在的过渡程序。它们不是用户需要单独部署的项目；下一阶段会用本项目自有、许可证兼容的模块替换这些迁移上游，届时删除两个变量。

生产部署只绑定一个 KV Namespace（键 `manifest:current`）。`PUBLIC_HOST` 必须是这个 Worker 的公开主机名，确保订阅链接回到统一入口。
