package preview

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"
)

const UserAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"

func BlockingReason(host string) string {
	host = strings.ToLower(strings.Trim(strings.TrimSpace(host), "[]"))
	if host == "" {
		return "invalid_host"
	}
	if host == "localhost" || host == "localhost." || host == "0" || host == "broadcasthost" || host == "::1" || host == "::" || host == "0000:0000:0000:0000:0000:0000:0000:0000" || strings.HasSuffix(host, ".local") || strings.HasSuffix(host, ".localhost") {
		return "blocked_host"
	}
	if ip, e := netip.ParseAddr(host); e == nil {
		ip = ip.Unmap()
		if (ip.Is4() && ip.As4()[0] == 0) || ip.IsPrivate() || ip.IsLoopback() || ip.IsUnspecified() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsMulticast() {
			if ip.Is4() {
				return "blocked_ipv4"
			}
			return "blocked_ipv6_scope"
		}
	}
	return ""
}

// PublicHTTPClient pins a checked DNS address at dial time, including redirects.
func PublicHTTPClient() *http.Client {
	t := http.DefaultTransport.(*http.Transport).Clone()
	t.Proxy = nil
	t.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, e := net.SplitHostPort(address)
		if e != nil {
			return nil, e
		}
		if BlockingReason(host) != "" {
			return nil, errors.New("blocked_host")
		}
		ips, e := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
		if e != nil {
			return nil, e
		}
		for _, ip := range ips {
			if BlockingReason(ip.String()) != "" {
				return nil, errors.New("blocked_host")
			}
		}
		d := net.Dialer{Timeout: 10 * time.Second}
		var last error
		for _, ip := range ips {
			c, e := d.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
			if e == nil {
				return c, nil
			}
			last = e
		}
		if last == nil {
			last = errors.New("host has no public addresses")
		}
		return nil, last
	}
	return &http.Client{Transport: t, Timeout: 15 * time.Second}
}

type Resolver struct {
	HTTP        *http.Client
	PLCURL      string
	AppViews    []string
	IdentityURL string
}

func New(client *http.Client, plc string, appviews []string, identity string) *Resolver {
	if client == nil {
		client = PublicHTTPClient()
	}
	return &Resolver{client, plc, appviews, identity}
}
func (r *Resolver) Fetch(ctx context.Context, raw string, max int, accept string) (string, string, error) {
	u, e := url.Parse(strings.TrimSpace(raw))
	if e != nil || u.Host == "" {
		return "", "", errors.New("invalid_url")
	}
	if u.Scheme != "https" && u.Scheme != "http" {
		return "", "", errors.New("unsupported_scheme")
	}
	if reason := BlockingReason(u.Hostname()); reason != "" {
		return "", "", errors.New(reason)
	}
	c := *r.HTTP
	c.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		if len(via) > 8 {
			return errors.New("too_many_redirects")
		}
		if req.URL.Scheme != "http" && req.URL.Scheme != "https" {
			return errors.New("unsupported_scheme")
		}
		if reason := BlockingReason(req.URL.Hostname()); reason != "" {
			return errors.New("blocked_redirect")
		}
		return nil
	}
	req, e := http.NewRequestWithContext(ctx, "GET", u.String(), nil)
	if e != nil {
		return "", "", e
	}
	req.Header.Set("User-Agent", UserAgent)
	req.Header.Set("Accept", accept)
	req.Header.Set("Accept-Language", "en-US,en;q=0.9")
	req.Header.Set("Cache-Control", "no-cache")
	req.Header.Set("Referer", u.Scheme+"://"+u.Host+"/")
	req.Header.Set("Sec-Fetch-Dest", "document")
	req.Header.Set("Sec-Fetch-Mode", "navigate")
	req.Header.Set("Sec-Fetch-Site", "none")
	req.Header.Set("Sec-Fetch-User", "?1")
	req.Header.Set("Upgrade-Insecure-Requests", "1")
	resp, e := c.Do(req)
	if e != nil {
		return "", "", e
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", "", fmt.Errorf("http_%d", resp.StatusCode)
	}
	b, e := io.ReadAll(io.LimitReader(resp.Body, int64(max)))
	return string(b), resp.Request.URL.String(), e
}
func (r *Resolver) Resolve(ctx context.Context, raw string) *Fields {
	u, e := url.Parse(strings.TrimSpace(raw))
	if e != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
		return nil
	}
	if BlockingReason(u.Hostname()) != "" {
		return nil
	}
	ctx, cancel := context.WithTimeout(ctx, 32*time.Second)
	defer cancel()
	f := Fields{}
	var sig Signals
	if markup, final, e := r.Fetch(ctx, raw, 512*1024, "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8"); e == nil {
		f, sig = ParseMarkup(markup, final, false)
		f = Enrich(f, final)
	}
	if f.Image == "" || !sig.ExplicitTitle || !sig.ExplicitImage || WeakTitle(f, raw) {
		candidates := make([]Fields, 3)
		var wg sync.WaitGroup
		targets := []struct {
			url    string
			parser func(string, string) *Fields
		}{{"https://api.microlink.io/?url=" + url.QueryEscape(raw), ParseMicrolink}, {"https://r.jina.ai/" + raw, ParseReader}, {"https://cardyb.bsky.app/v1/extract?url=" + url.QueryEscape(raw), ParseCardyb}}
		for i, target := range targets {
			wg.Go(func() {
				if body, _, e := r.Fetch(ctx, target.url, 512*1024, "application/json,text/plain,*/*"); e == nil {
					if p := target.parser(body, raw); p != nil {
						candidates[i] = *p
					}
				}
			})
		}
		wg.Wait()
		best := f
		for _, candidate := range candidates {
			if Score(candidate, raw) > Score(best, raw) {
				best = candidate
			}
		}
		f = Enrich(Merge(best, f), raw)
	}
	if !f.HasContent() {
		f = Degraded(raw)
	}
	return &f
}
func ParseCardyb(raw, source string) *Fields {
	var p struct{ Error, Title, Description, Image string }
	if json.Unmarshal([]byte(raw), &p) != nil || p.Error != "" {
		return nil
	}
	f := Enrich(Fields{Title: clean(p.Title), Description: clean(p.Description), Image: clean(p.Image)}, source)
	if WeakTitle(f, source) && f.Image == "" {
		return nil
	}
	return &f
}
func ParseMicrolink(raw, source string) *Fields {
	var p struct {
		Status string
		Data   struct {
			Title, Description, Author, Publisher string
			Image                                 struct{ URL string }
		}
	}
	if json.Unmarshal([]byte(raw), &p) != nil || p.Status != "success" {
		return nil
	}
	f := Enrich(Fields{Title: clean(p.Data.Title), Description: clean(p.Data.Description), Author: clean(p.Data.Author), SiteName: clean(p.Data.Publisher), Image: clean(p.Data.Image.URL)}, source)
	if Score(f, source) == 0 {
		return nil
	}
	return &f
}

