# VPN Gate 家宽出口工具箱

共用一个 Pool Builder，先实现无 VPS 的 Cloudflare/VLESS 验活，再基于 fanout 实现固定 VPS Exit Slot。开发基准见 [DEVELOPMENT.md](docs/DEVELOPMENT.md)。

第一轮已经提供可执行的候选池构建、SSTP HTTP 检测适配、strict/likely 家宽分级、VLESS/WS 订阅生成、Xray 最终链路检查和 Actions 工作流。**2026-10-08 已部署两个独立 Cloudflare Worker，并通过 v0.1 真实链路验收：10 个候选中 8 个 SSTP 通过、2 个最终 VLESS 通过，失效 SSTP 后端的两次请求均失败。** 当前两个通过节点的画像为 unknown，住宅列表为空；GitHub Actions 托管运行、VPS Manager 与 WebUI 尚未验收。实测记录见 [CF_DEPLOYMENT.md](docs/CF_DEPLOYMENT.md)。

## 本机使用

Python 3.9+，核心仅使用标准库；最终验活还需要 curl 和 Xray。Linux/macOS 支持本机文件锁。

```sh
python3 scripts/toolbox.py pool
```

无需 Cloudflare、UUID 或远程节点池地址即可生成 `data/node_pool.json`、对应 SHA256 和 `data/configs/*.ovpn`。OpenVPN 配置不执行，协议状态保持 `not_tested`；本命令是后续 VPS Standalone 使用的同一个 Builder。可用 `--csv-file /absolute/path/vpngate.csv` 解析官方格式快照。国家过滤、候选预算等在 `config/settings.json` 修改。

开始 Mode A 前，部署你自己的 Checker 与兼容的 EdgeTunnel，按 [Worker 适配说明](worker/README.md) 核对接口。复制 `.env.example` 为 `.env`，设置 `CHECKER_URL`、`EDGETUNNEL_HOST`（只有域名）和 `VLESS_UUID`。可选访问控制与画像参数也在此文件；工具读取 `.env`，不执行其中任何 shell 表达式。

```sh
python3 scripts/install_xray.py
python3 scripts/toolbox.py mode-a
```

安装器使用 [固定的官方版本与 SHA256](config/xray-release.json)，支持 Linux x86_64、macOS arm64/x86_64。也可用 `--archive /absolute/path/archive.zip` 校验离线归档，不使用 latest 动态下载。

执行顺序：CSV → 真 SSTP/PPP 检测 → 出口画像 → 无效 SSTP 反向测试 → 实际 VLESS/WS 配置 → 两个独立 HTTPS Echo 各测两次 → 小体积 HTTPS 内容检查。任意出口不相等、测试服务异常、配置变化或无效 SSTP 能成功访问，都不发布该链路。Xray 临时配置权限 0600，进程、端口和文件退出时清理。

| 产物 | 含义 |
| --- | --- |
| `data/node_pool.json` | 候选与协议证据；不等于最终可消费列表 |
| `data/mode_a_validated.json` | 当前环境最终 VLESS 检查通过且带有效期的节点 |
| `data/residential.json` | 最终通过且分类为 strict 或 likely 的节点；保留两者差别 |
| `data/nodes.txt` | 最终通过节点的 SSTP 入口清单，供查看，不含 VLESS UUID |
| `data/report.json` | 反向测试、最终出口、配置摘要和失败原因，不含 UUID |
| `runtime/subscription.txt` | 通过验证的 VLESS 明文订阅，权限 0600，不提交、不上传公开 artifact |

`mode-a` 每次开始会清空旧的发布视图和订阅；异常、缺参数或零节点成功不会沿用旧订阅。返回码 0 表示成功，2 表示输入/配置/工具问题，3 表示没有通过的最终节点。证据默认 60 分钟有效；导出器拒绝过期证据。已经复制到其他客户端的链接不能由本地文件撤回，客户端应刷新订阅。

住宅类型不是可达性的前提；未知或机房出口仍可出现在最终可用列表，但不会进入住宅列表。画像 API 可用 `INTELLIGENCE_URL_TEMPLATE=https://iplocate.io/api/lookup/{ip}` 和 `INTELLIGENCE_TOKEN`，密钥使用 `X-API-Key` 头；相同 IP 默认缓存 24 小时，每次查询有预算。原 Checker 画像接口实测返回 429，新部署版本改为官方 IP-only 端点取得出口基线；省略独立画像配置时 ASN/ISP/住宅类型保持 unknown，并保留 T1 来源标签，不补 false。消费者 ASN/ISP 清单只是 likely 的辅助条件，可配置，不能单独证明住宅。

## GitHub Actions

工作流 [update.yml](.github/workflows/update.yml) 默认手动触发：

- `pool-only`：无需任何 Cloudflare Secrets，构建共享候选池。
- `serverless`：设置与 `.env.example` 同名的仓库 Secrets 后执行实际链路检查。

公开 artifact 只包括池、配置数据、验活证据和报告，不包含 `.env` 或订阅。成功后下载 `mode_a_validated.json` 等证据到 `data/`，在本机使用与 Actions 相同的 EdgeTunnel/UUID 和配置生成私有订阅：

```sh
python3 scripts/toolbox.py export-subscription
```

导出会重新比较订阅配置摘要、最终 IP 与有效期，拒绝用不同 UUID/域名/路径拼接旧验证结果。只信任你自己的证据来源；SHA256 是内容校验，不是发布者签名。本版没有自动部署 Cloudflare、提交产物、配置 GitHub Pages 或托管长期私有订阅的能力。手动验收成功后可启用工作流内的小时调度示例；调度延误需由证据有效期处理。

## 验证

```sh
python3 -m unittest discover -s tests -v
node tests/test_worker_guards.mjs
```

31 项 Python 测试覆盖入口变化、字段缺失、画像冲突、429、IP 不匹配、直出反向测试、证书错误拒绝、过期和配置变化拒绝发布、旧订阅清空、密钥不进入公共产物、锁和清理；29 项 Worker 边界检查覆盖认证、协议、目标限制及参数覆盖拒绝。安装 Xray 后额外检查真实二进制接受配置、loopback 监听与进程清理。构造测试与真实 VPN 验收分别记录；当前真实证据在 `data/report.json`、`data/mode_a_validated.json`，有效期为一小时，不能据此承诺节点持续在线。

第一轮结果与后续实测步骤见 [ROUND1.md](docs/ROUND1.md)。核心工具许可为 GPL-3.0-only；独立 EdgeTunnel 修改为 GPL-2.0-only，依赖与复用边界见 [THIRD_PARTY.md](THIRD_PARTY.md)。本版不支持未经验证的 UDP、IPv6、XHTTP。

接口来源：[VPN Gate 官方 CSV](https://www.vpngate.net/en/)、[Xray 配置文档](https://xtls.github.io/en/config/transport.html)、[ipify 官方接口](https://www.ipify.org/)、[icanhaz 官方实现](https://github.com/major/icanhaz)、[IPLocate 身份认证](https://www.iplocate.io/docs/getting-started/authentication)。
