# 第一轮开发记录

## 2026-10-08 Cloudflare 真实验收补充

已按用户授权创建并部署独立 Checker 与 EdgeTunnel，使用本机已有 Wrangler OAuth 登录，未新建 API Token，未修改已有业务。部署详情与实测中修复的问题见 [CF_DEPLOYMENT.md](CF_DEPLOYMENT.md)。

完整 Mode A 命令实测返回 `status=passed, published=2`：10 个新鲜候选，8 个 SSTP 通过，2 个 VLESS/WS 最终链路通过；每个通过节点的两个 HTTPS Echo 各测两次，四次 actual IP 都等于自己的 expected IP，HTTPS 内容检查通过。无效 SSTP 后端的两次请求均失败，未回退直出。对应出口为 `219.100.37.233`、`219.100.37.240`。其他节点的超时或链路失败如实记录，没有发布。

正式产物已放入 `data/node_pool.json`、`data/report.json`、`data/mode_a_validated.json`，私有订阅为 `runtime/subscription.txt`，权限 600。复制的 OpenVPN 配置按摘要再次核对，仍未执行；本次不是 OpenVPN 或 VPS 验收。导出 CLI 从真实证据重新生成两条订阅，并验证公开产物不含 Checker Token / VLESS UUID。

原 Checker `/api/lookup` 实测 429，生成版本改为官方免费 IP-only `/json` 取得隧道基线；独立画像 API 未配置，因此 ASN、ISP、住宅类别保持 unknown，`data/residential.json` 为空，不把这次网络验收称为家宽筛选验收。T1 内层 TLS 身份认证技术债仍存在。

31 项 Python 测试与 29 项 Worker 边界检查通过。v0.1 的本机真实订阅链路完成条件已达到；同一流程已经接入公开仓库并完成托管验收，再进入需要真实 Linux VPS 的 v0.2。下文为首次离线实现记录，原先“尚未真实验收”的状态已由本节更新。

## 2026-10-09 GitHub Actions 托管验收

公开仓库为 [hanhaoops/xnvgatebox](https://github.com/hanhaoops/xnvgatebox)。已配置四个 Actions Secrets：`CHECKER_URL`、`CHECKER_TOKEN`、`EDGETUNNEL_HOST`、`VLESS_UUID`；值未进入代码或 artifact。`Test` 工作流在首个提交上通过。

`serverless` 工作流运行 [37889203045](https://github.com/hanhaoops/xnvgatebox/actions/runs/37889203045) 成功：50 个候选、39 个 SSTP 通过、27 个最终 VLESS 节点发布，失效后端对照两次请求被阻断。27 个节点均满足各自 expected_exit_ip 与四次 actual_exit_ip 相等及 HTTPS 内容检查；本次画像未配置，`residential.json` 仍为空。公开 artifact 只含池、OpenVPN 配置、证据与报告，凭证扫描通过；没有上传私有订阅。

证据只代表本次 Actions runner 的一小时有效期。后续若启用定时刷新，需先确定 Actions 用量、artifact 留存策略以及如何在本机重新导出与分发私有订阅；不能把公开 artifact 当作长期订阅地址。

日期：2026 年 10 月 8 日。范围：v0.1 的可执行工具与工作流，尚未完成真实端到端里程碑验收。

## 已实现

- 同一个 Pool Builder：在线官方 CSV 或本地快照 → 去重/规范化 → `node_pool.json`、SHA256 与配置文件。节点 ID 不随入口 IP 改变，新抓取结果不继承旧出口验证；OpenVPN 不执行、不自动标可用。
- 原创 Checker HTTP 适配器：真实 SSTP 检测结果、入口与公网 IPv4 校验；服务故障/429 与节点拒绝分开，批次停止继续打异常服务。
- 同一个 classifier / intelligence adapter：保留原始数据和三态字段，strict/likely/unknown 分级、画像冲突处理、可选独立 HTTPS 画像、缓存和查询预算。
- 实际 VLESS/WS 配置生成：审计版本的 SSTP 全局参数，发布链接重新解析后作为最终测试输入；配置摘要不一致不导出。
- Xray/curl 最终检测：无效 SSTP 反向测试、两个 HTTPS Echo 两轮复验、小内容检查、合法 IPv4 与 expected==actual。curl 保持正常证书验证，走 `socks5h`，隔离 curlrc 与代理环境变量，生成的 Xray 配置不包含 direct 出站。
- 私有订阅权限 0600；异常或过期不重新发布旧订阅；进程、临时配置和 listener 清理；CLI 文件锁。
- Actions 手动构建/验活和测试工作流；官方 Action 固定提交；Xray 固定 v26.3.27 与归档 SHA256；公开 artifact 不包含 UUID/订阅。本机可从新鲜证据还原同配置订阅。

代码入口和运行方式见 [README.md](../README.md)。本轮没有复制未明确许可项目的源码，也未混合 Checker/EdgeTunnel Worker；项目代码采用 GPL-3.0-only，清单见 [THIRD_PARTY.md](../THIRD_PARTY.md)。

## 验证证据

| 检查 | 当前结论 |
| --- | --- |
| 官方 HTTPS CSV → Pool Builder | 实际运行成功，按预算生成 50 个候选；SSTP/OpenVPN 状态仍为 not_tested |
| 官方固定版本 Xray | 归档 SHA256 校验通过；真实二进制接受生成配置，loopback 监听与退出清理通过 |
| 行为测试 | 30 项全部通过；`python3 -m unittest discover -s tests -v` 包含构造响应下完整编排与拒绝发布场景，真实进程测试需允许 loopback 监听 |
| Python 语法 / YAML 结构 | 编译检查通过，两个工作流可解析；尚未在 GitHub Runner 实际执行 |
| 真实 SSTP → Cloudflare → VLESS | 待配置部署参数，未通过验收；无真实出口 IP 被记录为最终验证成功 |

测试里的出口、画像和成功响应均为明确的构造数据，不进入真实输出目录。真实抓取的 `data/` 和二进制 `tools/bin/` 为忽略提交的运行产物。原 Checker 内层 TLS 身份认证技术债 T1 仍存在，双 Echo 不等于修复。

## 下一步真实验收

1. 在本机 `.env` 或 Actions Secrets 填写自己的 Checker URL、EdgeTunnel 域名、VLESS UUID；按 [Worker 适配](../worker/README.md) 核对已部署版本。
2. 本机运行 `python3 scripts/toolbox.py mode-a`，至少一条实际链路通过两轮 Echo 与内容检查，同时无效 SSTP 请求失败。
3. 检查 `data/report.json` 的 expected/actual 与 `data/mode_a_validated.json`，使用生成的私有订阅再次观察同一出口。零通过不得称为 v0.1 完成。
4. 本机通过后，手动运行 Actions 的 serverless Profile；确认同样通过、artifact 无 UUID，再按需要启用小时调度或托管共享候选池。

进入 v0.2 后优先在真实 Linux VPS 复用 fanout 跑通一个 Standalone Slot，仍调用同一 Pool Builder 和 classifier；此轮没有提前实现 VPS Manager、WebUI、签名服务或 3x-ui API。
