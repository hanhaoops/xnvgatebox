# Cloudflare control Worker

这是项目自己的管理层与订阅层，和 `worker/edge` 的数据面分开部署。它只读取 GitHub Actions 发布到 KV 的 `manifest:current`，因此不会接收任意 `proxyip`、SOCKS5 地址或未经验证的 VPN Gate 节点。

接口：

- `GET /health`：返回配置和当前 manifest 是否可用，不返回凭证。
- `GET /admin`：手工管理页面。管理员 token 只通过 `Authorization: Bearer ...` 请求 `/api/status`。
- `GET /api/status`：管理员查看节点池和有效期。
- `GET /api/manifest`：管理员导出当前无凭证 manifest。
- `GET /sub?token=...`：返回 Base64 编码的 VLESS 订阅。token 不写入页面和 manifest。

Worker Secrets：

```text
VLESS_UUID       # UUID v4
ADMIN_TOKEN      # 管理接口 token
SUB_TOKEN        # 订阅 token
VPN_USERNAME     # 可选，默认 vpn
VPN_PASSWORD     # 可选，默认 vpn
DATA_PLANE_HOST  # 可选；覆盖 manifest.data_plane.host
DATA_PLANE_PORT  # 可选；覆盖 manifest.data_plane.port
DATA_PLANE_BASE_PATH # 可选；覆盖 manifest.data_plane.base_path
```

`MANIFEST` 是 KV namespace binding，固定读取键 `manifest:current`。没有 KV 时可以在本地开发用 `MANIFEST_JSON`，生产环境不要把 manifest JSON 塞进源码或公开变量。

```sh
cp wrangler.toml.example wrangler.toml
npx wrangler secret put VLESS_UUID
npx wrangler secret put ADMIN_TOKEN
npx wrangler secret put SUB_TOKEN
npx wrangler deploy
```

GitHub Actions 使用 `scripts/publish_cf_manifest.py` 通过 Cloudflare API 原子替换同一 KV 键。需要仓库 Secrets：`CF_API_TOKEN`、`CF_ACCOUNT_ID`、`CF_KV_NAMESPACE_ID`。发布步骤默认关闭，手工运行时选择 `publish_cf=true` 才会写入 KV。

EdgeTunnel 仅是一个可选数据面适配器。这个 Worker 没有复制其源代码；生产订阅仍要求数据面实际完成 expected exit IP 与 actual exit IP 的全链路核验。
