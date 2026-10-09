package main

import (
	"fmt"
	"net"
	"os/exec"
	"strings"
)

var exitIPEchoURLs = []string{
	"https://api.ipify.org",
	"https://ipv4.icanhazip.com",
}

func probeIPPair(command func(string) ([]byte, error)) (string, error) {
	var got string
	for _, url := range exitIPEchoURLs {
		out, err := command(url)
		if err != nil {
			return "", err
		}
		ip := strings.TrimSpace(string(out))
		parsed := net.ParseIP(ip)
		if parsed == nil || parsed.To4() == nil {
			return "", fmt.Errorf("出口 IP 返回异常: %q", ip)
		}
		if got == "" {
			got = parsed.To4().String()
		} else if got != parsed.To4().String() {
			return "", fmt.Errorf("两个出口 IP 查询不一致: %s / %s", got, parsed)
		}
	}
	return got, nil
}

func (t *Tunnel) probeExpectedExitIP() (string, error) {
	return probeIPPair(func(url string) ([]byte, error) {
		return cmdOutput(exec.Command("ip", "netns", "exec", t.nsName(), "curl", "-4fsS", "--max-time", "15", url))
	})
}

func (t *Tunnel) probeSocksExitIP() (string, error) {
	cred := t.credential()
	proxy := fmt.Sprintf("127.0.0.1:%d", t.Port)
	userpass := cred.User + ":" + cred.Pass
	return probeIPPair(func(url string) ([]byte, error) {
		return cmdOutput(exec.Command("curl", "-4fsS", "--noproxy", "", "--max-time", "15", "--socks5-hostname", proxy, "--proxy-user", userpass, url))
	})
}
