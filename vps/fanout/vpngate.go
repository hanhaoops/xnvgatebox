package main

import (
	"fmt"
	"net"
	"os"
	"strings"
	"time"
)

// Node 是一个 VPN Gate 节点。
type SstpEndpoint struct {
	Host string `json:"host"`
	Port int    `json:"port"`
}

type Node struct {
	SSTPCandidates    []SstpEndpoint `json:"sstp_candidates,omitempty"`
	PoolNodeID        string         `json:"pool_node_id,omitempty"`
	HostName          string         `json:"hostname"`
	IP                string         `json:"ip"`
	Country           string         `json:"country"`
	CountryCode       string         `json:"country_code"`
	ASN               string         `json:"asn,omitempty"`
	ISP               string         `json:"isp,omitempty"`
	IPType            string         `json:"ip_type,omitempty"`
	ExpectedExitIP    string         `json:"expected_exit_ip,omitempty"`
	SSTPStatus        string         `json:"sstp_status,omitempty"`
	OpenVPNStatus     string         `json:"openvpn_status,omitempty"`
	FullChainVerified bool           `json:"full_chain_verified"`
	LastVerified      string         `json:"last_verified,omitempty"`
	OpenVPNEgress     *EgressProfile `json:"openvpn_egress,omitempty"`
	Ping              int            `json:"ping"`
	SpeedMbps         float64        `json:"speed_mbps"`
	Sessions          int            `json:"sessions"`
	Config            string         `json:"-"` // 解码后的 .ovpn 内容
	// Residential 表示这是志愿者的家庭宽带，不是 VPN Gate 自己的机房服务器。
	Residential bool `json:"residential"`
}

// vpngate 自营服务器所在的网段。这些是学术网络里的机房机器，
// 不是志愿者家宽：出口 IP 一眼能看出来是数据中心，而且更容易满员。
var vpngateOwnNets = []string{"219.100.37.0/24"}

// isResidential 判断一个节点是不是志愿者家宽。
//
// 两条判据都是实测出来的：
//   - hostname 以 public-vpn- 开头的是 vpngate 自营服务器
//   - 219.100.37.0/24 段同样是自营（学术网络机房）
//
// 剩下的是志愿者用自家宽带跑的，出口 IP 属于普通运营商。
func isResidential(hostName, ip string) bool {
	if strings.HasPrefix(strings.ToLower(strings.TrimSpace(hostName)), "public-vpn-") {
		return false
	}
	addr := net.ParseIP(strings.TrimSpace(ip))
	if addr == nil {
		// IP 解析不出来时不敢断言，按家宽放过，让连通性测试去淘汰
		return true
	}
	for _, cidr := range vpngateOwnNets {
		_, block, err := net.ParseCIDR(cidr)
		if err == nil && block.Contains(addr) {
			return false
		}
	}
	return true
}

// fetchNodes 读取 Pool Builder 产出的已校验节点池。
// fanout 不再自行直连或经反代拉取 VPN Gate 列表：候选的获取、校验与
// 画像统一由共享 Pool Builder 完成，这里只消费它的 node_pool.json。
func fetchNodes(timeout time.Duration) ([]Node, error) {
	if pool := strings.TrimSpace(os.Getenv("FANOUT_VALIDATED_POOL_FILE")); pool != "" {
		return fetchNodesFromValidatedPool(pool)
	}
	return nil, fmt.Errorf("请配置 FANOUT_VALIDATED_POOL_FILE；本项目只消费共享 Pool Builder 的 node_pool.json")
}
