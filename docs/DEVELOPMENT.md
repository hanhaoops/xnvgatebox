# xnvgatebox 出口节点与订阅系统分阶段开发文档

修订日期：2026 年 10 月 9 日。范围：v0.1～v1.0；实现进度见 [ROUND1.md](ROUND1.md)。

开发基准：用户确认的 `DEVELOPMENT_revised.md`。后续实现按本文的运行模式、统一部署入口、阶段顺序与验收条件执行。

## 0 产品命名与一次部署原则

- 对外产品名、管理界面标题、订阅页面和安装文档统一使用 **xnvgatebox**。仓库为 [`hanhaoops/xnvgatebox`](https://github.com/hanhaoops/xnvgatebox)。
- “出口节点”“出口槽位”“订阅”“管理面”是用户界面和操作文档的默认术语。来源站点、协议名、上游仓库名和代码兼容字段中的 `VPN`/`SSTP`/`OpenVPN` 可以在必要的技术上下文中保留，但不作为产品品牌或用户必须理解的概念。
- 用户只执行一次统一安装/部署流程，选择 `serverless`、`vps` 或 `hybrid` 运行模式；不得要求用户分别创建 Checker、Edge、Control 等多个项目，也不得要求重复上传多个 Worker。
- 部署包内部可以保留检测、数据面、管理和订阅模块的隔离。隔离是实现边界，不是用户的部署步骤；对外暴露一个管理入口、一个订阅入口和一套配置向导。
- 当前已存在的 `vpngate-checker`、`vpngate-edge` 和 `vpngate-control` 是第一轮验证用的过渡部署。下一轮将把它们收敛为一个 xnvgatebox 部署单元（单一部署命令、单一配置文件、单一状态页），内部是否使用 Worker 路由、Service Binding 或 Pages Functions 由实现决定。
- VPS 模式同样只提供一个安装入口；Multi-Exit、namespace、固定 SOCKS 端口和 Xray 导出由同一安装流程配置。3x-ui 是可选消费端，不是额外的部署项目。

项目先完成三个可运行、可演示的闭环：**无 VPS 的 VLESS 节点、VPS 上多个固定出口、可直接粘贴的 3x-ui/Xray 配置**。核心产品是 Exit Slot：后台 VPN Gate 节点可以更换，`slot_id + SOCKS port + outbound tag` 保持不变。

项目提供三种**运行模式**：**Serverless / No VPS、VPS Standalone、Hybrid**。它们是同一部署包的配置档，不是三套需要分别安装的项目。所谓“统一节点池”首先是统一的数据模型、抓取器、分类器和验证语义，**不等于必须依赖一个中心化 GitHub 远程池**。Mode A 默认由 GitHub Actions 构建池并供 Cloudflare 使用；Mode B 既可以消费远程池，也可以在 VPS 本机运行同一套 Pool Builder 生成本地池，从而做到只用一台 VPS 也能独立工作。Hybrid 则使用远程池做初筛、VPS 本机完成最终 OpenVPN/Slot 验活。

统一池保存节点事实、协议能力、出口画像和验证证据；不同运行环境自行完成最终链路验证。Mode B 不要求先在 GitHub Actions 完成一次 B Full Chain，再到目标 VPS 重测。Cloudflare 的核心管理和订阅能力由本项目自己的 Worker/Pages 适配层提供；EdgeTunnel 只保留为可选的外部兼容接口，不成为核心运行依赖。参考项目的源码与许可证结论保留在 [REFERENCE_AUDIT.md](REFERENCE_AUDIT.md)。以下为拟实现方案，不代表链路已实测成功。

## 1 开发顺序与三个里程碑

| 版本 | 实现范围 | 完成条件 |
| --- | --- | --- |
| v0.1 / 里程碑一 | VPN Gate → SSTP → Cloudflare → VLESS | 至少一条最终订阅链路实测通过，actual_exit_ip 等于 expected_exit_ip，无需 VPS |
| v0.2 | Linux VPS → OpenVPN → netns → 固定 SOCKS5 | 一个 Slot 实测通过；强杀 VPN 后不从母机出网 |
| v0.3 / 里程碑二 | 三个可配置地区的 Slot 同时运行 | :17928、:17929、:17930 对应三个独立出口；演示可优先 US/JP/KR，但地区必须可配置，国家与分类如实展示 |
| v0.4 / 里程碑三 | Xray / 3x-ui 一键配置生成 | 输入真实 inbound tag，直接复制 outbound、routing 或配置片段；每入站实测绑定一个 Slot |
| v0.5 | 自动换 IP 与故障迁移 | 同策略选替代节点，端口/tag 不变，新出口重新核验 |
| v0.6 | WebUI 与节点画像 | Validated Nodes、Exit Slots 两区，生命周期操作、ISP/ASN/分类展示及复制按钮 |
| v1.0 | 完整安全加固与可选自动接管 | 强化 kill switch、权限隔离、签名分发、恢复能力；按需要增加 3x-ui API |

每个版本先验收真实链路，再进入下一版本。v0.1、v0.3～v0.4 成功后即可分别演示无 VPS 与 VPS 多出口；不预设开发天数。v0.3 的 US/JP/KR 只是默认演示组合，不写死在代码里；若当时某地区没有符合策略的节点，可改用其他地区完成“三个独立出口”的功能验收，同时在视频/状态页如实说明。不以错误国家或机房节点补齐“家宽演示”。

## 2 统一节点池与验证职责

```text
VPN Gate → 唯一抓取器 → 配置解析 / 去重 / 基础检查
                           ↓
                    node_pool.json
          节点事实 / SSTP与OpenVPN能力 / 按协议的出口画像
          检测来源、时间、状态与失败原因
                   ↙                    ↘
Mode A：SSTP检测 → Cloudflare/VLESS最终验活 → 发布订阅
Mode B：VPS选择候选 → 本机OpenVPN/SOCKS最终验活 → Slot healthy
                                         ↓
                                  v0.4：Xray绑定验活
```

- 全项目只有一套抓取、规范化、画像、分类与出口比较逻辑。`Pool Builder` 是可复用模块：可在 GitHub Actions 运行，也可在 VPS 本机运行；**禁止为了 VPS Standalone 再写第二套 VPN Gate 抓取器或第二套分类器**。
- Serverless 默认由 Actions 发布共享池；VPS Standalone 默认在本机生成同结构 `node_pool.json`；Hybrid 可下载远程池做初筛。三者 schema 与核心逻辑一致。VPS 的运行结果写 `slot_health.json`，它是运行证据，不是另一套节点事实模型。
- 池里的协议状态为 `not_tested / passed / failed / stale`。配置存在只表示发现该入口，不能把 OpenVPN available 自动置为 true；未在 runner 检测 OpenVPN 的候选仍可由 VPS 选择并实测。
- `node_pool.json` 是候选与证据池，不因为文件名暗示“所有模式都已验证”。Mode A 发布列表与 Mode B healthy 列表各自检查本环境证据，不靠一个全局 `full_chain_verified` 布尔值准入；需要展示“已验证节点”时由当前 profile 派生视图生成。
- SSTP 与 OpenVPN 可能有不同公网出口。国家、ASN、ISP、IP 类型、延迟和 expected IP 按协议保存；SSTP 画像不能直接充当 OpenVPN 画像。
- Actions 默认只做抓取、SSTP检测及 Mode A 验活，**不安装 OpenVPN、不要求 B Full Chain**。可选基础 OpenVPN 检测以后按需要加入，不作为 Mode B 前置条件。

远程池模式在 v0.x 使用用户自己配置的 HTTPS 地址和 SHA256 核对下载内容，OpenVPN 配置按摘要绑定；VPS Standalone 不要求配置远程池地址。SHA256 用于内容完整性，不代替发布者签名；公开多人消费池的签名机制放到 v1.0。先采用 JSON 临时文件写完后替换，不做不可变版本目录、签名 manifest 或复杂 latest 协议。


### 2.1 一个部署包、三种运行模式

统一部署入口读取一个配置文件，再选择运行模式。用户不需要分别部署表格中的组件。

| Profile | 部署入口 | 节点池来源 | 最终验活位置 | 适用目标 |
| --- | --- | --- | --- | --- |
| Serverless / No VPS | 一次部署 xnvgatebox Cloudflare 单元 | Actions 运行 Pool Builder | Actions + Cloudflare/VLESS | 完全不需要 VPS 的订阅方案 |
| VPS Standalone | 一次安装 xnvgatebox VPS 单元 | **同一 Pool Builder 在 VPS 本机运行** | VPS 本机 OpenVPN/SOCKS/Xray | 一台 VPS 多地区、多 Slot 出口 |
| Hybrid | 一次部署后启用两端配置 | 远程池初筛 + 本机补测 | VPS 本机 | 减少 VPS 抓取/分类成本，同时保留本机真实性 |

三个 Profile 共用 `models / source parser / classifier / selection policy / exit comparison`。统一的含义是“逻辑、配置和数据契约统一”，不是强制所有运行模式连接同一个中心服务。任何 Profile 都不得因为远程池不可用而偷偷切换为另一套未经验证的来源；VPS Standalone 应显式配置为本地 Pool Builder。模式切换只改配置，不重新部署一套程序。

## 2.2 统一 Cloudflare 管理层、数据面与订阅接口

Mode A 的正式链路由一个 xnvgatebox 部署单元承载：GitHub Actions 生成并验证节点池；Cloudflare 存储当前版本的短期 manifest；部署单元内部提供管理页、状态页、订阅接口和数据面入口。检测、数据面、管理和订阅可以在代码上保持模块隔离，但用户只配置一次。GitHub Actions 不承载用户代理流量，Cloudflare 也不能把未验证的 GitHub IP/端口直接当成出口。

```text
GitHub Actions
  → validated_nodes.json（带版本、生成时间、expires_at）
  → Cloudflare KV / 受保护发布 API
  → xnvgatebox Cloudflare 单元
       /admin   管理与状态
       /sub     带 token 的 VLESS 订阅
       /        只接受受控的节点参数
```

Worker 的 VLESS 链接必须由当前 manifest 派生，不能接受任意 `proxyip`、任意 SOCKS5 地址或任意目标主机。只允许 manifest 中仍然有效的 VPN Gate 节点，并在发布前后保留 `expected_exit_ip == actual_exit_ip` 证据。管理接口使用单独的管理员口令或 Cloudflare Access；订阅 token 只能读取当前有效版本，manifest 过期或为空时返回非 200，避免客户端被空订阅清空。

EdgeTunnel 适配器只输出兼容的节点/订阅格式或调用导入接口，不把它的 Worker 源码复制到本项目，也不增加用户的部署步骤。若未来启用该适配器，许可证、来源和运行边界仍单独记录；它不是 xnvgatebox 的主链路依赖。

Cloudflare 里程碑重新定义为：

| 阶段 | 工作 | 验收 |
| --- | --- | --- |
| CF-1 | manifest schema、版本/过期和原子发布 | **已实现**：`data/cf_manifest.json` 只包含完整验证节点，脚本单次 PUT 到 `manifest:current` |
| CF-2 | 自有 Worker 管理页、`/api/status`、受保护 `/sub` | **已实现源码**：`worker/control` 提供 `/admin`、`/api/status`、`/sub`；订阅不含凭证 |
| CF-3 | Worker VLESS/SSTP 入口接入 manifest | 每条发布链接重新验证 expected/actual，失效节点不再发布 |
| CF-4 | GitHub Actions 定时刷新与回滚 | 30/60 分钟刷新，发布失败保留上一份未过期版本并报警 |
| CF-5 | 可选兼容导入适配 | 外部适配器只作为格式消费者，不成为主链路依赖，也不增加部署步骤 |

## 3 最小 Node 与 Exit Slot 模型

Node 记录实际节点，ID 不根据 Exit IP 或排名生成。hostname 的入口 IP、端口、配置变动时更新记录、清除相关旧证据。下面为结构示例，文档地址不是实际可用节点：

```json
{
  "node_id": "vpngate-us-001", "hostname": "vpn-example.opengw.net",
  "server_ip": "192.0.2.10", "advertised_country": "US",
  "protocols": {
    "sstp": {
      "port": 443, "status": "passed", "expected_exit_ip": "198.51.100.20",
      "egress": {"country": "US", "asn": "AS7922", "isp": "Comcast", "ip_type": "likely_residential"},
      "observed_by": "checker-worker", "verified_at": "2026-10-07T13:00:00Z"
    },
    "openvpn": {
      "profile_ref": "configs/example.ovpn", "profile_sha256": "example-digest",
      "status": "not_tested", "expected_exit_ip": null, "egress": null
    }
  }
}
```

Exit Slot 保存稳定入口、选择策略及当前本机结果：

```json
{
  "slot_id": "us-01", "target_country": "US",
  "allowed_ip_types": ["strict_residential", "likely_residential"],
  "preferred_isp": ["Comcast", "Spectrum", "AT&T"], "blocked_isp": [],
  "allowed_isp": [], "maximum_latency_ms": 1500,
  "current_node_id": "vpngate-us-001", "namespace": "vg-us-01", "tun_device": "tun120",
  "socks_host": "127.0.0.1", "socks_port": 17928, "xray_outbound_tag": "res-us-01",
  "expected_exit_ip": "198.51.100.20", "actual_exit_ip": "198.51.100.20",
  "status": "healthy", "last_switch_at": "2026-10-07T13:03:00Z"
}
```

Slot ID、端口、tag 创建后写入本地 JSON，换节点、重启或修改国家均不重新计算。端口冲突报错，不随机换端口；停止保留 Slot 与端口预留，删除不重排其他 Slot。v0.x 用文件锁、单 Slot 串行操作和简单状态 `stopped / connecting / healthy / blocked / waiting_for_nodes`，暂不引入 SQLite、完整状态机框架或独立 agent。

## 4 家宽分类分级

分类以实际公网出口为对象，保留原始 API 数据、provider、查询时间、理由和置信度。用户界面明确区分“数据库住宅”与“疑似家宽”，不会为了数量把 unknown 标成住宅。

| ip_type | 用户展示 | 判断条件 |
| --- | --- | --- |
| strict_residential | Strict Residential / 数据库明确识别住宅 | API 针对该 IP 明确住宅，必要字段完整，且没有 hosting/mobile/business 冲突 |
| likely_residential | Likely Residential / Consumer ISP / 疑似家宽 | hosting 明确为 false，网络明确为 ISP，ASN/ISP 命中消费者宽带辅助清单，没有机房、移动或企业网络证据冲突 |
| mobile | Mobile | 明确移动网络证据 |
| datacenter | Datacenter | 明确 hosting/datacenter 证据 |
| business_isp | Business / ISP | 明确企业网络，或只有 ISP 属性而不足以判断家宽 |
| unknown | Unknown | 关键判断字段缺失、查询失败或冲突无法解决 |

例如 Comcast / AS7922 + hosting=false + network=ISP + 无冲突，可以标 likely_residential；仅 ISP 名称、仅 hosting=false 或仅主机名均不够。住宅正面字段没有提供时允许走 likely 判断；hosting 等 likely 所需字段缺失则不能补 false。proxy/vpn/abuse 缺失保留 null，分别展示。

Slot 默认可显式允许 strict 与 likely，两者分别计数和展示；只接受数据库住宅时配置 `allowed_ip_types=["strict_residential"]`。旧 `residential` 兼容值只映射到 strict。原始画像与规则版本保存，方便以后调整，不增加新的自建 IP 情报服务。

## 5 v0.1 无 VPS 最小闭环

沿用三个参考项目的职责分工：gate 的抓取组织思路、CheckSocks5 的实际 SSTP检测、CF-vpngate 的 Xray 最终测试思路。优先使用本项目自有的 Checker/Edge Worker 适配层；EdgeTunnel 只通过独立接口兼容，不作为必须部署的 Gateway，也不先复制其 Worker 源码。

1. 唯一抓取器解析 VPN Gate CSV、OpenVPN配置，生成 SSTP候选；TCP入口只是候选，需要真握手。
2. Checker 完成 SSTP → PPP → IPCP → 隧道内 TCP/HTTP，记录预期公网出口；PPP内部地址、server_ip 不能当出口。
3. 按该 IP 获取 ASN/ISP/国家与分类，加入共享池的协议证据。
4. 生成实际要发布的 VLESS/WS 配置，强制经过本项目 Edge Worker 的 SSTP 适配；可选 EdgeTunnel 只消费兼容格式，不把 `global=1` 当通用标准。
5. Actions 启动临时 Xray SOCKS 入站，通过 `socks5h` 请求两个独立 HTTPS IP Echo，校验证书与合法 IP；两者都必须等于 expected_exit_ip。再校验一个小体积 HTTPS 内容请求。
6. 检测用的就是发布用的配置，不只在测试时添加全局代理参数；出口不同、握手失败或响应异常就不发布。
7. 输出基础 `node_pool.json`、Mode A 通过最终链路的 `mode_a_validated.json`、`residential.json`（保留 strict/likely 等级）、`nodes.txt`、受保护的 `subscription.txt` 和简短检测报告；无需 WebUI 即可演示。`node_pool.json` 不能与“已通过最终 VLESS 验活”的列表混为一谈。

v0.1 必测：使用无效 SSTP入口访问 Worker 可直接访问的网站，应失败；最终订阅重复验证成功；清理 Xray 临时进程；没有把 Cloudflare直出当成VPN成功。MVP先支持 TCP/IPv4/WS，拒绝未验证的 UDP/IPv6/XHTTP，不另走原生DNS/UDP出口。

**技术债 T1：Checker 用户态 TLS 身份认证不完整。** v0.1 可使用现有检测结果作为标明来源的初步 expected，但最终 curl 必须保持正常 HTTPS 证书验证，并经两个独立端点交叉核验。双端点和 IP相等不能修复原 TLS实现的身份认证缺陷；报告区分“链路实测通过”和“基线来源待加固”。修复 TLS身份校验放入 v1.0，自建签名 Echo 仅作以后可选方案，不阻挡 MVP，也不把该基线称为已完成独立安全认证。原始画像不盲信 Checker 默认补 false 的字段。

## 6 v0.2～v0.3 VPS 固定多出口

Multi-Exit 使用 host SOCKS → 对应 netns → OpenVPN → VPN Gate 路线。实现借鉴过 MIT 许可的外部参考项目，但产品代码以 VPN Gate 的统一节点池、Slot 模型和本项目的安全验收为准，不建立第二套抓取器。第一阶段只改节点来源接口，使其既能读取远程池，也能读取 VPS Standalone 本机 Pool Builder 的结果；监听改为 loopback，端口与 tag 由 Slot 固定配置。保留并验证 namespace 线程恢复、健康检查和母机保护；只有现有实现无法满足“断线绝不回落母机”时再做最小补丁，不提前引入 Unix IPC、namespace agent、cgroup 或复杂 root-helper。

```text
Xray → 127.0.0.1:17928 → host SOCKS → vg-us-01 / tun120 → VPN Gate US
Xray → 127.0.0.1:17929 → host SOCKS → vg-jp-01 / tun121 → VPN Gate JP
Xray → 127.0.0.1:17930 → host SOCKS → vg-kr-01 / tun122 → VPN Gate KR
```

### 本机验证与 expected 的来源

1. VPS 从 `node_pool.json` 选候选；该池可以来自远程共享池，也可以由 VPS Standalone 在本机使用同一 Pool Builder 生成。随后检查配置摘要、清理不允许的脚本/plugin/include，建立独立 netns，再运行 OpenVPN；母机默认路由不变。
2. 在该 namespace 内，绑定 tun 对两个 HTTPS IP Echo 发出基线请求。合法公网 IP 一致且不同于 VPS 公网 IP 后，得到该协议本机 expected；随后调用**同一套 classifier / intelligence adapter** 对这个 OpenVPN 出口做国家、ASN、ISP、IP 类型画像，再判断是否符合 Slot 策略。池里没有 OpenVPN 出口证据也可用此过程补测；如果 VPS 未配置画像 API，则类型必须保持 unknown，不能沿用 SSTP 的住宅标签。
3. 再通过固定 SOCKS端口发独立 HTTPS请求取得 actual，要求两个端点都与 expected 完全相等，才标 healthy。不能把同一次 SOCKS查询结果同时赋给 expected 和 actual。
4. 若池有新鲜 OpenVPN基线，先比较；变化时标明旧证据失效，重新完成上述隧道基线、画像和端口验证，保存本机证据。不能在健康检查中遇到不匹配就静默改 expected。
5. v0.4 加入实际 Xray outbound/入站验活。v0.2 的 SOCKS成功不提前宣称已完成 3x-ui链路测试；不要求 runner 预验 B。

### 从 v0.2 开始保留的最小阻断

“VPN断线不能回落到VPS公网IP”必须从第一个 SOCKS Slot 起成立，不能把所有 kill switch 工作推迟到 v1.0：

- namespace业务默认路由仅经 tun，外层VPN server使用经veth的明确路由；veth/NAT仅允许该VPN endpoint，不提供任意Internet默认回退。
- 所有 SOCKS出站socket在对应netns创建并绑定指定tun；绑定失败立即报错，禁止重试为未绑定socket。域名解析的socket同样绑定tun，不回退母机resolver。IPv6与UDP ASSOCIATE暂不支持。
- 最小防火墙先装后连：限制veth出口、阻断IPv6；不使用会绕过业务禁止规则的通用 established 放行。无需先实现UID/cgroup权限体系，tun绑定与规则一起防止普通代理利用VPN endpoint例外直出。
- 检测未完成、VPN退出、tun消失或出口不匹配时拒绝新业务并关闭旧连接；探测走本地受控测试路径。不要等下一轮健康检查才阻止已知断线。
- 真机强杀OpenVPN、删tun、撤路由并保留veth/NAT，检查固定SOCKS请求失败和母机抓包无业务直出。仅健康IP比较通过不能替代此验收。

v0.3 同时运行三个 Slot，分别核验国家、IP、画像和端口，检查出口互不串流且 IP 不同。地区由配置决定，默认演示可使用 US/JP/KR；如果某地区暂时没有符合策略的节点，可以改用其他国家完成三个独立 Slot 的功能验收，但必须如实展示实际国家/类型。没有符合策略的节点就显示 waiting_for_nodes；不得自动放宽住宅、国家或 ISP 规则。完整权限分离、广泛故障恢复和强化防火墙仍留到 v1.0。

## 7 v0.4 一键生成可粘贴的 Xray 配置

先提供 CLI 导出，v0.6 增加按钮。用户只需选择 Slot 并填写 3x-ui 真实 inbound tag；工具生成格式完整的 outbound 对象、routing 规则及批量片段，不要求用户手写 JSON 字段。**这里“3x-ui 可直接使用”的 v0.4 定义，就是生成与当前 Slot/真实 inbound tag 完全匹配、可以直接复制粘贴的配置，并提供明确粘贴位置；不是要求用户自行理解后重写 JSON。** 自动调用 3x-ui API 修改面板属于后续能力。

例如 US Slot 的标准批量片段；复制单项时分别输出对应 outbound 对象与 routing 规则：

```json
{
  "outbounds": [
    {"tag": "res-us-01", "protocol": "socks", "settings": {"servers": [{"address": "127.0.0.1", "port": 17928}]}},
    {"tag": "vpngate-block", "protocol": "blackhole", "settings": {}}
  ],
  "routing": {"rules": [
    {"type": "field", "inboundTag": ["inbound-us"], "network": "udp", "outboundTag": "vpngate-block"},
    {"type": "field", "inboundTag": ["inbound-us"], "network": "tcp", "outboundTag": "res-us-01"}
  ]}
}
```

工具根据输入的真实 tag 替换 inbound-us，同时生成受管入站的 UDP blackhole 规则和对应 outbound，排在 TCP 映射之前。批量导出使用标准 `outbounds` 与 `routing.rules`，没有自定义包装字段。

CLI输出“复制 outbound / 复制 routing / 导出全部”对应内容；WebUI沿用相同exporter。校验重复tag、端口、悬空引用和规则顺序，用固定Xray版本检查配置，再经测试入站观测出口。Slot不健康或停止仍保留映射到原端口，不能删规则后落到默认direct。删除Slot须导出原绑定的显式block处理。

不写3x-ui数据库，不在v0.x自动接管面板；“应用到3x-ui”按钮到API功能实际实现后才启用。

## 8 v0.5 自动换 IP 与 Slot 策略

故障顺序：暂停业务 → 清理旧连接/隧道 → 从统一池选择符合策略的新Node → 本机OpenVPN基线与画像 → 固定SOCKS actual核验 → 恢复healthy。Comcast A换成Spectrum B后，`us-01 / 17928 / res-us-01`不变；切换会中断旧TCP连接，暂不做无缝热切换。

策略最少包含country、allowed_ip_types、preferred/allowed/blocked ISP、ASN允许/阻止列表和maximum latency。国家/类型/黑名单/allowed是硬限制，preferred只是排序；想“只用三家ISP”需配置allowed。手动指定Node也需遵守硬策略，缺字段则不能宣称满足该项。

国家与类型最终使用本机OpenVPN出口画像，来源国家和SSTP画像只用于初筛。maximum latency用本机SOCKS/Xray请求测量，不能把来源ping当本机延迟。禁止健康检查自动执行expected=actual；新IP只能通过明确重新建连、基线和分类过程接受。

每Slot操作加锁、取消已停止的任务，先重连旧节点或按策略替换，失败候选短暂冷却并退避。没有候选保持blocked/waiting；不改变国家/类型、不扩大ISP范围、不随机改端口。重启只恢复固定配置，必须重新验证后才healthy。

## 9 v0.6 WebUI

Validated Nodes：Country、按协议的Exit IP、ASN、ISP、strict/likely等类型、Latency、SSTP/OpenVPN状态、对应环境Full Chain、Last Verified。支持查看理由、添加到Slot；未测/过期证据不显示绿灯。

Exit Slots：Name、目标国家、Current/Expected Exit IP、ASN、ISP、SOCKS Port、Tunnel、Health、Last Switch。支持启动、停止、换IP、指定节点、修改国家/ISP策略、删除及配置复制/导出。

界面体验：创建US出口 → 显示127.0.0.1:17928和实际画像 → 复制Xray outbound → 复制routing。HTTP管理接口随WebUI提供必要登录与访问限制；远程自动3x-ui API集成以后再做。Mode A静态页仅显示节点；管理VPS进程的页面连接本机管理服务，不能用Pages静态页面直接执行root命令。

## 10 最小实现与运行预算

```text
src/        vpngate.py / models.py / pool.py / classifier.py / checker.py / subscription.py
scripts/    full_chain_check.py
worker/     checker-adapter / vpngate-edge / optional-edgetunnel-adapter
vps/        fanout-based manager / netns / socks / health / exporter
data/       node_pool.json / mode_a_validated.json / residential.json
runtime/    slots.json / slot_health.json / private-subscription.txt（忽略提交）
public/     index.html / nodes.txt
.github/workflows/update.yml
docs/       DEVELOPMENT.md / REFERENCE_AUDIT.md
```

v0.x 核心流水线用 Python，`Pool Builder` 必须既能在 Actions 调用，也能在 VPS Standalone 调用；Worker 沿用现有 JavaScript 与必要适配，VPS 尽量复用现有 Multi-Exit 底座。不要为了三种运行模式复制三套抓取/分类实现，也不先搭 TypeScript 迁移、多 JSON Schema、SQLite、签名服务或 IPC 框架。共享 JSON 字段和小量必要模型校验即可。统一部署入口、配置文件和状态页优先于增加新的可部署服务。

Actions先手动成功，再加30/60分钟schedule：候选上限50、SSTP并发4、Xray并发2、单节点限时30秒、完整链路45秒、瞬态错误最多重试1次；这些是可调起始值。画像按出口IP缓存24小时，链路证据默认60分钟过期。429/Worker异常单独报告，不把服务限额当所有VPN失效；旧报告可保留但过期节点不发订阅。具体平台配额见审计文档。

## 11 v0.x 底线与 v1.0 加固

| v0.x立即保留 | v1.0再做或按需要增加 |
| --- | --- |
| 真实握手、两个HTTPS Echo、actual==expected、最终配置一致 | Checker TLS身份认证修复；signed Echo仅可选 |
| 最小tun绑定、防回退路由/防火墙、断线失败关闭 | 强化kill switch、广泛故障注入、权限分离与恢复 |
| 自有HTTPS源、SHA256、JSON写入替换、简单锁 | 公共池Ed25519签名、防回滚、复杂发布/事务机制 |
| 固定Slot身份、端口与tag，不健康不落默认direct | 多机调度、复杂状态机、无缝切换 |
| 配置脚本清理、loopback监听、Secrets、无公开UUID/私有订阅 | root-helper/cgroup/独立agent与完整审计 |
| 命令/配置导出；WebUI实现时必要鉴权 | 3x-ui API自动应用、备份与回滚 |

保留既有许可边界：fanout MIT可复用并保留声明；CheckSocks5按GPL v3条件处理；gate与CF-vpngate无明确许可时仅参考；AimiliVPN暂仅功能参考。EdgeTunnel独立部署对接，不将许可兼容性未确认的Worker源码混成一份。许可记录不能用“组合项目”代替。

v0.1 已在本机和 GitHub Actions 完成；v0.2 现用保留许可声明的 Multi-Exit 底座读取同一 `node_pool.json`，并已在一台小规格 Debian VPS 上完成一个固定 Slot 的真实验收（包括掉线失败、kill-switch 和自动恢复），证据见 [`VPS_DEPLOYMENT.md`](VPS_DEPLOYMENT.md)。CF-1/CF-2 已完成源码与自动化测试；当前 Cloudflare 三个过渡服务已经部署，下一步是把 KV、数据面、管理页和订阅入口收敛为一个 xnvgatebox 部署单元，并用一次配置完成 GitHub Actions 发布。随后完成 CF-3 的真实数据面绑定、CF-4 的定时刷新/回滚，再扩展 VPS 多 Slot 和统一订阅；外部兼容适配器只保留为可选路径。
