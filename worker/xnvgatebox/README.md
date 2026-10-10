# xnvgatebox single Worker

这是项目对外的唯一 Cloudflare Worker 入口，提供管理页、订阅、节点检查入口和数据面 WebSocket 入口。`worker/control/worker.mjs` 保存可单元测试的路由实现，本目录只提供唯一发布入口。

Worker 内置节点出口检查和 TCP-only VLESS 数据面，直接通过 Cloudflare Sockets 连接 VPN Gate SSTP 节点，不转发到其他 Worker。部署只需要这个 Worker 和一个 KV Namespace。

生产部署只绑定一个 KV Namespace（键 `manifest:current`）。`PUBLIC_HOST` 必须是这个 Worker 的公开主机名，确保订阅链接回到统一入口。
