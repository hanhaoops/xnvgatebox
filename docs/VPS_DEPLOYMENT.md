# VPS Multi-Exit v0.2 验收记录

日期：2026-10-09

这份记录描述第一台 Linux VPS 上的单 Slot 实测结果。它与无 VPS 的
Cloudflare/Worker 模式共用同一个 `node_pool.json` 和 `configs/*.ovpn`，没有再
建立第二套 VPN Gate 抓取或分类程序。

## 环境与部署

- VPS：Debian 12，x86_64，1 vCPU，约 1 GB RAM，公网地址为 `23.165.200.6`。
- VPN 管理器：`vps/fanout/`，基于 `byJoey/fanout` 的 MIT 许可提交，具体提交和
  保留的上游声明见 [`vps/fanout/UPSTREAM.md`](../vps/fanout/UPSTREAM.md)。
- 节点池：GitHub Actions 运行 `37889203045` 生成的共享池，部署到 VPS 后由
  `FANOUT_VALIDATED_POOL_FILE` 读取。
- 隧道：Linux network namespace `fo67c61`，OpenVPN 进程和默认路由只存在于该
  namespace；母机的默认路由不被修改。
- 固定出口：`127.0.0.1:17928`。管理接口绑定 `127.0.0.1:8899`，不会直接暴露
  到公网。
- 3x-ui：已检测到现有 `x-ui.service`。本轮只验证 SOCKS 出口，不修改现有
  3x-ui 数据库、入站或公网监听；标准 Xray outbound 导出仍按 v0.4 计划进行。

由于这台 VPS 只有 1 vCPU 和约 1 GB RAM，本轮只启动一个 Slot。多 Slot 不能从
这次结果推断，后续至少需要更充足的 VPS 资源并分别验证每个 namespace、端口和
出口。

## 实测结果

Slot 使用 JP 策略进行技术验活。当前节点可以被替换，Slot 身份保持不变：

```text
slot:       slot-01（技术验收）
SOCKS:      127.0.0.1:17928
namespace:  fo67c61
```

每次验活同时请求两个独立 HTTPS IP 服务。最近一次恢复后的结果为：

```text
expected: 219.67.64.254, 219.67.64.254
actual:   219.67.64.254, 219.67.64.254
VPS:      23.165.200.6
```

因此 SOCKS 实际出口与该 OpenVPN 节点的预期出口一致，并且不等于 VPS 母机公网
地址。节点切换后重新测得相同关系，固定端口仍为 `17928`。

随后强制终止后台 OpenVPN 进程：

1. `127.0.0.1:17928` 的 SOCKS 请求立即失败；
2. 母机仍只能看到自己的公网出口，没有通过母机 NAT 伪装成健康 Slot；
3. 健康监控自动选择新节点并恢复隧道；
4. 恢复后端口仍为 `127.0.0.1:17928`，再次满足 `expected == actual`。

这验证了固定 Slot/端口与后台节点解耦、namespace 路由隔离、掉线失败关闭和
自动换节点的第一条完整链路。当前实现还将 VPN remote endpoint 加入限定的
forward/namespace 防火墙规则，并关闭 namespace IPv6，避免 VPN 断开后经母机
NAT 形成假在线。

## 分类边界

本次共享池没有配置可用的 IP intelligence 提供商，节点的 ASN、ISP 和
`ip_type` 保持 `unknown`。VPS 使用 `FANOUT_RESIDENTIAL_ONLY=0` 只是为了完成
隧道、固定端口、出口一致性和 kill-switch 的技术验收；它不把未知节点宣称为
住宅节点，也不构成 Comcast、NTT 等 ISP 画像证明。

配置真实画像提供商后，应让共享 Pool Builder 重新生成并验证节点池，再将
`FANOUT_RESIDENTIAL_ONLY` 恢复为 `1`，按 Slot 的国家、类型、ISP 和延迟策略选
择节点。无合规候选时 Slot 应保持 waiting/blocked，而不是放宽策略或回退到 VPS
公网出口。

## 下一步

当前可继续做的是：

1. 为共享 Pool Builder 配置合法的 IP intelligence API，并重新跑完整链路；
2. 增加 Xray JSON exporter 的实际输出验收，再由用户手动粘贴到 3x-ui；
3. 使用资源更充足的 VPS，分别验收 US/JP/KR 多 Slot 和 WebUI。

安装与环境变量说明见 [`vps/README.md`](../vps/README.md)。
