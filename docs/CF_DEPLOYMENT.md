# Cloudflare v0.1 部署记录

## 2026-10-10 单 Worker 合并测试

已部署统一公开入口：[xnvgatebox Worker](https://xnvgatebox.waynee.workers.dev)。该 Worker 绑定唯一 manifest KV（`e511651b3bfc4530bc8395429f580f75`），同一脚本提供 `/health`、`/admin`、`/api/status`、`/api/manifest`、`/sub`、`/check` 和 WebSocket 数据面入口。

当前版本是**迁移兼容构建**：`/check` 和 WebSocket 数据面经过统一入口的鉴权、参数校验和固定目标校验后，转发到第一轮已部署的两个过渡服务。用户不需要再部署或访问这两个地址；下一阶段用本项目自有、许可证兼容的模块替换迁移上游，并删除 `LEGACY_CHECKER_URL` / `LEGACY_EDGE_URL` 两个变量，才算完成最终的完全自包含单 Worker。

部署版本：`5f0e6356-730d-4900-9a70-39f84e8f5925`。公网烟测结果：`/health` 返回 `configured=true` 且四个模块均就绪；`/admin` 返回 200；错误订阅 token 返回 401；带有效检查凭据的 `/check` 返回 200；无效数据面主机返回 404；标准 WebSocket 失败控制入口返回 101。管理页面只显示 `xnvgatebox`，不显示过渡服务地址。

更新：2026-10-08。当前账号的 Workers 列表中没有现成 Checker 或 EdgeTunnel；已有业务未修改。拟新增 `vpngate-checker` 与 `vpngate-edge`，通过 Pages 高级模式分别运行独立 Worker，使用 `pages.dev` 域名，不新增 DNS、KV、3x-ui 或 VPS，不选择付费升级。

## 已完成

- 两份固定上游提交的独立部署包已生成并校验源文件 SHA256；保留完整许可证、原文件与修改记录。
- Checker 新增 Bearer Token 认证和官方 SSTP 节点限制；Edge 新增强制 SSTP/globalproxy 入口与 UDP 禁用。
- 29 项入口边界检查通过，两份完整生成程序通过 JavaScript 语法检查。
- 用户确认后，已创建并部署 `vpngate-checker` 与 `vpngate-edge`，使用 Cloudflare Pages 高级模式运行 Worker。
- 当前地址：[Checker](https://vpngate-checker.pages.dev/health)、[EdgeTunnel](https://vpngate-edge.pages.dev/health)。两者健康检查返回 `configured=true`。
- Checker 未认证请求返回 401，私网目标返回 400；Edge 管理路径返回 404。认证凭证仅在对应 Cloudflare Secret 与本机忽略的 `.env` / 部署私有文件中保存，权限 600；未在本文或公开产物中记录。
- 单节点真实测试通过：`public-vpn-47.opengw.net:443` 的 expected IP 为 `219.100.37.233`；VLESS/Xray 两个 HTTPS Echo 各测两次，四次 actual IP 均相等，内容检查通过。正式批次结果继续记录在本文件末尾。

## 发布前检查与审批状态

Cloudflare 的 Hello World 创建流程当前只能先发布示例，再进入代码编辑器。自动审批拒绝了发布示例的点击：页面代码不是目标 Checker，且新公开入口需在实际发布时确认。拒绝后没有重试，也没有绕过审批。

改为已核对官方文档的 Pages 高级模式直接上传：[Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/)、[Advanced mode](https://developers.cloudflare.com/pages/functions/advanced-mode/)。两个本地上传包是 `runtime/deploy/checker/pages-upload.zip` 和 `runtime/deploy/edge/pages-upload.zip`。包内只有 `_worker.js`、全路径 Worker 路由声明、无凭证静态说明、完整 LICENSE 和来源记录；部署代码与对应 `worker.mjs` 字节一致，不包含 `.env`、订阅或已有用户项目。该方法仍运行 Cloudflare Worker，不需要创建 Cloudflare API Token。

用户已确认创建、部署和认证凭证绑定。内置浏览器创建请求返回 `Connection blocked`，项目列表确认没有创建副本。随后使用本机已有 Wrangler OAuth 登录，经 `whoami` 确认是同一个账号，使用官方 Wrangler 4.148.0 创建、设置生产 Secret、部署；未新增账号权限或 API Token。命令从高级模式目录执行，避免新版 CLI 在项目根目录将其自动识别为静态站点。两份 Worker 均由 Cloudflare 成功编译，控制台列表已显示两个项目。

提交到 Cloudflare 的新凭证只有随机 Checker Token 和 VLESS UUID，分别存为对应 Worker Secret；同值在本机忽略的 `.env` 与 Secret 上传临时文件中保存，权限 600。未上传本机其他凭证、已有配置、`.env` 或订阅文件。

## 实测中修复的问题

1. 原 Checker 隧道内 `www.iplocate.io/api/lookup` 返回 HTTP 429。首批被服务故障熔断，没有把剩余未测试节点判为掉线，也没有发布订阅。生成版本改为官方 IP-only `api.iplocate.io/json`，删除缺失隐私字段的 false 默认值。下一批 10 个候选有 9 个通过实际 SSTP/IP 基线检测。ASN、ISP 和住宅类型仍需独立画像；未配置时为 unknown。
2. 失效 SSTP 后端会在目标 HTTPS 握手阶段断开，curl 返回 35。原对照白名单未包含该连接失败，因此验收失败且未发布。现允许该传输中断作为失败对照证据；正常正向链路仍要求所有 HTTPS 请求成功、正常证书验证与精确 IP 相等。新增回归检查确保 curl 60/77 的证书错误不能使对照通过。真实失效后端的两次请求均失败，随后单节点完整正向链路通过。

## 部署后验收

1. 两个 `/health` 返回正确服务标识与 `configured=true`，不泄露凭证。
2. Checker 不带 Token 返回 401；不允许的协议/节点/路径返回拒绝。Edge 非 WebSocket 管理路径和缺少强制 SSTP 参数的请求被拒绝。
3. 取少量新鲜 VPN Gate 候选，执行实际 SSTP/PPP 检测，记录基线 expected_exit_ip。失败原因与画像服务 429/上游错误分开记录。
4. 先用 `nonexistent.invalid:443` 测实际 VLESS：两个 HTTPS 请求都必须失败，禁止产生可用订阅。
5. 实际候选通过同一发布链接、Xray 与两个独立 HTTPS Echo 两轮测试；每次 actual_exit_ip 必须等于 expected_exit_ip，再检查 HTTPS 内容。
6. 只发布通过且新鲜的证据与订阅。若没有候选通过，则记录失败，不能把可连通 Worker、TCP 端口或本地测试当成 v0.1 完成。

GitHub Actions 连接与 VPS 阶段均在真实 v0.1 验收后推进。

## 正式批次结果

2026-10-08 19:24:47～19:26:59（Asia/Shanghai），运行完整 Mode A 流水线，候选预算 10、SSTP 并发 2、Xray 并发 2，其他验证参数沿用 `config/settings.json`。结果 `status=passed`、`published=2`：8 个候选 SSTP 通过，2 个通过全部最终检查。失效后端对照两次请求均被阻断；正向测试未跳过证书验证、未修改发布链接路径。

| 节点 | expected_exit_ip | 四次 actual_exit_ip | 内容检查 | 当前类型 |
| --- | --- | --- | --- | --- |
| public-vpn-47.opengw.net:443 | 219.100.37.233 | 均为 219.100.37.233 | 通过 | unknown |
| public-vpn-158.opengw.net:443 | 219.100.37.240 | 均为 219.100.37.240 | 通过 | unknown |

正式池、报告和最终视图在 `data/`，私有订阅在 `runtime/subscription.txt`（600）。导出器从本次真实证据成功重新生成 2 条链接；公开产物已检查不含 Token / UUID。通过节点证据默认一小时有效，记录在各自 `expires_at` 中。住宅列表为空；没有取得 ASN/ISP/住宅标签，不能把这两个出口标为住宅。节点后续是否在线必须重新验证。

v0.1 的“至少一条实际订阅链路、expected=actual、无需 VPS”完成条件已达到。本次本机验活和 GitHub Actions 托管验活均已完成；公开仓库和运行链接记录在 [ROUND1.md](ROUND1.md)。

## GitHub Actions 托管验收

仓库：[hanhaoops/xnvgatebox](https://github.com/hanhaoops/xnvgatebox)。运行：[37889203045](https://github.com/hanhaoops/xnvgatebox/actions/runs/37889203045)，提交 `5cfbe55d77472bd28e9bf368c165fd4206609693`，事件 `workflow_dispatch`，结论 `success`。工作流使用四个仓库 Secrets，未打印或上传其值。

远端报告结果：50 个候选、39 个 SSTP 通过、27 个 Mode A 最终节点通过、0 个 Checker 服务错误；失效 SSTP 对照状态 `passed`，阻断请求数 2；住宅节点 0。27 条最终证据均要求 expected 与四次 actual 出口 IP 相等并通过内容检查。公开 artifact 没有发现 UUID 或 Bearer 凭证模式；私有 `runtime/subscription.txt` 没有进入 GitHub。

## 自有管理层第一轮实现（CF-1/CF-2）

`worker/control/worker.mjs` 是项目自己的 Cloudflare Worker，和可选的 `worker/edge` 数据面分开。它从 KV 的 `manifest:current` 读取 GitHub Actions 生成的 `data/cf_manifest.json`，提供 `/health`、`/admin`、`/api/status`、`/api/manifest` 和受保护的 `/sub?token=...`。manifest 只保留节点入口、expected/actual 出口 IP、画像摘要、有效期和数据面地址，不保存 VPN 用户名、密码、VLESS UUID 或任何访问 token。

工作流增加了 `publish_cf` 手工开关。选择 `serverless` 并打开该开关时，工作流通过 `scripts/publish_cf_manifest.py` 用 `CF_API_TOKEN`、`CF_ACCOUNT_ID`、`CF_KV_NAMESPACE_ID` 单次 PUT 替换 KV 键。没有这三个仓库 Secrets 时不会发布；默认的 `pool-only` 运行也不会写入 Cloudflare。Worker 的部署模板和 Secret 名称见 [`worker/control/README.md`](../worker/control/README.md)。

这一轮只完成自有控制面和订阅生成，实际 VLESS/SSTP 数据面仍需在 CF-3 绑定一个可验活的 Worker。订阅生成器只接受 manifest 中满足新鲜有效期、`expected_exit_ip == actual_exit_ip` 且官方 `*.opengw.net` 的节点；manifest 过期、为空或被篡改时 `/sub` 返回非 200。EdgeTunnel 仍然是可选适配器，不是这个控制面的运行依赖。