var heroImage = regexp.MustCompile(`!\[[^\]]*\]\((https?://[^)\s]+)\)`)

func ParseReader(raw, source string) *Fields {
	f := Fields{}
	var p struct {
		Data struct {
			Title, Description string
			Metadata           map[string]string
		}
	}
	if strings.HasPrefix(strings.TrimSpace(raw), "{") && json.Unmarshal([]byte(raw), &p) == nil {
		m := p.Data.Metadata
		f = Fields{Title: first(m, "og:title", "twitter:title"), Description: first(m, "og:description", "twitter:description", "description"), Image: first(m, "og:image", "og:image:url", "og:image:secure_url", "twitter:image", "parsely-image-url"), SiteName: first(m, "og:site_name", "application-name"), Author: first(m, "author", "article:author", "parsely-author", "og:article:author")}
		if f.Title == "" {
			f.Title = clean(p.Data.Title)
		}
		if f.Description == "" {
			f.Description = clean(p.Data.Description)
		}
	} else {
		for line := range strings.SplitSeq(raw, "\n") {
			line = strings.TrimSpace(line)
			if strings.HasPrefix(line, "Title: ") {
				f.Title = clean(strings.TrimPrefix(line, "Title: "))
			}
			if strings.HasPrefix(line, "Description: ") {
				f.Description = clean(strings.TrimPrefix(line, "Description: "))
			}
		}
		if f.Title == "" {
			if _, md, ok := strings.Cut(raw, "Markdown Content:"); ok {
				for line := range strings.SplitSeq(md, "\n") {
					if strings.HasPrefix(strings.TrimSpace(line), "# ") {
						f.Title = clean(strings.TrimPrefix(strings.TrimSpace(line), "# "))
						break
					}
				}
			}
		}
		for _, m := range heroImage.FindAllStringSubmatch(raw, -1) {
			blocked := false
			for _, s := range []string{"author_profile", "/authors/", "avatar", "favicon", "cookie", "logo.png", "ot-logo", "w=96", "w=48", "w=64"} {
				if strings.Contains(strings.ToLower(m[1]), s) {
					blocked = true
				}
			}
			if !blocked {
				f.Image = m[1]
				break
			}
		}
	}
	f = Enrich(f, source)
	if Score(f, source) == 0 {
		return nil
	}
	return &f
}
