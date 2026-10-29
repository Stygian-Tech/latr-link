package preview

import (
	"os"
	"strings"
	"testing"
)

func TestMarkupParity(t *testing.T) {
	tests := []struct {
		name, markup string
		want         Fields
	}{
		{"entities and unicode", `<head><meta property="og:title" content="Tom&amp;#39;s Guide"><meta property="og:description" content="It&apos;s \u0027great\u0027"></head>`, Fields{Title: "Tom's Guide", Description: "It's 'great'"}},
		{"author skips profile URL", `<head><meta property="article:author" content="https://facebook.com/pages/example"><meta name="twitter:creator" content="@ada"></head>`, Fields{Author: "@ada"}},
		{"extended metadata", `<head><meta property="og:image:secure_url" content="https://cdn.example/secure.png"><script type="application/ld+json">{"@type":"Article","author":{"@type":"Person","name":"Grace Hopper"}}</script></head>`, Fields{Image: "https://cdn.example/secure.png", Author: "Grace Hopper"}},
		{"relative image", `<head><meta property="og:title" content="NFTrig"><meta property="og:image" content="/static/arxiv-logo.png"></head>`, Fields{Title: "NFTrig", Image: "https://news.example/static/arxiv-logo.png"}},
		{"JSONLD", `<head><script type="application/ld+json">{"@type":"Article","headline":"JSON-LD Headline","image":"https://cdn.example/article.png"}</script></head>`, Fields{Title: "JSON-LD Headline", Image: "https://cdn.example/article.png"}},
		{"title precedence", `<head><title>Document Title</title><meta name="twitter:title" content="Twitter Title"><meta property="og:title" content="OG Title"></head><body><meta property="og:title" content="Body Title"></body>`, Fields{Title: "OG Title"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, _ := ParseMarkup(tt.markup, "https://news.example/item", false)
			if got != tt.want {
				t.Fatalf("got %#v, want %#v", got, tt.want)
			}
		})
	}
}
func TestCleanEscapes(t *testing.T) {
	for input, want := range map[string]string{"It&apos;s fine": "It's fine", "Don&#39;t stop": "Don't stop", "Don&#039;t stop": "Don't stop", "Don&#x27;t stop": "Don't stop", `Say \u0027hello\u0027`: "Say 'hello'", "Tom&amp;#39;s": "Tom's", "&unknown; entity": "&unknown; entity"} {
		if got := clean(input); got != want {
			t.Errorf("clean(%q)=%q, want %q", input, got, want)
		}
	}
}
func TestMetadataSignalsAndHeadIsolation(t *testing.T) {
	_, signals := ParseMarkup(`<head><title>Document</title></head>`, "https://example.com", false)
	if signals.ExplicitImage || signals.ExplicitTitle {
		t.Fatal("document title marked explicit")
	}
	f, signals := ParseMarkup(`<head><meta property="og:title" content="Authored"><meta property="og:image" content="/image.png"></head><body><script type="application/ld+json">{"headline":"Body"}</script></body>`, "https://example.com", true)
	if f.Title != "Authored" || !signals.ExplicitTitle || !signals.ExplicitImage {
		t.Fatalf("unexpected metadata: %#v %#v", f, signals)
	}
	f, _ = ParseMarkup(`<head></head><body><script type="application/ld+json">{"headline":"Body"}</script></body>`, "https://example.com", true)
	if f.HasContent() {
		t.Fatalf("body leaked into head: %#v", f)
	}
}
func TestProviderGoldenFixtures(t *testing.T) {
	tests := []struct {
		fixture, source, title, image string
		parser                        func(string, string) *Fields
	}{
		{"verge-939026-microlink", "https://www.theverge.com/column/939026/user-replaceable-batteries-eu-european-union-legislation", "User-replaceable batteries are coming back in a big way", "https://platform.theverge.com/wp-content/uploads/", ParseMicrolink},
		{"verge-940524-microlink", "https://www.theverge.com/tech/940524/amd-computex-am5-promise-2029-rx9070gre-7700x3d-5800x3d", "AMD’s new pitch: our old tech is so good you should just keep using it", "https://platform.theverge.com/wp-content/uploads/", ParseMicrolink},
		{"verge-937620-microlink", "https://www.theverge.com/features/937620/enhanced-games-performance-enhancing-drugs-science-health-sports", "Roids were all the rage at the Enhanced Games", "https://platform.theverge.com/wp-content/uploads/", ParseMicrolink},
		{"nyt-20260531-cardyb", "https://www.nytimes.com/2026/05/31/us/politics/trump-iran-stalemate-ukraine-gaza.html", "Trump Hits the Stalemate Phase", "https://cardyb.bsky.app/v1/image", ParseCardyb},
		{"macstories-remctl-cardyb", "https://www.macstories.net/stories/introducing-remctl-the-power-user-reminders-cli-for-macos-and-ai-agents/", "Introducing RemCTL", "https://cardyb.bsky.app/v1/image", ParseCardyb},
		{"cnn-20260531-cardyb", "https://www.cnn.com/2026/05/31/us/iran-tunnels-reopened-us-strategy-bombing-invs", "Iran’s reopened underground missile sites", "https://cardyb.bsky.app/v1/image", ParseCardyb},
	}
	for _, tt := range tests {
		t.Run(tt.fixture, func(t *testing.T) {
			data, err := os.ReadFile("../../Tests/LatrGatewayTests/Fixtures/" + tt.fixture + ".json")
			if err != nil {
				t.Fatal(err)
			}
			got := tt.parser(string(data), tt.source)
			if got == nil || !strings.HasPrefix(got.Title, tt.title) || !strings.HasPrefix(got.Image, tt.image) {
				t.Fatalf("unexpected golden result %#v", got)
			}
		})
	}
}
func TestQualityAndFallbackParity(t *testing.T) {
	source := "https://www.theverge.com/features/937620/enhanced-games-performance-enhancing-drugs"
	want := Fields{Title: "Enhanced Games Performance Enhancing Drugs", SiteName: "theverge.com"}
	if got := Degraded(source); got != want {
		t.Fatalf("degraded %#v", got)
	}
	if HumanizeSlug("caf%C3%A9") != "Café" {
		t.Fatal("escaped slug")
	}
	for _, title := range []string{"The Verge", "theverge.com", want.Title, "Home"} {
		if !WeakTitle(Fields{Title: title, SiteName: "The Verge"}, source) {
			t.Errorf("weak title %q accepted", title)
		}
	}
	weak := Fields{Title: "The Verge", SiteName: "The Verge"}
	strong := Fields{Title: "Authored headline", Image: "https://cdn.example/hero.jpg"}
	if Score(strong, source) <= Score(weak, source) {
		t.Fatal("provider ranking")
	}
	if got := Merge(strong, weak); got.Title != strong.Title || got.Image != strong.Image || got.SiteName != weak.SiteName {
		t.Fatalf("merge %#v", got)
	}
	if got := Enrich(Fields{SiteName: "example.com"}, "https://example.com/path"); got.Title != "example.com" {
		t.Fatal("missing enrichment")
	}
}
func TestReaderAndRejectedProviders(t *testing.T) {
	text := "Title: An authored headline\n\nMarkdown Content:\n![Author](https://cdn.example/authors/jane.jpg?w=96)\n![Hero](https://cdn.example/uploads/hero.jpg?w=1200)"
	got := ParseReader(text, "https://example.com/article")
	if got == nil || got.Title != "An authored headline" || got.Image != "https://cdn.example/uploads/hero.jpg?w=1200" {
		t.Fatalf("reader %#v", got)
	}
	for _, raw := range []string{`{}`, `{"status":"fail"}`, `invalid`} {
		if ParseMicrolink(raw, "https://example.com") != nil {
			t.Errorf("accepted %q", raw)
		}
	}
	if ParseCardyb(`{"error":"unavailable"}`, "https://example.com") != nil {
		t.Fatal("provider error accepted")
	}
}

func TestReaderJSONMetadata(t *testing.T) {
	raw := `{"data":{"title":"Fallback title","description":"Fallback description","metadata":{"og:title":"Authored headline","og:description":"Authored lead","og:site_name":"Publication","og:image":"https://cdn.example/hero.jpg","author":"Ada"}}}`
	got := ParseReader(raw, "https://example.com/article")
	want := Fields{Title: "Authored headline", Description: "Authored lead", SiteName: "Publication", Image: "https://cdn.example/hero.jpg", Author: "Ada"}
	if got == nil || *got != want {
		t.Fatalf("reader metadata %#v", got)
	}
}
