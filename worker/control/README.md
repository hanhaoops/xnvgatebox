# xnvgatebox Worker route module

这里保存唯一 `xnvgatebox` Worker 的可测试路由实现。公开发布入口在 [`../xnvgatebox/`](../xnvgatebox/)；管理、订阅、检查入口和数据面 WebSocket 入口都由同一个脚本处理。它只读取 GitHub Actions 发布到 KV 的 `manifest:current`，因此不会接收任意 `proxyip`、SOCKS5 地址或未经验证的节点。

接口：

- `GET /health`：返回配置、模块状态和当前 manifest 是否可用，不返回凭证。
- `GET /admin`：手工管理页面。管理员 token 只通过 `Authorization: Bearer ...` 请求 `/api/status`。
- `GET /api/status`：管理员查看节点池和有效期。
- `GET /api/manifest`：管理员导出当前无凭证 manifest。
- `GET /sub?token=...`：返回 Base64 编码的 VLESS 订阅。token 不写入页面和 manifest。
- `GET /check?proxy=sstp://...`：统一检查入口。迁移阶段只转发到固定的过渡检查地址，并要求 `CHECKER_TOKEN`。
- `GET /?sstp=...&globalproxy=1` + WebSocket：统一数据面入口。迁移阶段只转发到固定的过渡数据面地址，并严格限制节点主机名。

Worker Secrets：

```text
VLESS_UUID       # UUID v4
ADMIN_TOKEN      # 管理接口 token
SUB_TOKEN        # 订阅 token
VPN_USERNAME     # 可选，默认 vpn
VPN_PASSWORD     # 可选，默认 vpn
PUBLIC_HOST      # 可选；订阅链接使用的唯一 Worker 主机名
DATA_PLANE_HOST  # 兼容旧配置；PUBLIC_HOST 设置后优先
DATA_PLANE_PORT  # 可选；覆盖 manifest.data_plane.port
DATA_PLANE_BASE_PATH # 可选；覆盖 manifest.data_plane.base_path
CHECKER_TOKEN    # 迁移阶段访问固定检查上游的凭据
LEGACY_CHECKER_URL # 迁移阶段固定检查上游，例如 https://.../check
LEGACY_EDGE_URL    # 迁移阶段固定数据面上游，例如 https://...
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

`LEGACY_CHECKER_URL` 和 `LEGACY_EDGE_URL` 只服务于从三服务过渡到单 Worker 的迁移测试，不是用户需要部署的额外项目。下一阶段用本项目自有、许可证兼容的检测和数据面模块替换它们，并删除两个变量；不得把它们扩展成新的必需控制面。
