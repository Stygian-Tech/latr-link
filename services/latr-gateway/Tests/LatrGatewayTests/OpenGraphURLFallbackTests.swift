import LatrGatewayLib
import Testing

@Suite("OpenGraphURLFallback")
struct OpenGraphURLFallbackTests {
    @Test("degraded fields use hostname and slug title")
    func degradedFields() {
        let fields = degradedOpenGraphFields(
            from: "https://www.theverge.com/features/937620/enhanced-games-performance-enhancing-drugs"
        )
        #expect(fields.siteName == "theverge.com")
        #expect(fields.title == "Enhanced Games Performance Enhancing Drugs")
    }

    @Test("humanize slug decodes percent encoding")
    func humanizeSlug() {
        #expect(humanizeURLSlug("hello-world") == "Hello World")
        #expect(humanizeURLSlug("caf%C3%A9") == "Café")
    }

    @Test("enrich fills missing title from site name")
    func enrichFields() {
        let enriched = enrichOpenGraphFields(
            OpenGraphFields(siteName: "example.com"),
            resolvedPageURL: "https://example.com/path"
        )
        #expect(enriched.title == "example.com")
        #expect(enriched.siteName == "example.com")
    }
}

@Suite("ReaderProxyOpenGraph")
struct ReaderProxyOpenGraphTests {
    @Test("parses jina reader title line")
    func parseTitleLine() {
        let text = """
        Title: Roids were all the rage at the Enhanced Games

        URL Source: https://www.theverge.com/features/937620/enhanced-games

        Markdown Content:
        # Roids were all the rage at the Enhanced Games | The Verge
        """
        let parsed = parseReaderProxyResponse(
            text,
            sourceURL: "https://www.theverge.com/features/937620/enhanced-games"
        )
        #expect(parsed?.title == "Roids were all the rage at the Enhanced Games")
        #expect(parsed?.siteName == "theverge.com")
    }
}
